import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ImageContent } from "@oh-my-pi/pi-ai";
import type { AgentSession, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { AgentRegistry, createAgentSession, createSubagentSettings, SessionManager } from "@oh-my-pi/pi-coding-agent";
import { cfgDisplayCacheMissMarker } from "@oh-my-pi/pi-coding-agent/modes/settings";

/** The only tools a Side question is offered. */
const SIDE_QUESTION_TOOLS = ["read", "grep", "glob", "find", "web_search"];

const CANCELLED_NOTE = "The user cancelled the previous side question. Do not answer it.";

type AgentRef = NonNullable<ReturnType<AgentRegistry["get"]>>;

/**
 * The mirror's own registry, out of the Agent Hub, so nothing can message or
 * list the mirror. Lookups of ids it does not hold fall back to the global
 * registry, so `read agent://<id>` also finds a main-session agent that has
 * not published output yet.
 */
class SideQuestionRegistry extends AgentRegistry {
	override get(id: string): AgentRef | undefined {
		return super.get(id) ?? AgentRegistry.global().get(id);
	}

	override list(): AgentRef[] {
		const own = super.list();
		const ids = new Set(own.map(ref => ref.id));
		return [...own, ...AgentRegistry.global().list().filter(ref => !ids.has(ref.id))];
	}
}

/** The shortfall OMP's cache-miss marker ignores, as noise or below the cacheable floor. */
const MIN_CACHE_FOOTPRINT = 2048;

interface PromptUsage {
	input: number;
	cacheRead: number;
	cacheWrite: number;
}

/**
 * Tokens a request wrote to the cache again instead of reading them, when
 * that is more than OMP's 2048-token floor. `expectedPrompt` is the thread's
 * previous request; a thread's first request has none, because its tools and
 * system prompt differ from the main session's. Providers that write no cache
 * (implicit caching, Codex) never count, as in OMP's marker.
 */
export function cacheMissTokens(expectedPrompt: number | undefined, usage: PromptUsage): number | undefined {
	if (expectedPrompt === undefined || expectedPrompt < MIN_CACHE_FOOTPRINT || usage.cacheWrite <= 0) return undefined;
	const missing = expectedPrompt - usage.cacheRead;
	return missing > MIN_CACHE_FOOTPRINT ? missing : undefined;
}

function promptTokens(usage: PromptUsage): number {
	return usage.input + usage.cacheRead + usage.cacheWrite;
}

/** The prompt size of a finished request, from an assistant message's usage; undefined for none or a cut-off one. */
function requestPrompt(message: unknown): number | undefined {
	const { role, usage, stopReason } = message as { role?: string; usage?: PromptUsage; stopReason?: string };
	if (role !== "assistant" || !usage || stopReason === "aborted" || stopReason === "error") return undefined;
	const tokens = promptTokens(usage);
	return tokens > 0 ? tokens : undefined;
}

interface ToolCallBlock {
	type: "toolCall";
	id: string;
	name: string;
}

const PENDING_ASK =
	"The user is answering this question in the Picker now. The answer is not known here. Do not call ask again.";
const PENDING_CALL =
	"This call is still running in the main conversation. Its result is not known here. Do not call it again.";

/**
 * A copy of the main agent's messages for the mirror, so it sees what the
 * main agent sees (the transcript lacks messages the live session adds, such
 * as the eval state after a `/tree` jump). Each call the main agent still
 * waits on gets a result that says the call is still open, so the copy is a
 * valid conversation and the model does not take the call as failed.
 */
export function seedMessages<T>(messages: readonly T[]): T[] {
	const copy = structuredClone(messages) as T[];
	const answered = new Set<string>();
	let last: { content?: unknown } | undefined;
	for (const message of copy as { role?: string; toolCallId?: string; content?: unknown }[]) {
		if (message.role === "toolResult" && message.toolCallId) answered.add(message.toolCallId);
		if (message.role === "assistant") last = message;
	}
	const calls = Array.isArray(last?.content) ? (last.content as { type?: string }[]) : [];
	for (const block of calls) {
		if (block.type !== "toolCall") continue;
		const call = block as ToolCallBlock;
		if (answered.has(call.id)) continue;
		copy.push({
			role: "toolResult",
			toolCallId: call.id,
			toolName: call.name,
			content: [{ type: "text", text: call.name === "ask" ? PENDING_ASK : PENDING_CALL }],
			details: { __synthetic: true, source: "side_question_pending", executed: false },
			isError: false,
			timestamp: Date.now(),
		} as T);
	}
	return copy;
}

export interface SideQuestionToolCall {
	id: string;
	name: string;
	/** The call's main argument (path, pattern, or query), for one line in the view. */
	target: string;
	status: "running" | "done" | "error";
}

export interface SideQuestionCallbacks {
	/** A new assistant message starts; its text follows through `onText`. */
	onMessageStart(): void;
	/** Text so far of the assistant message being streamed. */
	onText(text: string): void;
	onToolCall(call: SideQuestionToolCall): void;
	/** A request missed the cache by this many tokens; only while OMP's Cache Miss Marker setting is on. */
	onCacheMiss(tokens: number): void;
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
	readonly #mainSettings: AgentSession["settings"];
	/** The thread's last request, which the next one should find cached. */
	#expectedPrompt: number | undefined;
	#running = false;
	#disposed = false;
	/** The last question was cancelled; its prompt stays in the history, so the next one says so. */
	#lastCancelled = false;

	private constructor(session: AgentSession, file: string, mainSettings: AgentSession["settings"]) {
		this.#session = session;
		this.#file = file;
		this.#mainSettings = mainSettings;
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
		// The mirror reads the main session's `local://` files (pasted images,
		// large pastes) in place, as OMP's `/tan` does: a snapshot of the main
		// mapping, since the main session manager can switch transcripts.
		const parentArtifactsDir = main.sessionManager.getArtifactsDir();
		const parentLocalSessionId = main.sessionManager.getSessionId();
		const fork = await SessionManager.forkFrom(parentFile, ctx.cwd, sessionDir, undefined, {
			copyArtifacts: false,
			suppressBreadcrumb: true,
			sessionFile: file,
			resetInheritedCost: true,
			repairInterruptedTail: true,
		});

		let mirror: AgentSession | undefined;
		const parentPreparedExtensions = main.preparedExtensions;
		const parentExtensionPaths = main.extensionPaths;
		const parentExtensionRoots = main.effectiveExtensionRoots;
		try {
			// Only the read-only tools are offered, with OMP's default system
			// prompt for them; restricted, the session also starts no MCP, LSP,
			// or IRC. Its first request cannot reuse the main prompt cache.
			const created = await createAgentSession({
				cwd: ctx.cwd,
				sessionManager: fork,
				model,
				thinkingLevel: main.configuredThinkingLevel(),
				toolNames: SIDE_QUESTION_TOOLS,
				restrictToolNames: true,
				providerSessionId: `${main.sessionId}:side-question:${id}`,
				modelRegistry: main.modelRegistry,
				authStorage: main.modelRegistry.authStorage,
				settings: createSubagentSettings(main.settings),
				hasUI: false,
				agentId: id,
				agentDisplayName: "side question",
				parentAgentId: ctx.agent.id,
				// A child session: binds no process-wide state and keeps the shared
				// `local://` mapping to itself instead of installing a global override.
				parentTaskPrefix: id,
				localProtocolOptions: {
					getArtifactsDir: () => parentArtifactsDir,
					getSessionId: () => parentLocalSessionId,
				},
				agentRegistry: new SideQuestionRegistry(),
				disableExtensionDiscovery: true,
				// The parent's extensions re-register its providers on the shared model registry.
				preloadedPreparedExtensions: parentPreparedExtensions?.length ? parentPreparedExtensions : undefined,
				preloadedExtensionPaths: parentExtensionPaths?.length ? [...parentExtensionPaths] : undefined,
				extensionRoots: () => parentExtensionRoots,
			});
			mirror = created.session;
			mirror.agent.replaceMessages(seedMessages(main.agent.state.messages));
		} catch (error) {
			try {
				await mirror?.dispose();
			} finally {
				await removeFork(file);
			}
			throw error;
		}
		return new SideQuestionThread(mirror, file, main.settings);
	}

	/** Run one question to its answer; follow-ups see the earlier questions, answers, and tool results. */
	async ask(
		promptText: string,
		callbacks: SideQuestionCallbacks,
		signal: AbortSignal,
		images?: ImageContent[],
	): Promise<string> {
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
						callbacks.onMessageStart();
					}
					break;
				case "message_end": {
					const prompt = requestPrompt(event.message);
					if (prompt === undefined) break;
					const usage = (event.message as { usage: PromptUsage }).usage;
					const missed = cacheMissTokens(this.#expectedPrompt, usage);
					this.#expectedPrompt = prompt;
					if (missed !== undefined && cfgDisplayCacheMissMarker.get(this.#mainSettings)) callbacks.onCacheMiss(missed);
					break;
				}
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
					call.status = event.isError ? "error" : "done";
					callbacks.onToolCall(call);
					break;
				}
			}
		});
		const abort = () => void this.#session.abort();
		signal.addEventListener("abort", abort, { once: true });
		try {
			const message = this.#lastCancelled ? `${CANCELLED_NOTE}\n${promptText}` : promptText;
			await this.#session.prompt(message, { attribution: "user", images });
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
