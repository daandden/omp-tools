import { expect, spyOn, test } from "bun:test";
import { answerInto, newTurn, SideQuestionTurnView } from "../extensions/side-question-view";
import type { SideQuestionCallbacks } from "../extensions/side-question";

function pendingAnswer() {
	const turn = newTurn("Why is this request waiting?");
	let callbacks!: SideQuestionCallbacks;
	let resolve!: (answer: string) => void;
	const done = answerInto(turn, on => {
		callbacks = on;
		return new Promise<string>(finish => { resolve = finish; });
	}, () => {});
	return { turn, callbacks, done, resolve };
}

const view = () => new SideQuestionTurnView("Answering…");
const lines = (turn: ReturnType<typeof newTurn>) => view().lines(turn, 120, false).map(Bun.stripANSI).join("\n");

test("a retry countdown is visible in both renderers and ends when the next request starts", async () => {
	const clock = spyOn(Date, "now").mockReturnValue(10_000);
	const pending = pendingAnswer();
	try {
		pending.callbacks.onRecovery({
			type: "auto_retry_start", attempt: 2, maxAttempts: 10, delayMs: 8_000, errorMessage: "overloaded",
		});
		expect(lines(pending.turn)).toMatch(/2\/10.*8(?:\.0)?s/);
		clock.mockReturnValue(15_000);
		expect(lines(pending.turn)).toMatch(/2\/10.*3(?:\.0)?s/);
		expect(JSON.stringify(view().describe(pending.turn, 0, false))).toMatch(/2\/10.*3(?:\.0)?s/);
		pending.callbacks.onMessageStart();
		expect(lines(pending.turn)).not.toContain("Retrying");
		pending.resolve("Recovered.");
		await pending.done;
		expect(lines(pending.turn)).toContain("Recovered.");
	} finally {
		pending.resolve("");
		await pending.done;
		clock.mockRestore();
	}
});

test("a model switch stays between the failed request and the fallback answer", async () => {
	const pending = pendingAnswer();
	pending.callbacks.onMessageStart();
	pending.callbacks.onText("Checking.");
	pending.callbacks.onRecovery({
		type: "retry_fallback_applied", from: "provider/primary", to: "provider/backup", role: "smol",
	});
	pending.callbacks.onMessageStart();
	pending.callbacks.onText("Recovered on backup.");
	pending.resolve("Recovered on backup.");
	await pending.done;
	const classic = lines(pending.turn);
	expect(classic.indexOf("Checking.")).toBeLessThan(classic.indexOf("provider/primary -> provider/backup"));
	expect(classic.indexOf("provider/primary -> provider/backup")).toBeLessThan(classic.indexOf("Recovered on backup."));
	const native = JSON.stringify(view().describe(pending.turn, 0, false));
	expect(native).toContain("provider/primary -> provider/backup");
	expect(native.indexOf("provider/primary -> provider/backup")).toBeLessThan(native.indexOf("Recovered on backup."));
});

test("exhausted recovery reports the attempt count and final failure in both renderers", async () => {
	const turn = newTurn("q");
	await answerInto(turn, async on => {
		on.onRecovery({ type: "auto_retry_end", success: false, attempt: 3, finalError: "quota exhausted" });
		throw new Error("quota exhausted");
	}, () => {});
	expect(turn.status).toBe("error");
	for (const rendered of [lines(turn), JSON.stringify(view().describe(turn, 0, false))]) {
		expect(rendered).toMatch(/3 attempts.*quota exhausted/);
	}
});

test("late recovery events cannot add notices to a cancelled turn", async () => {
	const pending = pendingAnswer();
	pending.turn.status = "cancelled";
	pending.callbacks.onRecovery({
		type: "retry_fallback_applied", from: "provider/primary", to: "provider/backup", role: "smol",
	});
	pending.resolve("Too late.");
	await pending.done;
	expect(pending.turn.parts).toEqual([]);
	expect(lines(pending.turn)).toContain("Cancelled");
});
