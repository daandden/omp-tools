import { type ExtensionUIContext, logger } from "@oh-my-pi/pi-coding-agent";
import type { AutocompleteProvider } from "@oh-my-pi/pi-tui";
import { type PickerDraft, type PickerSubmit, showPicker } from "./ask-dialog";
import type { AskForm } from "./ask-form";
import type { PickerBtwRunner } from "./picker-btw";

export interface KeptPicker {
	draft: PickerDraft;
	/** The Picker btw thread, kept alive with the draft. */
	btw: PickerBtwRunner | undefined;
}

export class PickerDraftSlot {
	#kept: { key: string; picker: KeptPicker } | undefined;
	readonly #pendingDisposals = new Set<Promise<void>>();

	keep(form: AskForm, picker: KeptPicker): void {
		this.end(this.#kept?.picker.btw);
		this.#kept = { key: form.key, picker };
	}

	take(form: AskForm): KeptPicker | undefined {
		const kept = this.#kept;
		this.#kept = undefined;
		if (!kept) return undefined;
		if (kept.key === form.key) return kept.picker;
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

/** What every picker of a session shares. */
export interface PickerSession {
	cwd: string;
	drafts: PickerDraftSlot;
	btw(): PickerBtwRunner | undefined;
	autocomplete(): AutocompleteProvider | undefined;
	fileCommands(): Promise<ReadonlySet<string>>;
}

/**
 * Show `form` in the Picker, opened with the kept draft when it answered the same form. Esc keeps the
 * draft with its Picker btw thread and resolves `undefined`; a submit or a failure ends the thread.
 */
export async function openPicker(
	ui: Pick<ExtensionUIContext, "custom">,
	form: AskForm,
	session: PickerSession,
	options: {
		timeout: number | undefined;
		onTimeout?: () => void;
		signal: AbortSignal | undefined;
		notify(message: string): void;
	},
): Promise<PickerSubmit | undefined> {
	const restored = session.drafts.take(form);
	const btw = restored?.btw ?? session.btw();
	let result: Awaited<ReturnType<typeof showPicker>>;
	try {
		result = await showPicker(ui, form, {
			...options,
			cwd: session.cwd,
			autocomplete: session.autocomplete,
			fileCommands: await session.fileCommands(),
			askBtw: btw?.ask,
			draft: restored?.draft,
		});
	} catch (error) {
		session.drafts.end(btw);
		throw error;
	}
	if (result.kind === "cancel") {
		session.drafts.keep(form, { draft: result.draft, btw });
		return undefined;
	}
	session.drafts.end(btw);
	return result;
}
