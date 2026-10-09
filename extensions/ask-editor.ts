// Text box for the ask picker's `Other` answers and notes, built on the main
// prompt's own `CustomEditor` so suggestions, ghost-text word completion,
// autocorrect, vim mode, multi-line keys, `[Paste #N]` markers, and image
// chips behave exactly like the main prompt.
//
// It subclasses `HookEditorComponent` only for focus routing: omp hands the
// external-editor key to a focused `HookEditorComponent` instead of opening it
// on the hidden main prompt. The base editor it builds is dropped; this class
// renders, describes (in Tern), and routes input itself.
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
	type DescribeContext,
	FormField,
	type FormFieldTheme,
	getKeybindings,
	kbd,
	matchesKey,
	type NativeChild,
	type NativeNode,
	type NativeScroll,
	node,
	row,
	Spacer,
	sliceByColumn,
	span,
	type TUI,
	text,
} from "@oh-my-pi/pi-tui";
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

/** Drop the first and last column of a boxed panel rendered at `width + 2`,
 *  leaving horizontal rules and one-space content insets. */
export function withoutSideBorders(lines: readonly string[], width: number): string[] {
	return lines.map(line => sliceByColumn(line, 1, width));
}

/** One key hint: the key ids that trigger it (`"enter"`, `"ctrl+q"`, `"escape"`) and what it does. */
export interface KeyHint {
	keys: readonly string[];
	label: string;
}

/** A key id as the classic hint line spells it. */
function keyLabel(key: string): string {
	if (key === "escape") return "esc";
	if (key === "pageUp") return "pgup";
	if (key === "pageDown") return "pgdn";
	return key;
}

/** The classic hint line: `enter or ctrl+q save  esc discard`. */
export function hintText(hints: readonly KeyHint[]): string {
	return hints.map(hint => `${hint.keys.map(keyLabel).join(" or ")} ${hint.label}`).join("  ");
}

/** The native hint strip: keycaps with muted labels, as pi-tui's `hintsRow` draws them. */
export function hintsRow(hints: readonly KeyHint[], key = "hints"): NativeNode {
	const children: NativeChild[] = hints.map(hint =>
		row([...hint.keys.map(id => kbd(id)), text([span(hint.label, "muted")])], { gap: "xs", align: "center" }),
	);
	return node("row", { gap: "md", wrap: true, role: "omp.overlay.hints" }, children, key);
}

/** The first key bound to the external editor, else Ctrl+G. */
export function externalEditorKey(): string {
	return getKeybindings().getKeys("app.editor.external")[0] ?? "ctrl+g";
}

/**
 * List rows per text line. A capped `list` counts its height in rows of one
 * text line plus 6px (1.375 lines at a 16px line), while `min.h` counts text
 * lines, so the scroller gets this many rows per line to stay inside the box.
 */
const LIST_ROWS_PER_LINE = 0.72;

/**
 * A box about `lines` text lines tall whose content scrolls with the wheel,
 * a thin scrollbar, Tern's `scroll` requests, and `reveal`. `fixed` keeps
 * the box that tall when the content is shorter. A `col` with `max.h` only
 * clips, so the scroller is a capped `list`, which scrolls itself and places
 * non-item children as they are.
 */
export function scrollBox(
	content: NativeNode,
	options: { lines: number; fixed: boolean; key: string; scroll: NativeScroll | undefined },
): NativeNode {
	const lines = Math.max(1, Math.floor(options.lines));
	const rows = Math.max(1, Math.floor(lines * LIST_ROWS_PER_LINE));
	// Tern scrolls the nearest scroller at or above the node that asks; the
	// list's scroller sits inside the list node, so the content asks.
	return node(
		"list",
		{
			role: "omp-tools.ask-body",
			max: { lines: rows },
			...(options.fixed ? { min: { h: `${lines}lines` as const } } : {}),
		},
		[options.scroll ? { ...content, scroll: options.scroll } : content],
		options.key,
	);
}

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

/** A `/name` token ending at the cursor, at line start or after whitespace (a path has a second `/`). */
const SLASH_TOKEN_RE = /(?:^|\s)\/([^\s/]*)$/;
/** An answer that opens with `/name ` (the cursor is in that command's arguments). */
const LEADING_COMMAND_RE = /^\s*\/([^\s/]+)\s/;
const SKILL_NAMESPACE = "skill:";

/** Drop `#` prompt actions; they only exist to run an action on the main prompt. */
function withoutPromptActions(result: Suggestions): Suggestions {
	if (!result) return null;
	const items = result.items.filter(item => typeof (item as { execute?: unknown }).execute !== "function");
	return items.length > 0 ? { ...result, items } : null;
}

/** Items for a path completion (values keep their leading `/` or quote). */
function isPathItem(item: AutocompleteItem): boolean {
	return item.value.startsWith("/") || item.value.startsWith('"');
}

/**
 * Rank: name starts with the token (0), a hyphen segment does (1), else no
 * match. Like the host's mid-prompt skill gate, a stray `/word` in prose must
 * not open a popup through fuzzy name or description hits, since Enter would
 * then accept it instead of submitting.
 */
function matchTier(name: string, token: string): number | undefined {
	const lowerName = name.toLowerCase();
	if (lowerName.startsWith(token)) return 0;
	if (lowerName.split("-").some(segment => segment.startsWith(token))) return 1;
	return undefined;
}

/**
 * The main prompt's suggestion provider for references only: `@` files, `^`
 * models, `/` file commands and skills, internal URLs (`skill://`, `rule://`,
 * `local://`, …), emoji, GitHub refs, and other extensions' providers.
 *
 * `/name` anywhere in the answer suggests file commands (`fileCommands`) and
 * skills, each with the host's command or skill icon. Skills insert as
 * `/<name>` without the `skill:` prefix. Matching reuses the host provider by
 * querying it with a synthetic `/<token>` and `/skill:<token>` line. Built-in
 * and extension commands never appear, and their argument suggestions are
 * hidden.
 *
 * Nothing runs: `#` prompt actions are hidden, completion `onApplied` side
 * effects are dropped, and `trySyncSlashCompletion` is not forwarded, so Enter
 * submits exactly what was typed. The answer is plain text for the model.
 */
export function answerAutocomplete(base: AutocompleteProvider, fileCommands: ReadonlySet<string>): AutocompleteProvider {
	let skillNames: Promise<ReadonlySet<string>> | undefined;
	let knownSkills: ReadonlySet<string> = new Set();
	const loadSkillNames = (): Promise<ReadonlySet<string>> => {
		skillNames ??= base.getSuggestions([`/${SKILL_NAMESPACE}`], 0, SKILL_NAMESPACE.length + 1).then(result => {
			knownSkills = new Set(
				(result?.items ?? [])
					.filter(item => item.value.startsWith(SKILL_NAMESPACE))
					.map(item => item.value.slice(SKILL_NAMESPACE.length)),
			);
			return knownSkills;
		});
		return skillNames;
	};

	/** Whether the answer opens with a built-in or extension `/command`. */
	const inOtherCommandArgs = (lines: readonly string[], cursorLine: number, skills: ReadonlySet<string>): boolean => {
		if (lines.slice(0, cursorLine).some(line => line.trim() !== "")) return false;
		const name = LEADING_COMMAND_RE.exec(lines[cursorLine] ?? "")?.[1];
		return name !== undefined && !fileCommands.has(name) && !skills.has(name);
	};

	/** File commands then skills matching `token`, as `/`-insertable names. */
	const referenceSuggestions = async (token: string, signal?: AbortSignal): Promise<AutocompleteItem[]> => {
		const bare = token.startsWith(SKILL_NAMESPACE) ? token.slice(SKILL_NAMESPACE.length) : token;
		const [commands, skills] = await Promise.all([
			base.getSuggestions([`/${bare}`], 0, bare.length + 1, signal),
			base.getSuggestions([`/${SKILL_NAMESPACE}${bare}`], 0, bare.length + SKILL_NAMESPACE.length + 1, signal),
		]);
		const items = [
			...(commands?.items ?? []).filter(item => fileCommands.has(item.value)),
			...(skills?.items ?? [])
				.filter(item => item.value.startsWith(SKILL_NAMESPACE) && item.value !== SKILL_NAMESPACE)
				.map(item => {
					const name = item.value.slice(SKILL_NAMESPACE.length);
					return { ...item, value: name, label: name };
				}),
		];
		const lowerToken = bare.toLowerCase();
		return items
			.map((item, index) => ({ item, index, tier: matchTier(item.value, lowerToken) }))
			.filter((entry): entry is { item: AutocompleteItem; index: number; tier: number } => entry.tier !== undefined)
			.sort((a, b) => a.tier - b.tier || a.index - b.index)
			.map(entry => entry.item);
	};

	return {
		async getSuggestions(lines, cursorLine, cursorCol, signal, onPartial) {
			const skills = await loadSkillNames();
			if (inOtherCommandArgs(lines, cursorLine, skills)) return null;
			const textBeforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
			const slashToken = SLASH_TOKEN_RE.exec(textBeforeCursor);
			if (slashToken) {
				const items = await referenceSuggestions(slashToken[1] ?? "", signal);
				// The whole text before the cursor is the prefix so the editor's
				// accept-time staleness check matches it exactly, mid-line too.
				if (items.length > 0) return { items, prefix: textBeforeCursor };
				// No command or skill: keep the host's path completion (`/tmp`).
				const fallback = await base.getSuggestions(lines, cursorLine, cursorCol, signal);
				const paths = fallback?.items.filter(isPathItem) ?? [];
				return paths.length > 0 && fallback ? { ...fallback, items: paths } : null;
			}
			const partial = onPartial && ((result: NonNullable<Suggestions>) => {
				const filtered = withoutPromptActions(result);
				if (filtered) onPartial(filtered);
			});
			return withoutPromptActions(await base.getSuggestions(lines, cursorLine, cursorCol, signal, partial));
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const line = lines[cursorLine] ?? "";
			const slashToken = SLASH_TOKEN_RE.exec(line.slice(0, cursorCol));
			if (slashToken && !isPathItem(item)) {
				// Replace the `/token` at the cursor with `/<name> `, like the host.
				const start = cursorCol - slashToken[1]!.length - 1;
				const insert = `/${item.value} `;
				const next = [...lines];
				next[cursorLine] = `${line.slice(0, start)}${insert}${line.slice(cursorCol)}`;
				return { lines: next, cursorLine, cursorCol: start + insert.length };
			}
			const { onApplied: _ignored, ...edit } = base.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			return edit;
		},
		getInlineHint: base.getInlineHint
			? (lines, cursorLine, cursorCol) =>
					inOtherCommandArgs(lines, cursorLine, knownSkills)
						? null
						: (base.getInlineHint?.(lines, cursorLine, cursorCol) ?? null)
			: undefined,
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
	/** Names of file commands (`~/.agents/commands`, `~/.omp/commands`, project commands) offered under `/`. */
	fileCommands: ReadonlySet<string>;
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
	/** Keys the owner handles before the editor; return true to consume. */
	onKey?(data: string): boolean;
	/** Footer key hints, as text in the classic TUI and as keycaps in Tern. */
	hints: readonly KeyHint[];
}

function noop(): void {}

export class AnswerEditor extends HookEditorComponent {
	readonly editor: CustomEditor;
	readonly #field: FormField;
	readonly #tui: TUI;
	readonly #options: AnswerEditorOptions;
	#closed = false;
	/** The Tern view: a card titled like the classic field, the editor (which describes itself), the key hints. */
	readonly #nativeRoot: NativeNode;

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
		if (options.autocomplete) {
			editor.setAutocompleteProvider(answerAutocomplete(options.autocomplete, options.fileCommands));
		}

		// Prompt-style chrome, as in HookEditorComponent. In Tern the editor is
		// Editor's plain field, without the composer's model chip, send bar, and placeholder.
		editor.describeLayout = input => ({ role: "omp.field", children: [input], caret: "input" });
		editor.describePlaceholder = () => "";
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

		this.#field = new FormField(editor, { theme: answerFieldTheme, hint: hintText(options.hints) });
		this.addChild(this.#field);
		this.addChild(new Spacer(1));
		// Keep the host from claiming the image-paste key for its text-only
		// prompt paste; the editor's own `onPasteImage` handles it.
		Object.defineProperty(this, "pasteText", { value: undefined });
		this.#nativeRoot = node("card", { role: this.nativeRole, head: options.title }, [editor, hintsRow(options.hints)]);
	}

	override describe(_cx: DescribeContext): NativeNode {
		this.#field.focused = this.focused;
		return this.#nativeRoot;
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
		if (this.#options.onKey?.(data)) {
			this.#tui.requestRender();
			return;
		}
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
