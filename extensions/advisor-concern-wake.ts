// Wakes the primary agent for advisor concerns that arrive after its final
// answer. Core steers a mid-turn concern into the live turn, but after a
// terminal answer it only preserves the concern as a passive card; `blocker`
// is the only severity that starts a new turn. This extension starts that
// turn for `concern` too, so the agent checks it instead of waiting for the
// next user prompt.
//
// The wake goes out as an idle `aside`, the core path that honors plan mode
// (folds into context, no turn), a user interrupt still in effect (same), and
// ACP `deferAgentInitiatedTurns` (queues for the next turn). The
// `advisor.immuneTurns` cooldown is core-private and not applied. Locally it
// skips queued input and caps wakes per user prompt against advisor/agent
// ping-pong.
//
// Print and JSON mode (`omp -p`, `--mode json`, and headless hosts that keep
// the runner's "print" default) are skipped: after the last prompt, print mode
// switches the advisor to preserve-only, prints the final answer, waits for
// late notes, and disposes the session. A woken turn there would never be
// printed.
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import wakePrompt from "./advisor-concern-wake.md" with { type: "text" };

/** Wakes allowed per user prompt; the woken turn is itself reviewed and can raise another concern. */
const MAX_WAKES_PER_PROMPT = 2;
/** Core can preserve the card during the post-loop unwind, while the session still reports streaming. */
const IDLE_POLL_MS = 250;
const IDLE_WAIT_MAX_MS = 30_000;

interface AdvisorNote {
	note: string;
	severity?: "nit" | "concern" | "blocker";
	advisor?: string;
}

export default function advisorConcernWake(pi: ExtensionAPI): void {
	let pending: AdvisorNote[] = [];
	let wakes = 0;
	let poll: Timer | undefined;

	const stopPoll = (ctx: ExtensionContext) => {
		if (poll) ctx.clearTimer(poll);
		poll = undefined;
	};

	const wake = (ctx: ExtensionContext) => {
		const notes = pending;
		pending = [];
		if (notes.length === 0 || wakes >= MAX_WAKES_PER_PROMPT || ctx.hasPendingMessages()) return;
		wakes++;
		const list = notes.map(n => `- ${n.advisor ? `[${n.advisor}] ` : ""}${n.note}`).join("\n");
		pi.sendMessage(
			{ customType: "advisor-concern-wake", content: `${wakePrompt.trim()}\n\n${list}`, display: true },
			{ deliverAs: "aside" },
		);
	};

	const scheduleWake = (ctx: ExtensionContext) => {
		if (poll) return;
		const deadline = Date.now() + IDLE_WAIT_MAX_MS;
		poll = ctx.setInterval(() => {
			if (pending.length === 0 || Date.now() > deadline) {
				stopPoll(ctx);
				return;
			}
			if (!ctx.isIdle()) return;
			stopPoll(ctx);
			wake(ctx);
		}, IDLE_POLL_MS);
	};

	const resetBudget = () => {
		wakes = 0;
	};
	// Fires for every user-authored prompt in every mode (TUI, print, RPC, ACP,
	// SDK), including queued user messages, but not for this extension's own
	// agent-initiated aside turn. `input` would only cover the TUI editor.
	pi.on("before_agent_start", resetBudget);

	// The runner (and its managed timers) survives /new, /resume, forks, and
	// /tree jumps, and core's aside generation check is taken at send time. Drop
	// held notes before the transition so an old conversation's concern never
	// lands in the new one; start the new conversation with a fresh budget.
	const forgetPending = (_event: unknown, ctx: ExtensionContext) => {
		pending = [];
		stopPoll(ctx);
	};
	pi.on("session_before_switch", forgetPending);
	pi.on("session_before_branch", forgetPending);
	pi.on("session_before_tree", forgetPending);
	pi.on("session_switch", resetBudget);
	pi.on("session_branch", resetBudget);
	pi.on("session_tree", resetBudget);

	// Output after the card means the agent already has it in its live turn
	// (core steered it in), so there is nothing left to wake for.
	pi.on("message_start", (event, ctx) => {
		if (event.message.role !== "assistant" || pending.length === 0) return;
		pending = [];
		stopPoll(ctx);
	});

	pi.on("message_end", (event, ctx) => {
		const message = event.message;
		if (message.role !== "custom" || message.customType !== "advisor") return;
		if (ctx.mode === "print" || ctx.mode === "json") return;
		const notes = (message.details as { notes?: AdvisorNote[] } | undefined)?.notes ?? [];
		// Blockers already wake the agent in core.
		const concerns = notes.filter(n => n.severity === "concern");
		if (concerns.length === 0) return;
		pending.push(...concerns);
		scheduleWake(ctx);
	});
}
