import type { ExtensionAskDialogQuestion } from "@oh-my-pi/pi-coding-agent";
import type { PickerDraft } from "./ask-dialog";
import type { PickerBtwRunner } from "./picker-btw";

export interface KeptPicker {
	draft: PickerDraft;
	/** The Picker btw thread, kept alive with the draft. */
	btw: PickerBtwRunner | undefined;
}

function draftKey(questions: readonly ExtensionAskDialogQuestion[]): string {
	return JSON.stringify(
		questions.map(question => [question.id, question.question, question.options.map(option => option.label), question.multi ?? false]),
	);
}

export class PickerDraftSlot {
	#kept: { key: string; picker: KeptPicker } | undefined;

	keep(questions: readonly ExtensionAskDialogQuestion[], picker: KeptPicker): void {
		this.drop();
		this.#kept = { key: draftKey(questions), picker };
	}

	/** The kept Picker when `questions` match it; any Picker that opens empties the slot. */
	take(questions: readonly ExtensionAskDialogQuestion[]): KeptPicker | undefined {
		const kept = this.#kept;
		this.#kept = undefined;
		if (!kept) return undefined;
		if (kept.key === draftKey(questions)) return kept.picker;
		kept.picker.btw?.dispose();
		return undefined;
	}

	async drop(): Promise<void> {
		const btw = this.#kept?.picker.btw;
		this.#kept = undefined;
		await btw?.dispose();
	}
}
