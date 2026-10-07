// Picker btw: a side question asked from inside the Picker while an `ask`
// waits. It runs through `ctx.runEphemeralTurn`, the pipeline native /btw
// uses: the conversation so far plus the question, tools listed for prompt
// cache reuse but never run, nothing appended to the session. The thread
// lives only in the Picker and is discarded with the ask.
//
// Extensions cannot start native /btw (it lives in InteractiveMode's
// BtwController) or register a command named `btw` (built-in names are
// reserved), so this is the Picker's own implementation.
import type { Message } from "@oh-my-pi/pi-ai";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { prompt } from "@oh-my-pi/pi-utils";
import pickerBtwPrompt from "./picker-btw.md" with { type: "text" };

export interface PickerBtwTurn {
	question: string;
	/** The prompt sent for this turn; replayed as history for later turns. */
	promptText: string;
	answer: string;
	status: "running" | "complete" | "cancelled" | "error";
	error?: string;
	createdAt: number;
	updatedAt: number;
}

export interface PickerBtwRequest {
	promptText: string;
	/** Earlier turns of this ask's thread, oldest first. */
	earlier: readonly PickerBtwTurn[];
	/** Provider lineage for the thread; rotate after a cancelled or failed turn. */
	conversationKey: string;
	signal: AbortSignal;
	onTextDelta(delta: string): void;
}

/** Runs one Picker btw turn and resolves with the answer text. */
export type AskPickerBtw = (request: PickerBtwRequest) => Promise<string>;

/** The prompt for a Picker btw question, with the user's unsubmitted answers. */
export function renderPickerBtwPrompt(question: string, draftAnswers: string): string {
	return prompt.render(pickerBtwPrompt, { question, draftAnswers });
}

/** The Picker btw runner, or `undefined` when the host has no side turns. */
export function pickerBtwRunner(ctx: ExtensionContext): AskPickerBtw | undefined {
	const runEphemeralTurn = ctx.runEphemeralTurn?.bind(ctx);
	if (!runEphemeralTurn) return undefined;
	return async request => {
		const model = ctx.model;
		if (!model) throw new Error("No active model available for a Picker btw.");
		const history: Message[] = [];
		for (const turn of request.earlier) {
			history.push({
				role: "user",
				content: [{ type: "text", text: turn.promptText }],
				attribution: "agent",
				timestamp: turn.createdAt,
			});
			if (!turn.answer) continue;
			// Visible text only, as native /btw replays its saved history.
			history.push({
				role: "assistant",
				content: [{ type: "text", text: turn.answer }],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: turn.updatedAt,
			});
		}
		// The streamed text is the answer: `replyText` is deduplicated and
		// capped at 4 KiB for one-line side replies.
		let streamed = "";
		const { replyText } = await runEphemeralTurn({
			promptText: request.promptText,
			history,
			conversationKey: request.conversationKey,
			signal: request.signal,
			onTextDelta: delta => {
				streamed += delta;
				request.onTextDelta(delta);
			},
		});
		return streamed.trim() || replyText;
	};
}
