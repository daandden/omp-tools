import { type ExtensionAskDialogQuestion, logger } from "@oh-my-pi/pi-coding-agent";
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
	readonly #pendingDisposals = new Set<Promise<void>>();

	keep(questions: readonly ExtensionAskDialogQuestion[], picker: KeptPicker): void {
		this.end(this.#kept?.picker.btw);
		this.#kept = { key: draftKey(questions), picker };
	}

	/** The kept Picker when `questions` match it; any Picker that opens empties the slot. */
	take(questions: readonly ExtensionAskDialogQuestion[]): KeptPicker | undefined {
		const kept = this.#kept;
		this.#kept = undefined;
		if (!kept) return undefined;
		if (kept.key === draftKey(questions)) return kept.picker;
		this.end(kept.picker.btw);
		return undefined;
	}

	/** End a Picker btw thread that no draft keeps. */
	end(btw: PickerBtwRunner | undefined): void {
		if (!btw) return;
		const ending: Promise<void> = btw
			.dispose()
			.catch(error => logger.warn("omp-tools: failed to end a Picker btw thread", { error: String(error) }))
			.finally(() => this.#pendingDisposals.delete(ending));
		this.#pendingDisposals.add(ending);
	}

	async drop(): Promise<void> {
		this.end(this.#kept?.picker.btw);
		this.#kept = undefined;
		await Promise.all(this.#pendingDisposals);
	}
}
