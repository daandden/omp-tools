// Wakes the primary agent for advisor concerns that arrive after its final
// answer. Core steers a mid-turn concern into the live turn, but after a
// terminal answer it only preserves the concern as a passive card; `blocker`
// is the only severity that starts a new turn. This extension starts that
// turn for `concern` too, so the agent checks it instead of waiting for the
// next user prompt. The preserved card is already in the agent's context (a
// developer `<advisory>` message), so the wake only points at it and never
// repeats the notes.
//
// The woken turn is itself reviewed and can raise another concern, so wakes
// are gated per prompt cycle (one user prompt until the next) by three checks:
// 1. The concern is new: an OMP judge call (TypeSafe Jev) or, without a native
//    judge, word overlap finds no earlier woken concern with the same issue.
//    A repeat stays a card; the agent already answered it.
// 2. The last wake changed something: the woken turn ran a file-changing tool
//    without error. A turn that only read and replied means the agent did not
//    agree; the user decides.
// 3. Fewer than MAX_WAKES_PER_PROMPT wakes, as a backstop.
// When check 2 or 3 holds back a new concern, the user gets a notification.
//
// The wake goes out as an idle `aside`, the core path that honors plan mode
// (folds into context, no turn), a user interrupt still in effect (same), and
// ACP `deferAgentInitiatedTurns` (queues for the next turn). Without a woken
// turn, check 2 stays false, so those modes notify instead of waking again.
// The `advisor.immuneTurns` cooldown is core-private and not applied.
//
// Print and JSON mode (`omp -p`, `--mode json`, and headless hosts that keep
// the runner's "print" default) are skipped: after the last prompt, print mode
// switches the advisor to preserve-only, prints the final answer, waits for
// late notes, and disposes the session. A woken turn there would never be
// printed.
import type { Judge } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { logger, settings } from "@oh-my-pi/pi-coding-agent";
import {
	hasNativeJudge,
	journalJudgmentUsage,
	resolveJudge,
	sharedJudgmentCache,
} from "@oh-my-pi/pi-coding-agent/judgment";
import wakePrompt from "./advisor-concern-wake.md" with { type: "text" };
import { judgeRepeats, wordOverlapRepeats } from "./concern-match";

/** Backstop on wakes per prompt cycle; checks 1 and 2 normally stop a loop first. */
const MAX_WAKES_PER_PROMPT = 6;
/** Tools whose successful call in a woken turn counts as the agent acting on the concern. */
const CHANGING_TOOLS = new Set(["edit", "write", "ast_edit", "bash", "eval", "task"]);
/** A judge call slower than this falls back to word overlap. */
const JUDGE_TIMEOUT_MS = 15_000;
/** Core can preserve the card during the post-loop unwind, while the session still reports streaming. */
const IDLE_POLL_MS = 250;
const IDLE_WAIT_MAX_MS = 30_000;

const STALLED_NOTICE =
	"Advisor concern not sent to the agent: the agent changed no files after the last concern. Send a prompt if you want the agent to act.";
const CEILING_NOTICE = `Advisor concern not sent to the agent: ${MAX_WAKES_PER_PROMPT} wakes in this prompt cycle. Send a prompt if you want the agent to act.`;

interface AdvisorNote {
	note: string;
	severity?: "nit" | "concern" | "blocker";
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
			purpose: "advisor-concern-wake",
			onUsage: journalJudgmentUsage(ctx.sessionManager),
			cache: sharedJudgmentCache(),
		});
	} catch (err) {
		logger.debug("advisor-concern-wake: judge unavailable", { err: String(err) });
		return undefined;
	}
}

/** For each of `notes`, whether it repeats one of `earlier` (check 1). */
async function findRepeats(ctx: ExtensionContext, notes: string[], earlier: string[]): Promise<boolean[]> {
	if (earlier.length === 0) return notes.map(() => false);
	const judge = nativeJudge(ctx);
	if (judge) {
		try {
			return await judgeRepeats(judge, notes, earlier, { signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS) });
		} catch (err) {
			logger.debug("advisor-concern-wake: judge failed, using word overlap", { err: String(err) });
		}
	}
	return wordOverlapRepeats(notes, earlier);
}

export default function advisorConcernWake(pi: ExtensionAPI): void {
	/** Concern notes waiting for the agent to go idle. */
	let pending: string[] = [];
	/** Concern notes already woken for in this prompt cycle. */
	let woken: string[] = [];
	let wakes = 0;
	/** Check 2; true before the first wake of a cycle. */
	let lastWakeChangedFiles = true;
	let wakeTurn: "idle" | "sent" | "running" = "idle";
	/**
	 * Bumped on every reset and on every assistant message, so a check that
	 * finishes afterwards is dropped: its notes left `pending` when it started,
	 * and a turn that ran meanwhile already had the cards in context.
	 */
	let generation = 0;
	let checking = false;
	let poll: Timer | undefined;

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
		if (notes.length === 0 || ctx.hasPendingMessages()) return;
		const started = generation;
		checking = true;
		try {
			const repeats = await findRepeats(ctx, notes, woken);
			if (started !== generation || !ctx.isIdle() || ctx.hasPendingMessages()) return;
			const fresh = notes.filter((_, i) => !repeats[i]);
			if (fresh.length === 0) return;
			if (!lastWakeChangedFiles) {
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
			pi.sendMessage(
				{ customType: "advisor-concern-wake", content: wakePrompt.trim(), display: true },
				{ deliverAs: "aside" },
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
	};
	// Fires for every user-authored prompt in every mode (TUI, print, RPC, ACP,
	// SDK), including queued user messages, but not for this extension's own
	// agent-initiated aside turn. `input` would only cover the TUI editor.
	pi.on("before_agent_start", resetCycle);

	// The runner (and its managed timers) survives /new, /resume, forks, and
	// /tree jumps, and core's aside generation check is taken at send time. Drop
	// held notes and any running check before the transition so an old
	// conversation's concern never lands in the new one; start the new
	// conversation with a fresh cycle.
	const forgetPending = (_event: unknown, ctx: ExtensionContext) => {
		pending = [];
		generation++;
		stopPoll(ctx);
	};
	pi.on("session_before_switch", forgetPending);
	pi.on("session_before_branch", forgetPending);
	pi.on("session_before_tree", forgetPending);
	pi.on("session_switch", resetCycle);
	pi.on("session_branch", resetCycle);
	pi.on("session_tree", resetCycle);

	// Check 2 watches only the turn this extension started.
	pi.on("agent_start", () => {
		if (wakeTurn === "sent") wakeTurn = "running";
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
		if (message.role !== "custom" || message.customType !== "advisor") return;
		if (ctx.mode === "print" || ctx.mode === "json") return;
		const notes = (message.details as { notes?: AdvisorNote[] } | undefined)?.notes ?? [];
		// Blockers already wake the agent in core.
		const concerns = notes.filter(n => n.severity === "concern").map(n => n.note);
		if (concerns.length === 0) return;
		pending.push(...concerns);
		scheduleWake(ctx);
	});
}
