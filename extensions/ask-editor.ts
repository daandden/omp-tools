// Text box for the ask picker's `Other` answers and notes, built on the main
// prompt's own `CustomEditor` so suggestions, ghost-text word completion,
// autocorrect, vim mode, multi-line keys, `[Paste #N]` markers, and image
// chips behave exactly like the main prompt.
//
// It subclasses `HookEditorComponent` only for focus routing: omp hands the
// external-editor key to a focused `HookEditorComponent` instead of opening it
// on the hidden main prompt. The base editor it builds is dropped; this class
// renders and routes input itself.
import { CustomEditor, HookEditorComponent, settings } from "@oh-my-pi/pi-coding-agent";
import {
	cfgAutocompleteMaxVisible,
	cfgSpellingAutocomplete,
	cfgSpellingAutocorrect,
	cfgSpellingTypoDetection,
	cfgTuiImeSafeCursor,
	cfgTuiVimMode,
} from "@oh-my-pi/pi-coding-agent/modes/settings";
import {
	type AutocompleteItem,
	type AutocompleteProvider,
	FormField,
	type FormFieldTheme,
	getKeybindings,
	matchesKey,
	Spacer,
	type TUI,
} from "@oh-my-pi/pi-tui";
import { editorKey } from "@oh-my-pi/pi-tui/chrome";
import { getEditorTheme, theme } from "@oh-my-pi/pi-tui/theme";

// Compiled omp serves extensions only the packages' named export paths, not
// `@oh-my-pi/pi-tui/chrome/form-theme` or `/keybinding-matchers`; importing
// those would load a second pi-tui copy from node_modules. Mirror the two
// small pieces instead.

/** Same as pi-tui's `formTheme` (HookEditorComponent's field theme). */
const answerFieldTheme: FormFieldTheme = {
	label: text => theme.bold(theme.fg("accent", text)),
	description: text => theme.fg("muted", text),
	error: text => theme.fg("error", text),
	hint: text => theme.fg("dim", text),
};

/** Submit chord of the prompt-style editor: `app.message.followUp`, else Ctrl+Enter / Ctrl+Q. */
function isFollowUpSubmit(data: string): boolean {
	const keybindings = getKeybindings();
	if (keybindings.getKeys("app.message.followUp").length > 0) return keybindings.matches(data, "app.message.followUp");
	return matchesKey(data, "ctrl+enter") || matchesKey(data, "ctrl+q");
}

/** External-editor key: `app.editor.external`, else Ctrl+G. */
function isExternalEditorKey(data: string): boolean {
	const keybindings = getKeybindings();
	if (keybindings.getKeys("app.editor.external").length > 0) return keybindings.matches(data, "app.editor.external");
	return data === "\x07";
}

type Suggestions = { items: AutocompleteItem[]; prefix: string } | null;

/** Prompt actions (`#copy`, `#undo`, …) act on the main prompt; hide them here. */
function withoutPromptActions(result: Suggestions): Suggestions {
	if (!result) return null;
	const items = result.items.filter(item => typeof (item as { execute?: unknown }).execute !== "function");
	return items.length > 0 ? { ...result, items } : null;
}

/**
 * The main prompt's suggestion provider (files, models, internal URLs, emoji,
 * GitHub refs, `/` commands and skills, other extensions' providers) for
 * references only: accepting a suggestion inserts its text and never runs it.
 *
 * - `#` prompt actions are hidden (they only exist to run an action).
 * - `onApplied` side effects from completions are dropped.
 * - `trySyncSlashCompletion` is not forwarded, so Enter submits exactly what was
 *   typed instead of completing a partial `/command` first.
 * The submitted answer is plain text returned to the model; nothing in it runs.
 */
export function answerAutocomplete(base: AutocompleteProvider): AutocompleteProvider {
	return {
		async getSuggestions(lines, cursorLine, cursorCol, signal, onPartial) {
			const partial = onPartial && ((result: NonNullable<Suggestions>) => {
				const filtered = withoutPromptActions(result);
				if (filtered) onPartial(filtered);
			});
			return withoutPromptActions(await base.getSuggestions(lines, cursorLine, cursorCol, signal, partial));
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const { onApplied: _ignored, ...edit } = base.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			return edit;
		},
		getInlineHint: base.getInlineHint?.bind(base),
		trySyncInlineReplace: base.trySyncInlineReplace?.bind(base),
		getForceFileSuggestions: base.getForceFileSuggestions?.bind(base),
		shouldTriggerFileCompletion: base.shouldTriggerFileCompletion?.bind(base),
	};
}

export interface AnswerEditorOptions {
	title: string;
	prefill: string | undefined;
	/** Rows the text area may grow to before scrolling. */
	maxHeight: number;
	/** Main prompt suggestion provider, when the host has built one. */
	autocomplete: AutocompleteProvider | undefined;
	/** Receives the expanded text: paste markers and image chips become their text. */
	onSubmit(text: string): void;
	onCancel(): void;
	/** Image-paste key, or an empty bracketed paste (image-only pasteboard). */
	onPasteImage(editor: CustomEditor): Promise<boolean>;
	/** A bracketed paste of image or video file paths. */
	onPasteImagePath(editor: CustomEditor, path: string): Promise<void>;
	/** Open `text` in `$VISUAL`/`$EDITOR`; `null` keeps the current text. */
	editExternally(text: string): Promise<string | null>;
	/** Called before every key (inactivity countdown reset). */
	onInput(): void;
}

function noop(): void {}

export class AnswerEditor extends HookEditorComponent {
	readonly editor: CustomEditor;
	readonly #field: FormField;
	readonly #tui: TUI;
	readonly #options: AnswerEditorOptions;
	#closed = false;

	constructor(tui: TUI, options: AnswerEditorOptions) {
		super(tui, options.title, undefined, noop, noop, { promptStyle: true });
		this.clear();
		this.#tui = tui;
		this.#options = options;

		const editor = new CustomEditor(tui, getEditorTheme());
		// Same per-editor setup the host applies to the main prompt.
		editor.setUseTerminalCursor(tui.getShowHardwareCursor());
		editor.setImeSafeCursorLayout(cfgTuiImeSafeCursor.get(settings));
		editor.setVimMode(cfgTuiVimMode.get(settings));
		editor.setAutocompleteMaxVisible(cfgAutocompleteMaxVisible.get(settings));
		editor.setSpellingFeatures({
			typoDetection: cfgSpellingTypoDetection.get(settings),
			autocomplete: cfgSpellingAutocomplete.get(settings),
			autocorrect: cfgSpellingAutocorrect.get(settings),
		});
		editor.viewportRowsProvider = () => tui.terminal.rows;
		editor.onAutocompleteUpdate = () => tui.requestRender();
		editor.onAutocompleteCancel = () => tui.requestRender(true);
		editor.setShimmerRepaintHandler(() => tui.requestRender());
		const keybindings = getKeybindings();
		// Apply user remaps like the host does; keep CustomEditor defaults when unbound.
		for (const action of ["app.interrupt", "app.clear", "app.clipboard.pasteImage"] as const) {
			const keys = keybindings.getKeys(action);
			if (keys.length > 0) editor.setActionKeys(action, keys);
		}
		if (options.autocomplete) editor.setAutocompleteProvider(answerAutocomplete(options.autocomplete));

		// Prompt-style chrome, as in HookEditorComponent.
		editor.setBorderVisible(false);
		editor.setPromptGutter("> ");
		editor.setMaxHeight(options.maxHeight);
		editor.setScrollbarVisible(true);
		if (options.prefill) editor.setText(options.prefill);

		editor.onSubmit = text => this.#finish(() => options.onSubmit(text));
		editor.onEscape = () => this.#finish(options.onCancel);
		// Ctrl+C (`app.clear`) clears the text, like the main prompt's first press;
		// it never exits omp from here.
		editor.onClear = () => editor.setText("");
		editor.onPasteImage = () => options.onPasteImage(editor);
		editor.onPasteImagePath = path => options.onPasteImagePath(editor, path);
		this.editor = editor;

		const external = editorKey("app.editor.external") || "ctrl+g";
		this.#field = new FormField(editor, {
			theme: answerFieldTheme,
			hint: `enter or ctrl+q submit  esc cancel  ${external} external editor`,
		});
		this.addChild(this.#field);
		this.addChild(new Spacer(1));
		// Keep the host from claiming the image-paste key for its text-only
		// prompt paste; the editor's own `onPasteImage` handles it.
		Object.defineProperty(this, "pasteText", { value: undefined });
	}

	override render(width: number): readonly string[] {
		this.#field.focused = this.focused;
		return super.render(width);
	}

	override setUseTerminalCursor(useTerminalCursor: boolean): void {
		this.#field.setUseTerminalCursor(useTerminalCursor);
	}

	override handleInput(data: string): void {
		if (this.#closed) return;
		this.#options.onInput();
		if (isExternalEditorKey(data)) {
			void this.#openExternalEditor();
		} else if (isFollowUpSubmit(data)) {
			// Ctrl+Q / Ctrl+Enter submit, as in the ask prompt-style editor.
			this.editor.submit();
		} else {
			this.editor.handleInput(data);
		}
		this.#tui.requestRender();
	}

	override dispose(): void {
		this.#closed = true;
		super.dispose();
	}

	#finish(callback: () => void): void {
		if (this.#closed) return;
		this.#closed = true;
		callback();
	}

	async #openExternalEditor(): Promise<void> {
		const text = this.editor.getExpandedText();
		try {
			this.#tui.stop();
			const result = await this.#options.editExternally(text);
			if (result !== null && !this.#closed) this.editor.setText(result);
		} finally {
			this.#tui.start();
			this.#tui.requestRender(true);
		}
	}
}
