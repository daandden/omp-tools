import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { prompt } from "@oh-my-pi/pi-utils";
import pickerBtwPrompt from "./picker-btw.md" with { type: "text" };
import { LazySideQuestionThread, type SideQuestionCallbacks, sideQuestionsAvailable } from "./side-question";

export interface PickerBtwRequest extends SideQuestionCallbacks {
	promptText: string;
	signal: AbortSignal;
}

/** Runs one Picker btw turn and resolves with the answer text. */
export type AskPickerBtw = (request: PickerBtwRequest) => Promise<string>;

export interface PickerBtwRunner {
	ask: AskPickerBtw;
	/** Ends the thread; call when the Picker closes. */
	dispose(): void;
}

/** The prompt for a Picker btw question, with the user's unsubmitted answers. */
export function renderPickerBtwPrompt(question: string, draftAnswers: string): string {
	return prompt.render(pickerBtwPrompt, { question, draftAnswers });
}

/** The Picker btw runner for one ask, or `undefined` when Side questions cannot run here. */
export function pickerBtwRunner(ctx: ExtensionContext): PickerBtwRunner | undefined {
	if (!sideQuestionsAvailable(ctx)) return undefined;
	const thread = new LazySideQuestionThread(ctx);
	let disposed = false;
	return {
		ask: async request => {
			if (disposed) throw new Error("The Picker is closed.");
			return (await thread.get()).ask(request.promptText, request, request.signal);
		},
		dispose: () => {
			disposed = true;
			thread.dispose();
		},
	};
}
