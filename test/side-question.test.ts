import { describe, expect, test } from "bun:test";

const { cacheMissTokens, seedMessages } = await import("../extensions/side-question");

const usage = (cacheRead: number, cacheWrite: number, input = 4) => ({ input, cacheRead, cacheWrite });

describe("cacheMissTokens", () => {
	test("reports the prefix a request had to write again instead of reading", () => {
		// The first /btw in a long compacted session: main prompt 230,220 tokens, only the head was read.
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

	test("needs an expected prefix worth caching", () => {
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

	test("closes each call the main agent is still waiting on with an aborted result", () => {
		const messages = [user("pick"), assistant(call("c1", "read"), call("c2", "ask")), result("c1", "read")];
		const seeded = seedMessages(messages);
		expect(seeded).toHaveLength(4);
		expect(seeded.slice(0, 3)).toEqual(messages);
		expect(seeded[3]).toMatchObject({
			role: "toolResult",
			toolCallId: "c2",
			toolName: "ask",
			isError: true,
			content: [{ type: "text", text: "Tool execution was aborted." }],
		});
	});

	test("leaves earlier replies alone; only the last one can be in flight", () => {
		const messages = [user("a"), assistant(call("old", "read")), user("b"), assistant()];
		expect(seedMessages(messages)).toEqual(messages);
	});
});
