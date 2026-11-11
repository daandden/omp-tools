import { describe, expect, test } from "bun:test";
import { SessionManager } from "@oh-my-pi/pi-coding-agent";

const {
	cacheMissTokens,
	forwardSideQuestionUsage,
	recordSideQuestionUsage,
	sharedPrefixPrompt,
	SideQuestionCache,
	sideQuestionCacheKey,
	sideQuestionStreamOptions,
} = await import("../extensions/side-question");
const { answerInto, newTurn } = await import("../extensions/side-question-view");

const usage = (cacheRead: number, cacheWrite: number, input = 4) => ({ input, cacheRead, cacheWrite });
const reply = (cacheRead: number, cacheWrite: number, stopReason = "stop") => ({
	role: "assistant",
	provider: "fixture",
	model: "primary",
	stopReason,
	usage: usage(cacheRead, cacheWrite),
});

describe("cacheMissTokens", () => {
	test("reports the prefix a request had to write again instead of reading", () => {
		// A follow-up in a long thread: the previous request was 230,220 tokens, only the head was read.
		expect(cacheMissTokens(230_220, usage(15_825, 214_391))).toBe(214_395);
	});

	test("a request that reads the expected prefix is a hit", () => {
		expect(cacheMissTokens(230_220, usage(230_216, 1_814, 2))).toBeUndefined();
		expect(cacheMissTokens(230_220, usage(232_030, 326))).toBeUndefined();
	});

	test("ignores a shortfall up to 2048 tokens and reports one above it", () => {
		expect(cacheMissTokens(100_000, usage(97_952, 500))).toBeUndefined();
		expect(cacheMissTokens(100_000, usage(97_951, 500))).toBe(2_049);
	});

	test("never reports on providers that write no cache, as OMP's marker does", () => {
		expect(cacheMissTokens(13_370, usage(0, 0, 13_370))).toBeUndefined();
		expect(cacheMissTokens(13_370, usage(0, 13_370, 0))).toBe(13_370);
	});

	test("needs an expected prefix worth caching", () => {
		expect(cacheMissTokens(undefined, usage(0, 30_000))).toBeUndefined();
		expect(cacheMissTokens(2_000, usage(0, 2_000))).toBeUndefined();
		expect(cacheMissTokens(4_000, usage(0, 4_000))).toBe(4_000);
	});
});

describe("SideQuestionCache", () => {
	const a = { role: "user" };
	const b = { role: "assistant" };

	test("a first thread's first request reports nothing, and a short follow-up reports a miss", () => {
		const tracker = new SideQuestionCache().thread([a, b]);
		expect(tracker.observe(reply(0, 30_000))).toBeUndefined();
		expect(tracker.observe(reply(15_000, 15_004))).toBe(15_004);
	});

	test("a cut-off request changes nothing", () => {
		const tracker = new SideQuestionCache().thread([a, b]);
		tracker.observe(reply(0, 30_000));
		expect(tracker.observe(reply(0, 2_000, "aborted"))).toBeUndefined();
		expect(tracker.observe(reply(0, 30_004))).toBe(30_004);
	});

	test("a later thread's first request is checked against the earlier thread's first prompt", () => {
		// The first thread's first request: 4 input + 27,640 written = a 27,644-token prompt.
		const opened = () => {
			const cache = new SideQuestionCache();
			const first = cache.thread([a, b]);
			first.observe(reply(0, 27_640));
			first.observe(reply(27_640, 200));
			return cache;
		};
		expect(opened().thread([a, b, { role: "user" }]).observe(reply(27_520, 124))).toBeUndefined();
		expect(opened().thread([a, b, { role: "user" }]).observe(reply(10_624, 17_020))).toBe(17_020);
		expect(opened().thread([{ role: "user" }, b]).observe(reply(10_624, 17_020))).toBeUndefined();
	});

	test("a thread opened before the earlier one's first request finished expects nothing", () => {
		const cache = new SideQuestionCache();
		const first = cache.thread([a, b]);
		const early = cache.thread([a, b]);
		first.observe(reply(0, 27_640));
		expect(early.observe(reply(0, 27_640))).toBeUndefined();
		expect(cache.thread([a, b]).observe(reply(0, 27_640))).toBe(27_644);
	});

	test("model and provider changes start fresh expectations while repeated models remain checked", () => {
		const cache = new SideQuestionCache();
		const tracker = cache.thread([a, b]);
		const modelReply = (provider: string, model: string, cacheRead = 0) => ({
			...reply(cacheRead, 30_000),
			provider,
			model,
		});
		expect(tracker.observe(modelReply("one", "primary"))).toBeUndefined();
		expect(tracker.observe(modelReply("one", "backup"))).toBeUndefined();
		expect(tracker.observe(modelReply("two", "backup"))).toBeUndefined();
		expect(tracker.observe(modelReply("one", "backup"))).toBe(30_004);
		expect(tracker.observe(modelReply("one", "primary"))).toBe(30_004);
		expect(cache.thread([a, b]).observe(modelReply("three", "backup"))).toBeUndefined();
		expect(cache.thread([a, b]).observe(modelReply("one", "backup"))).toBe(30_004);
	});
});

describe("sharedPrefixPrompt", () => {
	const a = { role: "user" };
	const b = { role: "assistant" };
	const earlier = { messages: [a, b], prompt: 27_644 };

	test("expects the earlier first prompt while the main messages still start with the ones it saw", () => {
		expect(sharedPrefixPrompt(earlier, [a, b, { role: "user" }, { role: "assistant" }])).toBe(27_644);
	});

	test("expects nothing after compaction or a branch change, or with no earlier thread", () => {
		expect(sharedPrefixPrompt(earlier, [{ role: "user" }, b])).toBeUndefined();
		expect(sharedPrefixPrompt(earlier, [a])).toBeUndefined();
		expect(sharedPrefixPrompt(undefined, [a, b])).toBeUndefined();
		expect(sharedPrefixPrompt(earlier, [a, b])).toBe(27_644);
	});
});

describe("recordSideQuestionUsage", () => {
	const answered = {
		role: "assistant",
		api: "openai-codex-responses",
		provider: "openai-codex",
		model: "gpt-5.6-luna",
		stopReason: "stop",
		usage: {
			input: 120,
			output: 6,
			cacheRead: 27_520,
			cacheWrite: 0,
			totalTokens: 27_646,
			cost: { input: 0.000024, output: 0.0000072, cacheRead: 0.0005504, cacheWrite: 0, total: 0.0005816 },
		},
	};
	const sideEntries = (ledger: SessionManager) =>
		ledger.getEntries().filter(entry => entry.type === "model_usage" && entry.purpose === "side-question");

	test("each Side question request leaves one side-question entry in the main session's ledger", () => {
		const ledger = SessionManager.inMemory();
		recordSideQuestionUsage(ledger, ledger.getSessionId(), answered);
		recordSideQuestionUsage(ledger, ledger.getSessionId(), { ...answered, stopReason: "aborted" });
		const entries = sideEntries(ledger);
		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({ provider: "openai-codex", model: "gpt-5.6-luna", usage: answered.usage });
		expect(entries[1]).toMatchObject({ stopReason: "aborted" });
	});

	test("leaves nothing for a message without usage, or after the main session switched transcripts", () => {
		const ledger = SessionManager.inMemory();
		recordSideQuestionUsage(ledger, ledger.getSessionId(), { role: "user", content: [] });
		recordSideQuestionUsage(ledger, ledger.getSessionId(), { ...answered, usage: undefined });
		recordSideQuestionUsage(ledger, "another-session", answered);
		expect(sideEntries(ledger)).toHaveLength(0);
		recordSideQuestionUsage(ledger, ledger.getSessionId(), answered);
		expect(sideEntries(ledger)).toHaveLength(1);
	});

	test("usage the mirror records off its transcript, such as a cache warm, also reaches the main ledger", () => {
		const ledger = SessionManager.inMemory();
		const fork = SessionManager.inMemory();
		forwardSideQuestionUsage(fork, ledger, ledger.getSessionId());
		const { role: _role, ...usage } = answered;
		fork.appendModelUsage(
			{ ...usage, stopReason: "stop", purpose: "cache-warm" },
			{ sessionId: fork.getSessionId(), parentId: null },
		);
		const forwarded = ledger.getEntries().filter(entry => entry.type === "model_usage");
		expect(forwarded).toHaveLength(1);
		expect(forwarded[0]).toMatchObject({ purpose: "side-question:cache-warm", usage: answered.usage });
		expect(fork.getEntries().filter(entry => entry.type === "model_usage")).toHaveLength(1);
	});
});

describe("sideQuestionCacheKey", () => {
	test("every thread of one main session shares a key that is not the main session's own", () => {
		expect(sideQuestionCacheKey("main-1")).toBe(sideQuestionCacheKey("main-1"));
		expect(sideQuestionCacheKey("main-1")).not.toBe("main-1");
		expect(sideQuestionCacheKey("main-1")).not.toBe(sideQuestionCacheKey("main-2"));
	});
});

describe("sideQuestionStreamOptions", () => {
	test("routes every request to the Side key over SSE and keeps the other options", () => {
		const key = sideQuestionCacheKey("main-1");
		const options = sideQuestionStreamOptions(key, { sessionId: "thread-a", preferWebsockets: true, maxTokens: 64 });
		expect(options).toEqual({ sessionId: "thread-a", preferWebsockets: false, maxTokens: 64, parentSessionId: key });
	});

	test("works when the agent passes no options", () => {
		const key = sideQuestionCacheKey("main-1");
		expect(sideQuestionStreamOptions(key, undefined)).toEqual({ preferWebsockets: false, parentSessionId: key });
	});
});

type Callbacks = Parameters<Parameters<typeof answerInto>[1]>[0];
const toolCall = (id: string, status: "running" | "done" = "done") => ({ id, name: "read", target: id, status });

describe("answerInto", () => {
	test("keeps every message's text, in order with the tool calls between them", async () => {
		const turn = newTurn("q");
		await answerInto(
			turn,
			async (on: Callbacks) => {
				on.onMessageStart();
				on.onText("Let me");
				on.onText("Let me check.");
				on.onToolCall(toolCall("a", "running"));
				on.onToolCall(toolCall("b"));
				on.onToolCall(toolCall("a"));
				on.onMessageStart();
				on.onToolCall(toolCall("c"));
				on.onMessageStart();
				on.onText("The answer.");
				return "The answer.";
			},
			() => {},
		);
		expect(turn.status).toBe("complete");
		expect(turn.parts).toEqual([
			{ type: "text", text: "Let me check." },
			{ type: "tools", calls: [toolCall("a"), toolCall("b"), toolCall("c")] },
			{ type: "text", text: "The answer." },
		]);
	});

	test("a message with text right after another never replaces it", async () => {
		const turn = newTurn("q");
		await answerInto(
			turn,
			async (on: Callbacks) => {
				on.onMessageStart();
				on.onText("First.");
				on.onMessageStart();
				on.onText("Second.");
				return "Second.";
			},
			() => {},
		);
		expect(turn.parts).toEqual([
			{ type: "text", text: "First." },
			{ type: "text", text: "Second." },
		]);
	});

	test("shows the final answer when the provider streamed none of it", async () => {
		const turn = newTurn("q");
		await answerInto(
			turn,
			async (on: Callbacks) => {
				on.onMessageStart();
				on.onText("Looking.");
				on.onToolCall(toolCall("a"));
				on.onMessageStart();
				return "Done.";
			},
			() => {},
		);
		expect(turn.parts).toEqual([
			{ type: "text", text: "Looking." },
			{ type: "tools", calls: [toolCall("a")] },
			{ type: "text", text: "Done." },
		]);
	});
});
