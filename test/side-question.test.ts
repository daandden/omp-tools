import { describe, expect, test } from "bun:test";

const { cacheMissTokens, seedMessages } = await import("../extensions/side-question");
const { answerInto, newTurn } = await import("../extensions/side-question-view");

const usage = (cacheRead: number, cacheWrite: number, input = 4) => ({ input, cacheRead, cacheWrite });

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
	});

	test("needs an expected prefix worth caching; a thread's first request has none", () => {
		expect(cacheMissTokens(undefined, usage(0, 30_000))).toBeUndefined();
		expect(cacheMissTokens(2_000, usage(0, 2_000))).toBeUndefined();
	});
});

const user = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });
const call = (id: string, name: string) => ({ type: "toolCall", id, name, arguments: {} });
const assistant = (...calls: ReturnType<typeof call>[]) => ({
	role: "assistant",
	content: [{ type: "text", text: "working" }, ...calls],
	stopReason: calls.length > 0 ? "toolUse" : "stop",
	timestamp: 2,
});
const result = (id: string, name: string) => ({
	role: "toolResult",
	toolCallId: id,
	toolName: name,
	content: [{ type: "text", text: "ok" }],
	isError: false,
	timestamp: 3,
});

describe("seedMessages", () => {
	test("copies a settled conversation unchanged", () => {
		const messages = [user("hi"), assistant(call("c1", "read")), result("c1", "read"), assistant()];
		expect(seedMessages(messages)).toEqual(messages);
	});

	test("changes to the copy never reach the main session's messages", () => {
		const messages = [user("hi"), user("there")];
		const copy = seedMessages(messages) as typeof messages;
		copy[0]!.content[0]!.text = "changed";
		copy.push(user("more"));
		expect(messages[0]!.content[0]!.text).toBe("hi");
		expect(messages).toHaveLength(2);
	});

	test("closes each call the main agent still waits on as still open, never as failed", () => {
		const messages = [user("pick"), assistant(call("c1", "read"), call("c2", "ask"), call("c3", "bash")), result("c1", "read")];
		const seeded = seedMessages(messages) as Record<string, unknown>[];
		expect(seeded).toHaveLength(5);
		expect(seeded.slice(0, 3)).toEqual(messages as never);
		const pending = seeded.slice(3);
		expect(pending.map(message => message.toolCallId)).toEqual(["c2", "c3"]);
		for (const message of pending) expect(message).toMatchObject({ role: "toolResult", isError: false });
		const texts = pending.map(message => (message.content as { text: string }[])[0]!.text);
		// A pending ask is the user answering now, not a call still running.
		expect(texts[0]).not.toBe(texts[1]);
		for (const text of texts) expect(text).not.toMatch(/abort|fail/i);
	});

	test("leaves earlier replies alone; only the last one can be in flight", () => {
		const messages = [user("a"), assistant(call("old", "read")), user("b"), assistant()];
		expect(seedMessages(messages)).toEqual(messages);
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
