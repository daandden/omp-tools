import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

/** Index of the earlier concern the fake judge matches, or "none". */
type Decide = (note: string, earlier: string[]) => number | "none" | Promise<number | "none">;

let nativeJudge = true;
let decide: Decide = () => "none";

mock.module("@oh-my-pi/pi-coding-agent/judgment", () => ({
	hasNativeJudge: () => nativeJudge,
	journalJudgmentUsage: () => undefined,
	sharedJudgmentCache: () => undefined,
	resolveJudge: () => ({
		label: "fake judge",
		async judge(request: {
			state: { earlier_concerns: Record<string, string>; new_concerns: Record<string, string> };
			questions: Record<string, unknown>;
		}) {
			const earlier = Object.values(request.state.earlier_concerns);
			const answers: Record<string, unknown> = {};
			for (const id of Object.keys(request.questions)) {
				const match = await decide(request.state.new_concerns[id] ?? "", earlier);
				answers[id] = { type: "choice", choice: match === "none" ? "none" : `c${match}`, confidence: 1, probabilities: {} };
			}
			return { answers };
		},
	}),
}));

const { default: advisorConcernWake } = await import("../extensions/advisor-concern-wake");

const STALLED = /changed no files after the last concern/;
const CEILING = /6 wakes in this prompt cycle/;

interface Harness {
	wakes: { content: string }[];
	notices: string[];
	concern(note: string): Promise<void>;
	/** The agent turn the wake started, with the tools it ran. */
	wokenTurn(tools: { name: string; isError?: boolean }[]): void;
	userPrompt(): void;
}

function harness(): Harness {
	const handlers = new Map<string, ((event: unknown, ctx: ExtensionContext) => unknown)[]>();
	const wakes: { content: string }[] = [];
	const notices: string[] = [];
	const pi = {
		on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		sendMessage: (message: { content: string }) => wakes.push(message),
	};
	const ctx = {
		mode: "tui",
		hasUI: true,
		ui: { notify: (text: string) => notices.push(text) },
		isIdle: () => true,
		hasPendingMessages: () => false,
		setInterval: (fn: () => void) => setInterval(fn, 1),
		clearTimer: (timer: Timer) => clearInterval(timer),
		modelRegistry: {},
		model: undefined,
		sessionManager: { getSessionId: () => "session" },
	} as unknown as ExtensionContext;
	const emit = (name: string, event: unknown = {}) => {
		for (const handler of handlers.get(name) ?? []) handler(event, ctx);
	};
	advisorConcernWake(pi as unknown as ExtensionAPI);
	return {
		wakes,
		notices,
		async concern(note) {
			emit("message_end", {
				message: { role: "custom", customType: "advisor", details: { notes: [{ note, severity: "concern" }] } },
			});
			await Bun.sleep(30);
		},
		wokenTurn(tools) {
			emit("agent_start");
			emit("message_start", { message: { role: "assistant" } });
			for (const tool of tools) {
				emit("tool_execution_end", { toolName: tool.name, isError: tool.isError ?? false });
			}
			emit("agent_end");
		},
		userPrompt() {
			emit("before_agent_start");
			emit("agent_start");
			emit("message_start", { message: { role: "assistant" } });
			emit("agent_end");
		},
	};
}

beforeEach(() => {
	nativeJudge = true;
	decide = () => "none";
});

describe("advisor concern wake", () => {
	test("new concerns that each lead to file changes wake up to six times, then notify", async () => {
		const h = harness();
		for (let i = 1; i <= 6; i++) {
			await h.concern(`Problem number ${i} in module ${i}.`);
			expect(h.wakes).toHaveLength(i);
			h.wokenTurn([{ name: "edit" }]);
		}
		await h.concern("Problem number 7 in module 7.");
		expect(h.wakes).toHaveLength(6);
		expect(h.notices).toHaveLength(1);
		expect(h.notices[0]).toMatch(CEILING);
		// The card is already in the agent's context; the wake never repeats the note.
		expect(h.wakes.every(w => !w.content.includes("Problem number"))).toBe(true);
	});

	test("a concern the judge matches to an earlier one stays a card without a notice", async () => {
		const h = harness();
		await h.concern("This function can return null.");
		h.wokenTurn([{ name: "edit" }]);
		decide = (note, earlier) => (note.includes("null") ? earlier.indexOf("This function can return null.") : "none");
		await h.concern("Make sure that this function cannot return null.");
		expect(h.wakes).toHaveLength(1);
		expect(h.notices).toEqual([]);
	});

	test("a new concern after a woken turn that changed nothing notifies instead of waking", async () => {
		const h = harness();
		await h.concern("This function can return null.");
		h.wokenTurn([{ name: "read" }, { name: "edit", isError: true }]);
		await h.concern("The README does not describe the timeout option.");
		expect(h.wakes).toHaveLength(1);
		expect(h.notices).toHaveLength(1);
		expect(h.notices[0]).toMatch(STALLED);
	});

	test("a wake that started no turn counts as no change", async () => {
		const h = harness();
		await h.concern("This function can return null.");
		await h.concern("The README does not describe the timeout option.");
		expect(h.wakes).toHaveLength(1);
		expect(h.notices[0]).toMatch(STALLED);
	});

	test.each([
		["no native judge", false, (() => "none") as Decide],
		[
			"a failing judge",
			true,
			(() => {
				throw new Error("judge down");
			}) as Decide,
		],
	])("with %s, word overlap decides whether a concern is new", async (_label, native, judge) => {
		nativeJudge = native;
		decide = judge;
		const h = harness();
		await h.concern("The test for the parser is missing.");
		h.wokenTurn([{ name: "write" }]);
		await h.concern("The test for the parser is missing in this file.");
		expect(h.wakes).toHaveLength(1);
		await h.concern("The README does not describe the timeout option.");
		expect(h.wakes).toHaveLength(2);
	});

	test("a user prompt starts a new cycle", async () => {
		const h = harness();
		await h.concern("This function can return null.");
		h.wokenTurn([{ name: "read" }]);
		h.userPrompt();
		decide = () => 0;
		await h.concern("This function can return null.");
		expect(h.wakes).toHaveLength(2);
		expect(h.notices).toEqual([]);
	});

	test("a user prompt during the judge call drops the wake", async () => {
		const h = harness();
		await h.concern("This function can return null.");
		h.wokenTurn([{ name: "edit" }]);
		let release: (value: "none") => void = () => {};
		decide = () => new Promise(resolve => (release = resolve));
		const arriving = h.concern("The README does not describe the timeout option.");
		await Bun.sleep(10);
		h.userPrompt();
		release("none");
		await arriving;
		expect(h.wakes).toHaveLength(1);
		expect(h.notices).toEqual([]);
	});

	test("a turn that the user did not start, during the judge call, drops the wake", async () => {
		const h = harness();
		await h.concern("This function can return null.");
		h.wokenTurn([{ name: "edit" }]);
		let release: (value: "none") => void = () => {};
		decide = () => new Promise(resolve => (release = resolve));
		const arriving = h.concern("The README does not describe the timeout option.");
		await Bun.sleep(10);
		// A blocker or another extension starts and finishes a turn; the agent is idle again.
		h.wokenTurn([{ name: "edit" }]);
		release("none");
		await arriving;
		expect(h.wakes).toHaveLength(1);
		expect(h.notices).toEqual([]);
	});
});
