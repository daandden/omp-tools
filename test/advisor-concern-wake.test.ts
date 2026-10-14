import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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
const { PICKER_ANSWERED } = await import("../extensions/deferred-notes");

const STALLED = /changed no files after the last concern/;
const CEILING = /6 wakes in this prompt cycle/;

interface Sent {
	customType: string;
	content: string;
	details?: { notes: { note: string; severity?: string }[] };
	deliverAs?: string;
}

interface Harness {
	wakes: Sent[];
	releases: Sent[];
	notices: string[];
	concern(note: string): Promise<void>;
	/** The agent turn the wake started, with the tools it ran. */
	wokenTurn(tools: { name: string; isError?: boolean }[]): void;
	userPrompt(): void;
	/** A user prompt whose run is still going: core defers concerns until it ends. */
	startRun(): void;
	/** A prompt typed while the run goes on: core emits `before_agent_start` but no `agent_start`. */
	queuedPrompt(): void;
	/** The advisor answers one `advise` call; core logs it to the advisor transcript. */
	advise(note: string, severity: "nit" | "concern" | "blocker", ack: "deferred" | "delivered"): void;
	pickerAnswered(): void;
}

let sessionDir: string;

function harness(): Harness {
	const handlers = new Map<string, ((event: unknown, ctx: ExtensionContext) => unknown)[]>();
	const bus = new Map<string, ((data: unknown) => void)[]>();
	const wakes: Sent[] = [];
	const releases: Sent[] = [];
	const notices: string[] = [];
	const sessionFile = `${sessionDir}.jsonl`;
	const pi = {
		on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		events: {
			on: (channel: string, handler: (data: unknown) => void) => {
				bus.set(channel, [...(bus.get(channel) ?? []), handler]);
			},
		},
		sendMessage: (message: Sent, options: { deliverAs?: string }) =>
			(message.customType === "advisor" ? releases : wakes).push({ ...message, deliverAs: options.deliverAs }),
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
		sessionManager: { getSessionId: () => "session", getSessionFile: () => sessionFile },
	} as unknown as ExtensionContext;
	const emit = (name: string, event: unknown = {}) => {
		for (const handler of handlers.get(name) ?? []) handler(event, ctx);
	};
	const card = (notes: { note: string; severity: string }[]) =>
		emit("message_end", { message: { role: "custom", customType: "advisor", details: { notes } } });
	advisorConcernWake(pi as unknown as ExtensionAPI);
	return {
		wakes,
		releases,
		notices,
		async concern(note) {
			card([{ note, severity: "concern" }]);
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
		startRun() {
			emit("before_agent_start");
			emit("agent_start");
			emit("message_start", { message: { role: "assistant" } });
		},
		queuedPrompt() {
			emit("before_agent_start");
		},
		advise(note, severity, ack) {
			const text = ack === "deferred" ? "Queued for the end of the turn. Do not re-raise." : "Delivered.";
			const message = {
				role: "toolResult",
				toolCallId: `call-${note.length}`,
				toolName: "advise",
				content: [{ type: "text", text }],
				details: { note, severity },
				isError: false,
			};
			fs.appendFileSync(path.join(sessionDir, "__advisor.jsonl"), `${JSON.stringify({ type: "message", message })}\n`);
		},
		pickerAnswered() {
			for (const handler of bus.get(PICKER_ANSWERED) ?? []) handler({ sessionFile });
		},
	};
}

beforeEach(() => {
	sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-tools-wake-"));
});

afterEach(() => {
	fs.rmSync(sessionDir, { recursive: true, force: true });
});

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

describe("release of deferred concerns at a Picker answer", () => {
	test("steers the run's deferred concerns as one advisor card, without nits, delivered notes, or earlier runs", () => {
		const h = harness();
		h.advise("An earlier run's concern.", "concern", "deferred");
		h.startRun();
		h.advise("The parser drops the last line.", "concern", "deferred");
		h.advise("Rename this variable.", "nit", "deferred");
		h.advise("The cache key ignores the locale.", "concern", "delivered");
		h.advise("The test for the parser is missing.", "concern", "deferred");
		h.pickerAnswered();
		expect(h.releases).toHaveLength(1);
		expect(h.releases[0].deliverAs).toBe("steer");
		expect(h.releases[0].details?.notes.map(n => n.note)).toEqual([
			"The parser drops the last line.",
			"The test for the parser is missing.",
		]);
		expect(h.releases[0].content).toContain('<advisory severity="concern"');
		expect(h.releases[0].content).toContain("The parser drops the last line.");
		expect(h.wakes).toEqual([]);
	});

	test("releases each concern once and never one that a card already carried", async () => {
		const h = harness();
		h.startRun();
		h.advise("The parser drops the last line.", "concern", "deferred");
		await h.concern("The cache key ignores the locale.");
		h.advise("The cache key ignores the locale.", "concern", "deferred");
		h.pickerAnswered();
		h.pickerAnswered();
		expect(h.releases.map(r => r.details?.notes.map(n => n.note))).toEqual([["The parser drops the last line."]]);
	});

	test("the final-answer card with a released concern does not wake, but a new concern on it does", async () => {
		const h = harness();
		h.startRun();
		h.advise("The parser drops the last line.", "concern", "deferred");
		h.pickerAnswered();
		// The judge calls every concern new, so only the release record keeps the repeat from waking.
		await h.concern("The parser drops the last line.");
		expect(h.wakes).toEqual([]);
		await h.concern("The README does not describe the timeout option.");
		expect(h.wakes).toHaveLength(1);
		expect(h.notices).toEqual([]);
	});

	test("a prompt queued during the run keeps the release, so the final-answer card does not wake", async () => {
		const h = harness();
		h.startRun();
		h.advise("The parser drops the last line.", "concern", "deferred");
		h.pickerAnswered();
		h.queuedPrompt();
		await h.concern("The parser drops the last line.");
		expect(h.wakes).toEqual([]);
	});
});
