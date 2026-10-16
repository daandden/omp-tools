// Advisor wake: starts a turn for advisor concerns and blockers that arrive
// after the agent's final answer and that core leaves without a turn. While a
// run continues, core defers nits and concerns and sends them only at the
// final answer; there, and after it, core only preserves a concern as a
// passive card. Core starts a turn for a late blocker, but not while its user
// interrupt flag (`autoResumeSuppressed`) is set. Esc, the Picker's cancel
// (`ctx.abort()`), and other user aborts set that flag, even while idle and
// without writing an `aborted` reply. Only a user prompt, a tree jump, or (in
// OMP after 18.11.1, PR #14831) `/retry` clears it, so a run that resumes any
// other way still ends with passive cards. Extensions cannot read the flag, so
// the rule is the outcome: a concern or blocker card that follows a final
// answer (an assistant reply with `stopReason: "stop"`) and that no turn picks
// up wakes the agent. A run
// the user stopped ends with an `aborted` reply, so its cards never wake. The
// preserved card is already in the agent's context (a developer `<advisory>`
// message), so the wake only points at it and never repeats the notes.
//
// It also releases deferred concerns when the user answers the Picker (Submit
// or timeout), so the agent reads them in its next model call instead of at
// its final answer. Core's deferred list is private and in memory, so the
// release reads the concerns from the advisor transcript (`deferred-notes.ts`)
// and steers them as an advisor card, as core steers a blocker. Core still
// sends them at the final answer; that card does not wake for released notes.
// A release is not a wake: it needs the user's answer, so checks 2 and 3 skip
// it. Released notes join check 1's earlier list. A release steers in plan
// mode too.
//
// The woken turn is itself reviewed and can raise another note, so wakes are
// gated per prompt cycle (one user prompt until the next) by three checks:
// 1. The note is new: an OMP judge call (TypeSafe Jev) or, without a native
//    judge, word overlap finds no earlier woken note with the same issue. A
//    concern is compared with every woken note, a blocker only with woken
//    blockers, so a concern raised again as a blocker is an escalation, as in
//    core's emission guard. A repeat stays a card; the agent already answered.
// 2. Concerns only: the last wake changed something, that is, the woken turn
//    ran a file-changing tool without error. A turn that only read and replied
//    means the agent did not agree; the user decides. Core never holds back a
//    blocker for an earlier quiet turn, so a blocker skips this check.
// 3. Fewer than MAX_WAKES_PER_PROMPT wakes, as a backstop.
// When check 2 or 3 holds back a new note, the user gets a notification.
//
// The wake is a `steer` with `triggerTurn`: it starts a turn while idle even
// with the interrupt flag set, which an `aside` does not (it folds into
// context), and core still queues it for ACP clients with
// `deferAgentInitiatedTurns`. Core never starts a turn for an advisor card in
// plan mode, so the wake reads plan mode from the branch's latest
// `mode_change` entry and skips it there. The `advisor.immuneTurns` cooldown
// is core-private and not applied.
//
// The first wake of a prompt cycle picks the prompt from the final answer's
// length; later wakes reuse it, so a brief wake reply is never measured as the
// answer. A final answer over REVISED_ANSWER_MAX_TOKENS (o200k_base) gets the
// short prompt, with no Revised answer rule, so the wake does not ask for a
// long answer again. A count that fails also gets the short prompt.
//
// Print and JSON mode (`omp -p`, `--mode json`, and headless hosts that keep
// the runner's "print" default) are skipped: after the last prompt, print mode
// switches the advisor to preserve-only, prints the final answer, waits for
// late notes, and disposes the session. A woken turn there would never be
// printed.
import type { Judge } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { logger, settings } from "@oh-my-pi/pi-coding-agent";
import type { AdvisorMessageDetails } from "@oh-my-pi/pi-tui/chat/messages";
import {
	hasNativeJudge,
	journalJudgmentUsage,
	resolveJudge,
	sharedJudgmentCache,
} from "@oh-my-pi/pi-coding-agent/judgment";
import wakePrompt from "./advisor-wake.md" with { type: "text" };
import shortWakePrompt from "./advisor-wake-short.md" with { type: "text" };
import { judgeRepeats, wordOverlapRepeats } from "./concern-match";
import {
	formatAdvisories,
	PICKER_ANSWERED,
	type PickerAnswered,
	readDeferredConcerns,
	type TranscriptSizes,
	transcriptSizes,
} from "./deferred-notes";

/** Backstop on wakes per prompt cycle; checks 1 and 2 normally stop a loop first. */
const MAX_WAKES_PER_PROMPT = 10;
/** Tools whose successful call in a woken turn counts as the agent acting on the notes. */
const CHANGING_TOOLS = new Set(["edit", "write", "ast_edit", "bash", "eval", "task"]);
/** A judge call slower than this falls back to word overlap. */
const JUDGE_TIMEOUT_MS = 15_000;
/** Core can preserve the card during the post-loop unwind, while the session still reports streaming. */
const IDLE_POLL_MS = 250;
const IDLE_WAIT_MAX_MS = 30_000;
/** A final answer longer than this, in o200k_base tokens, gets the short wake prompt. */
const REVISED_ANSWER_MAX_TOKENS = 600;

const STALLED_NOTICE =
	"Advisor concern not sent to the agent: the agent changed no files after the last wake. Send a prompt if you want the agent to act.";
const CEILING_NOTICE = `Advisor note not sent to the agent: ${MAX_WAKES_PER_PROMPT} wakes in this prompt cycle. Send a prompt if you want the agent to act.`;

/** An advisor card's details; `releasedBy` marks this extension's release card. */
interface CardDetails extends AdvisorMessageDetails {
	releasedBy?: "omp-tools";
}

/** A concern or blocker note that can wake the agent. */
interface WakeNote {
	note: string;
	blocker: boolean;
}

/** Whether plan mode is on; core never starts a turn for an advisor card there. */
function inPlanMode(ctx: ExtensionContext): boolean {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type === "mode_change") return entry.mode === "plan";
	}
	return false;
}

/** An advisor card's details; `releasedBy` marks this extension's release card. */
interface CardDetails extends AdvisorMessageDetails {
	releasedBy?: "omp-tools";
}

/** The `judge` role when it resolves to a native System One model (Jev); otherwise none. */
function nativeJudge(ctx: ExtensionContext): Judge | undefined {
	try {
		if (!hasNativeJudge(settings, ctx.modelRegistry)) return undefined;
		return resolveJudge({
			settings,
			registry: ctx.modelRegistry,
			sessionModel: ctx.model,
			sessionId: ctx.sessionManager.getSessionId(),
			purpose: "advisor-wake",
			onUsage: journalJudgmentUsage(ctx.sessionManager),
			cache: sharedJudgmentCache(),
		});
	} catch (err) {
		logger.debug("advisor-wake: judge unavailable", { err: String(err) });
		return undefined;
	}
}

/** For each of `notes`, whether it repeats one of `earlier` (check 1). */
async function findRepeats(ctx: ExtensionContext, notes: string[], earlier: string[]): Promise<boolean[]> {
	if (notes.length === 0 || earlier.length === 0) return notes.map(() => false);
	const judge = nativeJudge(ctx);
	if (judge) {
		try {
			return await judgeRepeats(judge, notes, earlier, { signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS) });
		} catch (err) {
			logger.debug("advisor-wake: judge failed, using word overlap", { err: String(err) });
		}
	}
	return wordOverlapRepeats(notes, earlier);
}

/** Check 1: a concern repeats any woken note; a blocker repeats only a woken blocker. */
async function freshNotes(ctx: ExtensionContext, notes: WakeNote[], woken: WakeNote[]): Promise<WakeNote[]> {
	const blockers = notes.filter(n => n.blocker);
	const concerns = notes.filter(n => !n.blocker);
	const [blockerRepeats, concernRepeats] = await Promise.all([
		findRepeats(
			ctx,
			blockers.map(n => n.note),
			woken.filter(n => n.blocker).map(n => n.note),
		),
		findRepeats(
			ctx,
			concerns.map(n => n.note),
			woken.map(n => n.note),
		),
	]);
	return [...blockers.filter((_, i) => !blockerRepeats[i]), ...concerns.filter((_, i) => !concernRepeats[i])];
}

let encoder: Promise<{ encode(text: string): number[] }> | undefined;

/** The o200k_base encoder, loaded on first use: its rank table is several MB. */
function o200kEncoder() {
	encoder ??= Promise.all([import("js-tiktoken/lite"), import("js-tiktoken/ranks/o200k_base")]).then(
		([{ Tiktoken }, { default: ranks }]) => new Tiktoken(ranks),
	);
	return encoder;
}

/** The wake prompt for a cycle whose final answer is `answer`. */
async function promptFor(answer: string): Promise<string> {
	try {
		const tokens = (await o200kEncoder()).encode(answer).length;
		return tokens > REVISED_ANSWER_MAX_TOKENS ? shortWakePrompt : wakePrompt;
	} catch (err) {
		encoder = undefined;
		logger.debug("advisor-wake: token count failed, using the short prompt", { err: String(err) });
		return shortWakePrompt;
	}
}

export default function advisorWake(pi: ExtensionAPI): void {
	/** Concern and blocker notes waiting for the agent to go idle. */
	let pending: WakeNote[] = [];
	/** Notes already woken for, or released, in this prompt cycle. */
	let woken: WakeNote[] = [];
	let wakes = 0;
	/** Check 2; true before the first wake of a cycle. */
	let lastWakeChangedFiles = true;
	let wakeTurn: "idle" | "sent" | "running" = "idle";
	/** The last assistant reply was a final answer, not a tool call, an error, or an interrupted reply. */
	let afterFinalAnswer = false;
	/** The text of the last final answer (assistant reply with `stopReason: "stop"`). */
	let lastAnswer = "";
	/** The prompt the cycle's first wake picked; later wakes reuse it. */
	let cyclePrompt: string | undefined;
	/**
	 * Bumped on every reset and on every assistant message, so a check that
	 * finishes afterwards is dropped: its notes left `pending` when it started,
	 * and a turn that ran meanwhile already had the cards in context.
	 */
	let generation = 0;
	let checking = false;
	let poll: Timer | undefined;
	/**
	 * Concern notes released at a Picker answer in the current run; core's card
	 * at the run's end repeats them and does not wake. Kept per run, not per
	 * prompt cycle: a prompt queued during the run fires `before_agent_start`
	 * with no new `agent_start`, and the run's final card still follows it.
	 */
	let released = new Set<string>();
	/** The current run's session and advisor transcript sizes at its start; deferred notes come after. */
	let run: { sessionFile: string | undefined; sizes: TranscriptSizes } | undefined;
	/** Notes that advisor cards carried in the current run, so a release never repeats them. */
	let carried = new Set<string>();

	const stopPoll = (ctx: ExtensionContext) => {
		if (poll) ctx.clearTimer(poll);
		poll = undefined;
	};

	const notify = (ctx: ExtensionContext, text: string) => {
		if (ctx.hasUI) ctx.ui.notify(text, "info");
	};

	const wake = async (ctx: ExtensionContext) => {
		if (checking) return;
		const notes = pending;
		pending = [];
		if (notes.length === 0 || ctx.hasPendingMessages() || inPlanMode(ctx)) return;
		const started = generation;
		checking = true;
		try {
			const [fresh, prompt] = await Promise.all([freshNotes(ctx, notes, woken), cyclePrompt ?? promptFor(lastAnswer)]);
			if (started !== generation || !ctx.isIdle() || ctx.hasPendingMessages()) return;
			if (fresh.length === 0) return;
			if (!lastWakeChangedFiles && !fresh.some(n => n.blocker)) {
				notify(ctx, STALLED_NOTICE);
				return;
			}
			if (wakes >= MAX_WAKES_PER_PROMPT) {
				notify(ctx, CEILING_NOTICE);
				return;
			}
			woken.push(...fresh);
			wakes++;
			lastWakeChangedFiles = false;
			wakeTurn = "sent";
			cyclePrompt = prompt;
			// An idle steer with `triggerTurn` starts a turn even while core's user
			// interrupt flag is set; an `aside` folds into context there.
			pi.sendMessage(
				{ customType: "advisor-wake", content: prompt.trim(), display: true },
				{ deliverAs: "steer", triggerTurn: true },
			);
		} finally {
			checking = false;
			// Cards that arrived during the check wait for their own pass.
			if (pending.length > 0) scheduleWake(ctx);
		}
	};

	const scheduleWake = (ctx: ExtensionContext) => {
		if (poll) return;
		const deadline = Date.now() + IDLE_WAIT_MAX_MS;
		poll = ctx.setInterval(() => {
			if (pending.length === 0 || Date.now() > deadline) {
				stopPoll(ctx);
				return;
			}
			if (!ctx.isIdle() || checking) return;
			stopPoll(ctx);
			void wake(ctx);
		}, IDLE_POLL_MS);
	};

	const resetCycle = () => {
		generation++;
		woken = [];
		wakes = 0;
		lastWakeChangedFiles = true;
		wakeTurn = "idle";
		cyclePrompt = undefined;
	};
	// Fires for every user-authored prompt in every mode (TUI, print, RPC, ACP,
	// SDK), including queued user messages, but not for this extension's own
	// agent-initiated turn. `input` would only cover the TUI editor.
	pi.on("before_agent_start", resetCycle);

	// The runner (and its managed timers) survives /new, /resume, forks, and
	// /tree jumps. Drop held notes and any running check before the transition
	// so an old conversation's note never lands in the new one; start the new
	// conversation with a fresh cycle.
	const forgetPending = (_event: unknown, ctx: ExtensionContext) => {
		pending = [];
		afterFinalAnswer = false;
		generation++;
		stopPoll(ctx);
	};
	pi.on("session_before_switch", forgetPending);
	pi.on("session_before_branch", forgetPending);
	pi.on("session_before_tree", forgetPending);
	pi.on("session_switch", resetCycle);
	pi.on("session_branch", resetCycle);
	pi.on("session_tree", resetCycle);

	// Check 2 watches only the turn this extension started. Core flushes
	// deferred notes at the end of each run, so a run's deferred notes are the
	// ones logged after it starts.
	pi.on("agent_start", (_event, ctx) => {
		if (wakeTurn === "sent") wakeTurn = "running";
		const sessionFile = ctx.sessionManager.getSessionFile();
		run = { sessionFile, sizes: transcriptSizes(sessionFile) };
		carried = new Set();
		released = new Set();
	});
	pi.on("tool_execution_end", event => {
		if (wakeTurn === "running" && !event.isError && CHANGING_TOOLS.has(event.toolName)) {
			lastWakeChangedFiles = true;
		}
	});
	pi.on("agent_end", () => {
		if (wakeTurn === "running") wakeTurn = "idle";
	});

	// Output after the card means the agent already has it in its live turn
	// (core steered it in, or a blocker or another extension started a turn),
	// so there is nothing left to wake for: drop waiting notes and any check
	// still running.
	pi.on("message_start", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		generation++;
		pending = [];
		stopPoll(ctx);
	});

	pi.on("message_end", (event, ctx) => {
		const message = event.message;
		if (message.role === "assistant") {
			afterFinalAnswer = message.stopReason === "stop";
			if (afterFinalAnswer) {
				lastAnswer = message.content.flatMap(part => (part.type === "text" ? [part.text] : [])).join("\n");
			}
			return;
		}
		if (message.role !== "custom" || message.customType !== "advisor") return;
		const details = message.details as CardDetails | undefined;
		if (details?.releasedBy) return;
		const notes = details?.notes ?? [];
		for (const note of notes) carried.add(note.note);
		if (ctx.mode === "print" || ctx.mode === "json") return;
		// A card during a run reaches the live turn; a run the user stopped stays stopped.
		if (!afterFinalAnswer) return;
		// Released concerns reached the agent at the Picker answer; the same text as a blocker is an escalation.
		const wakeNotes = notes
			.filter(n => n.severity === "blocker" || (n.severity === "concern" && !released.has(n.note)))
			.map(n => ({ note: n.note, blocker: n.severity === "blocker" }));
		if (wakeNotes.length === 0) return;
		pending.push(...wakeNotes);
		scheduleWake(ctx);
	});

	// Runs synchronously inside the Picker's `execute`, so the steer is queued
	// before the `ask` result returns and the loop reads it at that boundary.
	pi.events.on(PICKER_ANSWERED, data => {
		const { sessionFile } = data as PickerAnswered;
		if (!run || sessionFile === undefined || sessionFile !== run.sessionFile) return;
		const notes = readDeferredConcerns(sessionFile, run.sizes).filter(
			n => !carried.has(n.note) && !released.has(n.note),
		);
		if (notes.length === 0) return;
		for (const note of notes) {
			released.add(note.note);
			carried.add(note.note);
			woken.push({ note: note.note, blocker: false });
		}
		pi.sendMessage<CardDetails>(
			{
				customType: "advisor",
				content: formatAdvisories(notes),
				display: true,
				attribution: "agent",
				details: { notes, releasedBy: "omp-tools" },
			},
			{ deliverAs: "steer", triggerTurn: true },
		);
	});
}
