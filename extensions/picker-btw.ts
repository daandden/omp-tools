import type { ImageContent } from "@oh-my-pi/pi-ai";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { prompt } from "@oh-my-pi/pi-utils";
import pickerBtwPrompt from "./picker-btw.md" with { type: "text" };
import { LazySideQuestionThread, type SideQuestionCallbacks, sideQuestionsAvailable } from "./side-question";

export interface PickerBtwRequest extends SideQuestionCallbacks {
	promptText: string;
	images?: ImageContent[];
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

/**
 * The question with its pasted image labels renumbered `[Image #1]`, `[Image #2]`, … in text
 * order, and the images in that order, so each label matches its position in the prompt.
 */
export function numberImagesByAppearance(
	text: string,
	pasted: readonly { label: string; image: ImageContent }[],
): { text: string; images: ImageContent[] } {
	const byLabel = new Map(pasted.map(item => [item.label, item.image]));
	const numbers = new Map<string, number>();
	const images: ImageContent[] = [];
	const numbered = text.replace(/\[Image #\d+\]/g, label => {
		const image = byLabel.get(label);
		if (!image) return label;
		let number = numbers.get(label);
		if (number === undefined) {
			images.push(image);
			number = images.length;
			numbers.set(label, number);
		}
		return `[Image #${number}]`;
	});
	return { text: numbered, images };
}

/** The Picker btw runner for one ask, or `undefined` when Side questions cannot run here. */
export function pickerBtwRunner(ctx: ExtensionContext): PickerBtwRunner | undefined {
	if (!sideQuestionsAvailable(ctx)) return undefined;
	const thread = new LazySideQuestionThread(ctx);
	let disposed = false;
	return {
		ask: async request => {
			if (disposed) throw new Error("The Picker is closed.");
			return (await thread.get()).ask(request.promptText, request, request.signal, request.images);
		},
		dispose: () => {
			disposed = true;
			thread.dispose();
		},
	};
}
