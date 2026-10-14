import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { AgentRegistry, createAgentSession, createSubagentSettings, SessionManager } from "@oh-my-pi/pi-coding-agent";
import { resolveToolTier } from "@oh-my-pi/pi-coding-agent/tools/approval";

const SIDE_QUESTION_TOOLS = new Set(["read", "grep", "glob", "find", "web_search"]);

const BLOCKED_REASON =
	"Side questions are read-only: only read, grep, glob, find, and web_search run, and only for reads. This call did not run.";

const CANCELLED_NOTE = "The user cancelled the previous side question. Do not answer it.";

type AgentTool = AgentSession["agent"]["state"]["tools"][number];

/**
 * The provider-visible fields of a main-session tool the mirror cannot build
 * (LSP and MCP stay off there), with an executor that refuses. The gate blocks
 * the call first; this keeps the request's tool list equal to the main one.
 */
function rejectingCopy(tool: AgentTool): AgentTool {
	return {
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
		strict: tool.strict,
		deferLoading: tool.deferLoading,
		customFormat: tool.customFormat,
		customWireName: tool.customWireName,
		native: tool.native,
		examples: tool.examples,
		// A function intent means the schema gets no intent field; "omit" says the same.
		intent: typeof tool.intent === "function" ? "omit" : tool.intent,
		loadMode: tool.loadMode,
		async execute() {
			throw new Error(BLOCKED_REASON);
		},
	};
}

/** Give the mirror the main session's tool list in the same order, so the request prefix matches. */
function matchToolCatalog(mirror: AgentSession, main: AgentSession): void {
	const own = new Map(mirror.agent.state.tools.map(tool => [tool.name, tool]));
	const mainTools = main.agent.state.tools;
	const sameOrder =
		mainTools.length === own.size && mainTools.every((tool, i) => mirror.agent.state.tools[i]?.name === tool.name);
	if (sameOrder) return;
	mirror.agent.setTools(mainTools.map(tool => own.get(tool.name) ?? rejectingCopy(tool)));
}

export interface SideQuestionToolCall {
	id: string;
	name: string;
	/** The call's main argument (path, pattern, or query), for one line in the view. */
	target: string;
	status: "running" | "done" | "error" | "blocked";
}

export interface SideQuestionCallbacks {
	/** Text of the assistant message being streamed; a new message starts from empty. */
	onText(text: string): void;
	onToolCall(call: SideQuestionToolCall): void;
}

function toolCallTarget(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const record = args as Record<string, unknown>;
	for (const key of ["path", "pattern", "query", "url", "command", "paths"]) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim().replace(/\s+/g, " ");
		if (Array.isArray(value) && value.length > 0) return value.map(String).join(" ");
	}
	return "";
}

function assistantText(message: { content?: unknown } | undefined): string {
	if (!message || !Array.isArray(message.content)) return "";
	return message.content
		.filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string")
		.map(part => part.text)
		.join("")
		.trim();
}

function liveSession(ctx: ExtensionContext): AgentSession | undefined {
	return AgentRegistry.global().get(ctx.agent.id)?.session ?? undefined;
}

/** Whether a Side question can run here: a live main session with a saved transcript. */
export function sideQuestionsAvailable(ctx: ExtensionContext): boolean {
	return ctx.agent.kind === "main" && !!ctx.sessionManager.getSessionFile() && !!liveSession(ctx)?.model;
}

/** One thread of Side questions: a mirror session that keeps its own history until disposed. */
export class SideQuestionThread {
	readonly #session: AgentSession;
	readonly #file: string;
	#running = false;
	#disposed = false;
	/** The last question was cancelled; its prompt stays in the history, so the next one says so. */
	#lastCancelled = false;

	private constructor(session: AgentSession, file: string) {
		this.#session = session;
		this.#file = file;
	}

	static async open(ctx: ExtensionContext): Promise<SideQuestionThread> {
		const main = liveSession(ctx);
		const parentFile = ctx.sessionManager.getSessionFile();
		const model = main?.model;
		if (!main || !parentFile || !model) throw new Error("Side questions need a saved main session.");
		await main.sessionManager.ensureOnDisk();
		await main.sessionManager.flush();

		const id = `SideQuestion-${crypto.randomUUID()}`;
		const sessionDir = parentFile.slice(0, -".jsonl".length);
		const file = path.join(sessionDir, `${id}.jsonl`);
		const fork = await SessionManager.forkFrom(parentFile, ctx.cwd, sessionDir, undefined, {
			copyArtifacts: false,
			suppressBreadcrumb: true,
			sessionFile: file,
			resetInheritedCost: true,
			repairInterruptedTail: true,
		});

		let mirror: AgentSession | undefined;
		const gate = (pi: ExtensionAPI) => {
			pi.on("tool_call", event => {
				if (!SIDE_QUESTION_TOOLS.has(event.toolName)) return { block: true, reason: BLOCKED_REASON };
				const tool = mirror?.getToolByName(event.toolName);
				if (!tool || resolveToolTier(tool, event.input) !== "read") return { block: true, reason: BLOCKED_REASON };
				return undefined;
			});
		};
		const parentPreparedExtensions = main.preparedExtensions;
		const parentExtensionPaths = main.extensionPaths;
		const parentExtensionRoots = main.effectiveExtensionRoots;
		try {
			const created = await createAgentSession({
				cwd: ctx.cwd,
				sessionManager: fork,
				model,
				thinkingLevel: main.configuredThinkingLevel(),
				systemPrompt: [...main.systemPrompt],
				// Top-level tools only: enabled tools also list the ones mounted
				// under xd://, and naming those makes them top-level, which changes
				// the request prefix.
				toolNames: main.getActiveToolNames(),
				providerSessionId: `${main.sessionId}:side-question:${id}`,
				providerPromptCacheKey: main.agent.promptCacheKey ?? main.sessionId,
				modelRegistry: main.modelRegistry,
				authStorage: main.modelRegistry.authStorage,
				settings: createSubagentSettings(main.settings),
				hasUI: false,
				enableMCP: false,
				enableLsp: false,
				agentId: id,
				agentDisplayName: "side question",
				parentAgentId: ctx.agent.id,
				agentRegistry: new AgentRegistry(),
				disableExtensionDiscovery: true,
				// The parent's extensions re-register its providers on the shared model registry.
				preloadedPreparedExtensions: parentPreparedExtensions?.length ? parentPreparedExtensions : undefined,
				preloadedExtensionPaths: parentExtensionPaths?.length ? [...parentExtensionPaths] : undefined,
				extensionRoots: () => parentExtensionRoots,
				extensions: [gate],
			});
			mirror = created.session;
			matchToolCatalog(mirror, main);
		} catch (error) {
			await removeFork(file);
			throw error;
		}
		// Codex missed the main prompt cache on a new websocket (0 of 4 in the
		// spike); SSE with parent affinity hit 4 of 5. `parentSessionId` is an
		// OMP 18.10 stream option that the 18.8 SDK types lack.
		const stream = mirror.agent.streamFn;
		mirror.agent.streamFn = (streamModel, context, options) =>
			stream(streamModel, context, {
				...options,
				preferWebsockets: false,
				...({ parentSessionId: main.sessionId } as object),
			});
		return new SideQuestionThread(mirror, file);
	}

	/** Run one question to its answer; follow-ups see the earlier questions, answers, and tool results. */
	async ask(promptText: string, callbacks: SideQuestionCallbacks, signal: AbortSignal): Promise<string> {
		if (this.#disposed) throw new Error("This side question thread is closed.");
		if (signal.aborted) throw new DOMException("Side question cancelled", "AbortError");
		if (this.#running) throw new Error("A side question is already running.");
		this.#running = true;
		const calls = new Map<string, SideQuestionToolCall>();
		let text = "";
		const unsubscribe = this.#session.subscribe(event => {
			switch (event.type) {
				case "message_start":
					if (event.message.role === "assistant") {
						text = "";
						callbacks.onText(text);
					}
					break;
				case "message_update":
					if (event.assistantMessageEvent.type === "text_delta") {
						text += event.assistantMessageEvent.delta;
						callbacks.onText(text);
					}
					break;
				case "tool_execution_start": {
					const call: SideQuestionToolCall = {
						id: event.toolCallId,
						name: event.toolName,
						target: toolCallTarget(event.args),
						status: "running",
					};
					calls.set(call.id, call);
					callbacks.onToolCall(call);
					break;
				}
				case "tool_execution_end": {
					const call = calls.get(event.toolCallId);
					if (!call) break;
					const blocked = event.isError && JSON.stringify(event.result ?? "").includes(BLOCKED_REASON);
					call.status = blocked ? "blocked" : event.isError ? "error" : "done";
					callbacks.onToolCall(call);
					break;
				}
			}
		});
		const abort = () => void this.#session.abort();
		signal.addEventListener("abort", abort, { once: true });
		try {
			const message = this.#lastCancelled ? `${CANCELLED_NOTE}\n${promptText}` : promptText;
			await this.#session.prompt(message, { attribution: "user" });
			await this.#session.waitForIdle();
			const last = this.#session.getLastAssistantMessage();
			if (signal.aborted) throw new DOMException("Side question cancelled", "AbortError");
			if (last?.stopReason === "error") throw new Error(last.errorMessage || "The side question failed.");
			return assistantText(last);
		} finally {
			signal.removeEventListener("abort", abort);
			unsubscribe();
			this.#running = false;
			this.#lastCancelled = signal.aborted;
		}
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		try {
			await this.#session.abort();
			await this.#session.dispose();
		} finally {
			await removeFork(this.#file);
		}
	}
}

/** A thread opened on first use. A failed open is retried by the next `get`. */
export class LazySideQuestionThread {
	readonly #ctx: ExtensionContext;
	#thread: Promise<SideQuestionThread> | undefined;

	constructor(ctx: ExtensionContext) {
		this.#ctx = ctx;
	}

	get(): Promise<SideQuestionThread> {
		if (!this.#thread) {
			const opening = SideQuestionThread.open(this.#ctx);
			this.#thread = opening;
			opening.catch(() => {
				if (this.#thread === opening) this.#thread = undefined;
			});
		}
		return this.#thread;
	}

	/** Disposes the thread once it has opened; the next `get` opens a new one. */
	dispose(): void {
		const thread = this.#thread;
		this.#thread = undefined;
		void thread?.then(
			open => open.dispose(),
			() => {},
		);
	}
}

async function removeFork(file: string): Promise<void> {
	await Promise.allSettled([
		fs.rm(file, { force: true }),
		fs.rm(file.slice(0, -".jsonl".length), { recursive: true, force: true }),
	]);
}
