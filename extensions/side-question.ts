import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ImageContent } from "@oh-my-pi/pi-ai";
import type { AgentSession, CreateAgentSessionOptions, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { AgentRegistry, createAgentSession, createSubagentSettings, SessionManager } from "@oh-my-pi/pi-coding-agent";
import { cfgDisplayCacheMissMarker } from "@oh-my-pi/pi-coding-agent/modes/settings";
import type { SideQuestionRecovery } from "./side-question-recovery";
import { sideQuestionModel } from "./side-question-model";

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
 * that is more than OMP's 2048-token floor. `expectedPrompt` is the prompt the
 * request should find cached. Providers that write no cache (implicit
 * caching, Codex) never count, as in OMP's marker.
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

/** A Side question thread's first request, which the next thread's first one should find cached. */
interface ThreadStart {
	/** The main messages the thread was seeded from. */
	messages: readonly unknown[];
	prompt: number;
}

/**
 * The prompt a new thread's first request should find cached: the earlier
 * thread's first one, while the main messages still start with the ones that
 * thread saw. Compaction and a branch change replace them, so nothing is expected.
 */
export function sharedPrefixPrompt(earlier: ThreadStart | undefined, messages: readonly unknown[]): number | undefined {
	if (!earlier || earlier.messages.length > messages.length) return undefined;
	return earlier.messages.every((message, i) => message === messages[i]) ? earlier.prompt : undefined;
}

class CacheMissTracker {
	readonly #expected: Map<string, number | undefined>;
	readonly #observed = new Set<string>();
	readonly #onFirstPrompt: (route: string, prompt: number) => void;

	constructor(expected: Map<string, number | undefined>, onFirstPrompt: (route: string, prompt: number) => void) {
		this.#expected = expected;
		this.#onFirstPrompt = onFirstPrompt;
	}

	observe(message: unknown): number | undefined {
		const prompt = requestPrompt(message);
		if (prompt === undefined) return undefined;
		const { provider, model, usage } = message as { provider?: string; model?: string; usage: PromptUsage };
		if (!provider || !model) return undefined;
		const route = `${provider}\0${model}`;
		const missed = cacheMissTokens(this.#expected.get(route), usage);
		this.#expected.set(route, prompt);
		if (!this.#observed.has(route)) {
			this.#observed.add(route);
			this.#onFirstPrompt(route, prompt);
		}
		return missed;
	}
}

export class SideQuestionCache {
	readonly #latest = new Map<string, ThreadStart>();

	thread(messages: readonly unknown[]): CacheMissTracker {
		const snapshotAtOpen = new Map(
			Array.from(this.#latest, ([route, earlier]) => [route, sharedPrefixPrompt(earlier, messages)]),
		);
		return new CacheMissTracker(snapshotAtOpen, (route, prompt) => {
			this.#latest.set(route, { messages, prompt });
		});
	}
}

const caches = new WeakMap<AgentSession, SideQuestionCache>();

function cacheOf(main: AgentSession): SideQuestionCache {
	let cache = caches.get(main);
	if (!cache) caches.set(main, (cache = new SideQuestionCache()));
	return cache;
}

type ModelUsage = Parameters<SessionManager["appendModelUsage"]>[0];
type UsageMessage = { role?: string } & Partial<Omit<ModelUsage, "purpose" | "role">>;

/**
 * Records a mirror request's usage in the main session's ledger, as OMP does
 * for cache warms and judge calls, so Side question cost is counted and
 * outlives the deleted fork. A ledger entry is not a message; the main agent
 * never sees it. Dropped once the main session manager is on another transcript.
 */
export function recordSideQuestionUsage(ledger: SessionManager, sessionId: string, message: unknown): void {
	const { role, api, provider, model, usage, stopReason, errorMessage } = message as UsageMessage;
	if (role !== "assistant" || !usage || !api || !provider || !model || !stopReason) return;
	ledger.appendModelUsage(
		{ purpose: "side-question", api, provider, model, usage, stopReason, errorMessage },
		{ sessionId, parentId: ledger.getLeafId() },
	);
}

/**
 * Copies each usage entry the mirror records off its own transcript (cache
 * warms, judge calls) to the main ledger as `side-question:<purpose>`; the
 * fork that holds the original is deleted on dispose.
 */
export function forwardSideQuestionUsage(fork: SessionManager, ledger: SessionManager, sessionId: string): void {
	const append = fork.appendModelUsage.bind(fork);
	fork.appendModelUsage = (usage, owner) => {
		ledger.appendModelUsage(
			{ ...usage, purpose: `side-question:${usage.purpose}` },
			{ sessionId, parentId: ledger.getLeafId() },
		);
		return append(usage, owner);
	};
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
	onRecovery(event: SideQuestionRecovery): void;
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

declare const sideQuestionKey: unique symbol;
/** The prompt cache key every Side question thread of one main session shares. */
export type SideQuestionCacheKey = string & { readonly [sideQuestionKey]: true };

export function sideQuestionCacheKey(mainSessionId: string): SideQuestionCacheKey {
	return `${mainSessionId}:side-question:v1` as SideQuestionCacheKey;
}

type StreamOptions = Parameters<AgentSession["agent"]["streamFn"]>[2];

/**
 * Options for every mirror request. Codex routes on `parentSessionId`, and a
 * later thread read the earlier one's cached prefix only over SSE: 10 of 10
 * runs, against 0 of 5 on a new websocket with the same key.
 */
export function sideQuestionStreamOptions(
	key: SideQuestionCacheKey,
	options: StreamOptions,
): NonNullable<StreamOptions> & { preferWebsockets: false; parentSessionId: SideQuestionCacheKey } {
	return { ...options, preferWebsockets: false, parentSessionId: key };
}

/** No system prompt or tool list: copying the main ones let a Side question call `ask`, `bash`, and `write`. */
type MirrorSessionInput = Pick<
	CreateAgentSessionOptions,
	| "cwd"
	| "costGate"
	| "sessionManager"
	| "model"
	| "thinkingLevel"
	| "providerSessionId"
	| "modelRegistry"
	| "authStorage"
	| "settings"
	| "agentId"
	| "parentAgentId"
	| "localProtocolOptions"
	| "preloadedPreparedExtensions"
	| "preloadedExtensionPaths"
	| "extensionRoots"
> & { agentId: string; cacheKey: SideQuestionCacheKey };

async function createMirrorSession({ cacheKey, ...input }: MirrorSessionInput): Promise<AgentSession> {
	const { session } = await createAgentSession({
		...input,
		toolNames: SIDE_QUESTION_TOOLS,
		restrictToolNames: true,
		providerPromptCacheKey: cacheKey,
		hasUI: false,
		agentDisplayName: "side question",
		// A child session: binds no process-wide state and keeps the shared
		// `local://` mapping to itself instead of installing a global override.
		parentTaskPrefix: input.agentId,
		agentRegistry: new SideQuestionRegistry(),
		disableExtensionDiscovery: true,
	});
	const stream = session.agent.streamFn;
	session.agent.streamFn = (model, context, options) =>
		stream(model, context, sideQuestionStreamOptions(cacheKey, options));
	return session;
}

interface ContextFallback {
	model: NonNullable<AgentSession["model"]>;
	thinkingLevel: ReturnType<AgentSession["configuredThinkingLevel"]>;
	role: string;
}

/** One thread of Side questions: a mirror session that keeps its own history until disposed. */
export class SideQuestionThread {
	readonly #session: AgentSession;
	readonly #file: string;
	readonly #main: AgentSession;
	/** The main transcript whose ledger gets this thread's usage. */
	readonly #ledgerSessionId: string;
	readonly #cache: CacheMissTracker;
	#contextFallback: ContextFallback | undefined;
	#running = false;
	#disposed = false;
	/** The last question was cancelled; its prompt stays in the history, so the next one says so. */
	#lastCancelled = false;

	private constructor(
		session: AgentSession,
		file: string,
		main: AgentSession,
		ledgerSessionId: string,
		seededFrom: readonly unknown[],
		contextFallback: ContextFallback | undefined,
	) {
		this.#session = session;
		this.#file = file;
		this.#main = main;
		this.#ledgerSessionId = ledgerSessionId;
		this.#cache = cacheOf(main).thread(seededFrom);
		this.#contextFallback = contextFallback;
	}

	static async open(ctx: ExtensionContext): Promise<SideQuestionThread> {
		const main = liveSession(ctx);
		const parentFile = ctx.sessionManager.getSessionFile();
		const model = main?.model;
		if (!main || !parentFile || !model) throw new Error("Side questions need a saved main session.");
		const selected = await sideQuestionModel(main, ctx.cwd);
		if (selected?.warning) ctx.ui.notify(selected.warning, "warning");
		const contextFallback = selected?.model && (selected.model.provider !== model.provider || selected.model.id !== model.id)
			? {
					model,
					thinkingLevel: main.configuredThinkingLevel(),
					role: main.sessionManager.getLastModelChangeRole({ skipEphemeral: true }) ?? "default",
				}
			: undefined;
		await main.sessionManager.ensureOnDisk();
		await main.sessionManager.flush();

		const id = `SideQuestion-${crypto.randomUUID()}`;
		// Outside the sessions tree: omp-stats and the Agent Hub scan it, and
		// would count the mirror's usage again on top of the main ledger copy.
		const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-side-question-"));
		const file = path.join(sessionDir, `${id}.jsonl`);
		// The mirror reads the main session's `local://` files (pasted images,
		// large pastes) in place, as OMP's `/tan` does: a snapshot of the main
		// mapping, since the main session manager can switch transcripts.
		const parentArtifactsDir = main.sessionManager.getArtifactsDir();
		const parentLocalSessionId = main.sessionManager.getSessionId();
		let fork: SessionManager;
		try {
			fork = await SessionManager.forkFrom(parentFile, ctx.cwd, sessionDir, undefined, {
				copyArtifacts: false,
				suppressBreadcrumb: true,
				sessionFile: file,
				resetInheritedCost: true,
				repairInterruptedTail: true,
			});
		} catch (error) {
			await removeFork(file);
			throw error;
		}
		forwardSideQuestionUsage(fork, main.sessionManager, parentLocalSessionId);

		let mirror: AgentSession | undefined;
		const parentPreparedExtensions = main.preparedExtensions;
		const parentExtensionPaths = main.extensionPaths;
		const parentExtensionRoots = main.effectiveExtensionRoots;
		const seededFrom = [...main.agent.state.messages];
		try {
			if (selected?.model) fork.appendModelChange(`${selected.model.provider}/${selected.model.id}`, selected.role);
			mirror = await createMirrorSession({
				cwd: ctx.cwd,
				costGate: main.costGate,
				sessionManager: fork,
				model: selected?.model ?? model,
				thinkingLevel: selected?.model ? selected.thinkingLevel : main.configuredThinkingLevel(),
				providerSessionId: `${main.sessionId}:side-question:${id}`,
				cacheKey: sideQuestionCacheKey(main.sessionId),
				modelRegistry: main.modelRegistry,
				authStorage: main.modelRegistry.authStorage,
				settings: createSubagentSettings(main.settings),
				agentId: id,
				parentAgentId: ctx.agent.id,
				localProtocolOptions: {
					getArtifactsDir: () => parentArtifactsDir,
					getSessionId: () => parentLocalSessionId,
				},
				// The parent's extensions re-register its providers on the shared model registry.
				preloadedPreparedExtensions: parentPreparedExtensions?.length ? parentPreparedExtensions : undefined,
				preloadedExtensionPaths: parentExtensionPaths?.length ? [...parentExtensionPaths] : undefined,
				extensionRoots: () => parentExtensionRoots,
			});
			if (selected?.model) mirror.setThinkingLevel(selected.thinkingLevel);
			mirror.agent.replaceMessages(seedMessages(seededFrom));
		} catch (error) {
			try {
				await mirror?.dispose();
			} finally {
				await removeFork(file);
			}
			throw error;
		}
		return new SideQuestionThread(mirror, file, main, parentLocalSessionId, seededFrom, contextFallback);
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
				case "auto_retry_start":
				case "auto_retry_end":
				case "retry_fallback_applied":
					callbacks.onRecovery(event);
					break;
				case "message_start":
					if (event.message.role === "assistant") {
						text = "";
						callbacks.onMessageStart();
					}
					break;
				case "message_end": {
					recordSideQuestionUsage(this.#main.sessionManager, this.#ledgerSessionId, event.message);
					const missed = this.#cache.observe(event.message);
					if (missed !== undefined && cfgDisplayCacheMissMarker.get(this.#main.settings)) callbacks.onCacheMiss(missed);
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
			const fallback = this.#contextFallback;
			const window = this.#session.model?.contextWindow;
			if (fallback && window != null && window > 0) {
				const context = this.#session.getContextBreakdown();
				const tokenizer = this.#session.agent.tokenizer;
				const overhead = context
					? context.systemPromptTokens + context.systemToolsTokens + context.systemContextTokens + context.skillsTokens
					: tokenizer.countTokens(this.#session.systemPrompt);
				const pending = tokenizer.countMessages([{
					role: "user",
					content: [{ type: "text", text: message }, ...(images ?? [])],
					timestamp: Date.now(),
				}]);
				const tokens = overhead + tokenizer.countMessages(this.#session.agent.state.messages) + pending;
				if (tokens >= window) {
					await this.#session.setModel(fallback.model, fallback.role);
					this.#session.setThinkingLevel(fallback.thinkingLevel);
				}
			}
			this.#contextFallback = undefined;
			if (signal.aborted) throw new DOMException("Side question cancelled", "AbortError");
			await this.#session.prompt(message, { attribution: "user", images });
			await this.#session.waitForIdle();
			const last = this.#session.getLastAssistantMessage();
			if (signal.aborted) throw new DOMException("Side question cancelled", "AbortError");
			if (this.#session.costCapRefusal) throw new Error(this.#session.costCapRefusal.message);
			if (last?.stopReason === "error") throw new Error(last.errorMessage || "The side question failed.");
			return assistantText(last);
		} finally {
			signal.removeEventListener("abort", abort);
			unsubscribe();
			this.#running = false;
			this.#lastCancelled = signal.aborted;
		}
	}

	/** The tools the mirror's requests offer, for verification. */
	get toolNames(): string[] {
		return this.#session.agent.state.tools.map(tool => tool.name);
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

	/** Disposes the thread once it has opened, and settles when its files are removed; the next `get` opens a new one. */
	async dispose(): Promise<void> {
		const thread = this.#thread;
		this.#thread = undefined;
		await thread?.then(
			open => open.dispose(),
			() => {},
		);
	}
}

/** Removes the fork's temporary directory: the thread file and its artifacts. */
async function removeFork(file: string): Promise<void> {
	await fs.rm(path.dirname(file), { recursive: true, force: true });
}
