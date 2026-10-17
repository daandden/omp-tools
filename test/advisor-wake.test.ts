import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
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

const { default: advisorWake } = await import("../extensions/advisor-wake");
const { PICKER_ANSWERED } = await import("../extensions/deferred-notes");
const { default: revisedAnswerPrompt } = await import("../extensions/advisor-wake.md", { with: { type: "text" } });
const { default: shortPrompt } = await import("../extensions/advisor-wake-short.md", { with: { type: "text" } });

const LONG_ANSWER = "word ".repeat(700);

const waiting = (count: number) => `advisor: ${count} note${count === 1 ? "" : "s"} waiting`;

interface Sent {
	customType: string;
	content: string;
	details?: { notes: { note: string; severity?: string }[] };
	deliverAs?: string;
	triggerTurn?: boolean;
}

interface Harness {
	wakes: Sent[];
	releases: Sent[];
	/** The footer status for notes the wake limit kept back; undefined when none. */
	readonly status: string | undefined;
	/** A concern card after the agent's last reply (text `answer`), a final answer unless `reply` says otherwise. */
	concern(note: string, reply?: string, answer?: string): Promise<void>;
	blocker(note: string, reply?: string, answer?: string): Promise<void>;
	/** Plan mode on (`"plan"`) or off (`"none"`), as core records it on the branch. */
	mode(mode: string): void;
	/** The agent turn the wake started. */
	wokenTurn(): void;
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
	let status: string | undefined;
	const branch: { type: string; mode?: string }[] = [];
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
		sendMessage: (message: Sent, options: { deliverAs?: string; triggerTurn?: boolean }) =>
			(message.customType === "advisor" ? releases : wakes).push({
				...message,
				deliverAs: options.deliverAs,
				triggerTurn: options.triggerTurn,
			}),
	};
	const ctx = {
		mode: "tui",
		hasUI: true,
		ui: {
			setStatus: (key: string, text: string | undefined) => {
				if (key === "advisor-wake") status = text;
			},
		},
		isIdle: () => true,
		hasPendingMessages: () => false,
		setInterval: (fn: () => void) => setInterval(fn, 1),
		clearTimer: (timer: Timer) => clearInterval(timer),
		modelRegistry: {},
		model: undefined,
		sessionManager: { getSessionId: () => "session", getSessionFile: () => sessionFile, getBranch: () => branch },
	} as unknown as ExtensionContext;
	const emit = (name: string, event: unknown = {}) => {
		for (const handler of handlers.get(name) ?? []) handler(event, ctx);
	};
	const card = async (notes: { note: string; severity: string }[], reply: string, answer: string) => {
		emit("message_end", { message: { role: "assistant", stopReason: reply, content: [{ type: "text", text: answer }] } });
		emit("message_end", { message: { role: "custom", customType: "advisor", details: { notes } } });
		await Bun.sleep(30);
	};
	advisorWake(pi as unknown as ExtensionAPI);
	return {
		wakes,
		releases,
		get status() {
			return status;
		},
		concern: (note, reply = "stop", answer = "Done.") => card([{ note, severity: "concern" }], reply, answer),
		blocker: (note, reply = "stop", answer = "Done.") => card([{ note, severity: "blocker" }], reply, answer),
		mode(mode) {
			branch.push({ type: "mode_change", mode });
		},
		wokenTurn() {
			emit("agent_start");
			emit("message_start", { message: { role: "assistant" } });
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

// The first wake loads the o200k_base table (~125 ms); the cards above wait only 30 ms.
beforeAll(async () => {
	sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-tools-wake-"));
	await harness().concern("Warm the token counter.");
	await Bun.sleep(500);
	fs.rmSync(sessionDir, { recursive: true, force: true });
});

beforeEach(() => {
	nativeJudge = true;
	decide = () => "none";
});

describe("advisor wake", () => {
	test("new concerns wake up to ten times, then count as waiting in the footer until the next prompt", async () => {
		const h = harness();
		for (let i = 1; i <= 10; i++) {
			await h.concern(`Problem number ${i} in module ${i}.`);
			expect(h.wakes).toHaveLength(i);
			h.wokenTurn();
		}
		await h.concern("Problem number 11 in module 11.");
		expect(h.wakes).toHaveLength(10);
		expect(h.status).toBe(waiting(1));
		await h.concern("Problem number 12 in module 12.");
		expect(h.status).toBe(waiting(2));
		// The card is already in the agent's context; the wake never repeats the note.
		expect(h.wakes.every(w => !w.content.includes("Problem number"))).toBe(true);
		h.userPrompt();
		expect(h.status).toBeUndefined();
		await h.concern("Problem number 13 in module 13.");
		expect(h.wakes).toHaveLength(11);
	});

	test("a blocker after the final answer wakes with a steer that starts a turn", async () => {
		const h = harness();
		await h.blocker("The smoke test for the Picker was not run.");
		expect(h.wakes).toHaveLength(1);
		expect(h.wakes[0].deliverAs).toBe("steer");
		expect(h.wakes[0].triggerTurn).toBe(true);
	});

	test("a final answer over 600 tokens gets the short prompt, and later wakes in the cycle keep it", async () => {
		const h = harness();
		await h.concern("This function can return null.", "stop", LONG_ANSWER);
		h.wokenTurn();
		await h.concern("The README does not describe the timeout option.", "stop", "Fixed.");
		expect(h.wakes.map(w => w.content)).toEqual([shortPrompt.trim(), shortPrompt.trim()]);
	});

	test("a short final answer gets the Revised answer prompt until the next user prompt", async () => {
		const h = harness();
		await h.concern("This function can return null.");
		h.wokenTurn();
		// A long wake reply is not the cycle's answer.
		await h.concern("The README does not describe the timeout option.", "stop", LONG_ANSWER);
		h.userPrompt();
		await h.concern("The cache key ignores the locale.", "stop", LONG_ANSWER);
		expect(h.wakes.map(w => w.content)).toEqual([revisedAnswerPrompt.trim(), revisedAnswerPrompt.trim(), shortPrompt.trim()]);
	});

	test.each([
		["the user stopped the run", "aborted"],
		["the run ended in an error", "error"],
		["the run is still calling tools", "toolUse"],
	])("a card does not wake when %s", async (_label, reply) => {
		const h = harness();
		await h.blocker("The smoke test for the Picker was not run.", reply);
		await h.concern("The README does not describe the timeout option.", reply);
		expect(h.wakes).toEqual([]);
	});

	test("a new concern after a woken turn that only wrote a Revised answer wakes", async () => {
		const h = harness();
		await h.concern("Drop the blanket refusal; explain how patching works.");
		h.wokenTurn();
		await h.concern("Warn that uninstalling the app in step 5 deletes its data.", "stop", "1. Decode… 5. Uninstall the original.");
		expect(h.wakes).toHaveLength(2);
		expect(h.status).toBeUndefined();
	});

	test("a concern raised again as a blocker wakes; the same blocker again does not", async () => {
		nativeJudge = false;
		const h = harness();
		await h.concern("The smoke test for the Picker was not run.");
		h.wokenTurn();
		await h.blocker("The smoke test for the Picker was not run.");
		expect(h.wakes).toHaveLength(2);
		h.wokenTurn();
		await h.blocker("The smoke test for the Picker was still not run.");
		await h.concern("The smoke test for the Picker was not run.");
		expect(h.wakes).toHaveLength(2);
		expect(h.status).toBeUndefined();
	});

	test("plan mode keeps the card without a wake until it ends", async () => {
		const h = harness();
		h.mode("plan");
		await h.blocker("The smoke test for the Picker was not run.");
		expect(h.wakes).toEqual([]);
		h.mode("none");
		await h.blocker("The cache key ignores the locale.");
		expect(h.wakes).toHaveLength(1);
	});

	test("a concern the judge matches to an earlier one stays a card and is not counted as waiting", async () => {
		const h = harness();
		await h.concern("This function can return null.");
		h.wokenTurn();
		decide = (note, earlier) => (note.includes("null") ? earlier.indexOf("This function can return null.") : "none");
		await h.concern("Make sure that this function cannot return null.");
		expect(h.wakes).toHaveLength(1);
		expect(h.status).toBeUndefined();
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
		h.wokenTurn();
		await h.concern("The test for the parser is missing in this file.");
		expect(h.wakes).toHaveLength(1);
		await h.concern("The README does not describe the timeout option.");
		expect(h.wakes).toHaveLength(2);
	});

	test("a user prompt starts a new cycle", async () => {
		const h = harness();
		await h.concern("This function can return null.");
		h.wokenTurn();
		h.userPrompt();
		decide = () => 0;
		await h.concern("This function can return null.");
		expect(h.wakes).toHaveLength(2);
	});

	test("a user prompt during the judge call drops the wake", async () => {
		const h = harness();
		await h.concern("This function can return null.");
		h.wokenTurn();
		let release: (value: "none") => void = () => {};
		decide = () => new Promise(resolve => (release = resolve));
		const arriving = h.concern("The README does not describe the timeout option.");
		await Bun.sleep(10);
		h.userPrompt();
		release("none");
		await arriving;
		expect(h.wakes).toHaveLength(1);
		expect(h.status).toBeUndefined();
	});

	test("a turn that the user did not start, during the judge call, drops the wake", async () => {
		const h = harness();
		await h.concern("This function can return null.");
		h.wokenTurn();
		let release: (value: "none") => void = () => {};
		decide = () => new Promise(resolve => (release = resolve));
		const arriving = h.concern("The README does not describe the timeout option.");
		await Bun.sleep(10);
		// A blocker or another extension starts and finishes a turn; the agent is idle again.
		h.wokenTurn();
		release("none");
		await arriving;
		expect(h.wakes).toHaveLength(1);
		expect(h.status).toBeUndefined();
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
		expect(h.status).toBeUndefined();
	});

	test("a blocker with the text of a released concern wakes as an escalation", async () => {
		nativeJudge = false;
		const h = harness();
		h.startRun();
		h.advise("The parser drops the last line.", "concern", "deferred");
		h.pickerAnswered();
		await h.blocker("The parser drops the last line.");
		expect(h.wakes).toHaveLength(1);
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
