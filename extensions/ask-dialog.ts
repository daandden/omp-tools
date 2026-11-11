// The Picker: the interactive TUI's answer surface for an `ask` form and for
// the host's structured askDialog. Mirrors the native pi-tui ask dialog (tabs,
// Submit review tab, multi-select, "Other" custom input, notes, timeout
// countdown), one tab per question with the question's context as block
// Markdown and pictures in the scrollable body. In Tern (Surface Protocol
// terminals) it describes the same state as native nodes instead
// (`describe`): each option is a row, and pointer actions run the key paths.
//
// What a form means (fields, values, validation, the answer) lives in
// `ask-form.ts`; this file draws it and turns keys into its state changes.
//
// Runtime imports resolve to the host's in-process pi-tui/coding-agent
// modules through OMP's extension specifier shim; they must stay on subpaths
// the compiled host serves (see AGENTS.md "SDK imports").
import type { ImageContent } from "@oh-my-pi/pi-ai";
import type { CustomEditor, ExtensionUIContext } from "@oh-my-pi/pi-coding-agent";
import { getEditorCommand, openInEditor } from "@oh-my-pi/pi-coding-agent/utils/external-editor";
import {
	type AutocompleteProvider,
	type Component,
	col,
	type DescribeContext,
	decodePrintableKey,
	Ellipsis,
	type Focusable,
	getKeybindings,
	kbd,
	Markdown,
	matchesKey,
	type NativeChild,
	type NativeNode,
	type NativeScroll,
	type NativeUiEvent,
	node,
	padding,
	replaceTabs,
	ScrollView,
	span,
	type Tab,
	TabBar,
	Text,
	type TUI,
	text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@oh-my-pi/pi-tui";
import {
	CountdownTimer,
	editorKey,
	getTabBarTheme,
	handleTabSwitchKey,
	OverlayPanel,
	PanelDivider,
	PanelRows,
} from "@oh-my-pi/pi-tui/chrome";
import { sanitizeCarriageReturns } from "@oh-my-pi/pi-tui/render";
import { getMarkdownTheme, highlightCode, theme } from "@oh-my-pi/pi-tui/theme";
import { AnswerEditor, externalEditorKey, SCROLL_BOX_CSS, scrollBox, withoutSideBorders } from "./ask-editor";
import {
	type AnswerState,
	type AnswerText,
	type AskForm,
	type AskFormAnswer,
	type AskImage,
	type AskPicture,
	type AskQuestion,
	answerParts,
	type FormSpan,
	firstInvalid,
	formAnswer,
	initialAnswer,
	initialCursor,
	isAnswered,
	optionText,
	pickOption,
	pickOther,
	setNote,
	setOther,
	unpickOption,
} from "./ask-form";
import { loadImagePaths, type PasteOutcome, type PastedImage, readClipboardPaste } from "./ask-images";
import { AskPictures } from "./ask-pictures";
import { formatAskAnswer } from "./ask-result";
import type { AskPickerBtw } from "./picker-btw";
import { PickerBtwView } from "./picker-btw-view";
import type { SideQuestionTurn } from "./side-question-view";

const SUBMIT_OPTION = "Submit";
/** The row of a question's Other answer. */
export const OTHER_OPTION = "Other (type your own)";
const RECOMMENDED_SUFFIX = " (Recommended)";
/** Fraction of the terminal the dialog occupies (the native dialog's cap). */
const DIALOG_HEIGHT_RATIO = 0.7;
const MIN_DIALOG_ROWS = 12;
const MIN_BODY_ROWS = 5;
const MAX_TAB_LABEL_WIDTH = 16;
/** Rows reserved for the custom-answer/note editor while it is open. */
const PROMPT_EDITOR_ROWS = 6;
/** Lines the docked picker spends outside the scroller: the status line above it, the tab row, the button row, gaps, and insets. */
const NATIVE_CHROME_LINES = 11;
/** Columns the picker's insets take from the pane's width. */
const NATIVE_INSET_COLS = 6;
/** Lines of a Tern editor card (title, one text line, key hints, insets), less the gap it shares. */
const NATIVE_EDITOR_LINES = 5;
/** Lines of the Tern button row, which an open editor replaces. */
const NATIVE_ACTION_LINES = 2;
/** Text lines one Tern option row adds beyond its text: the gap between rows. */
const NATIVE_ROW_GAP_LINES = 0.5;
/** The same with the picker's sheet: 2px of padding above and below each row, on a 16px line. */
const NATIVE_STYLED_ROW_LINES = 0.25;

export interface PickerSubmit {
	kind: "submit";
	answer: AskFormAnswer;
}

/** Esc (or Cancel) closed the Picker; `draft` is what it keeps. */
export interface PickerCancel {
	kind: "cancel";
	draft: PickerDraft;
}

/** A Picker draft: what a Picker that Esc closed keeps, so the same form opens where it was left. */
export interface PickerDraft {
	states: QuestionState[];
	activeTab: number;
	submitNote: AnswerText | undefined;
	/** `[Image #N]` labels given so far; new pastes continue after them. */
	imageCount: number;
	/** The Picker btw turns shown so far; the caller keeps the thread that answered them. */
	btwTurns: SideQuestionTurn[];
}

interface DialogOptions {
	timeout?: number;
	/** Called once when the timeout expires, before the Picker submits (native `onTimeout`). */
	onTimeout?: () => void;
	/** Resolves relative pasted image paths and form pictures. */
	cwd: string;
	/** Surfaces paste failures (unsupported format, missing file, empty clipboard). */
	notify(message: string): void;
	/** Main prompt suggestion provider, borrowed from the host. */
	autocomplete(): AutocompleteProvider | undefined;
	/** File command names offered under `/` in the answer box. */
	fileCommands: ReadonlySet<string>;
	/** Picker btw side questions; `undefined` when the host has no side turns (`?` is then off). */
	askBtw: AskPickerBtw | undefined;
	/** A Picker draft of this form to open with. */
	draft?: PickerDraft;
}

/** One question's answer state plus where the Picker stands in it. */
interface QuestionState extends AnswerState {
	cursorIndex: number;
	scrollOffset: number;
	/** True after a cursor move: keep the cursor row in view. False after
	 *  manual paging, so a long question can be read without snapping back. */
	followCursor: boolean;
}

interface QuestionRow {
	kind: "option" | "other";
	key: string;
	optionIndex: number | undefined;
}

interface QuestionLayout {
	lines: string[];
	rowStarts: number[];
	/** Line ranges of pictures, drawn only where they fit whole. */
	pictures: { start: number; end: number; picture: AskPicture }[];
}

interface DialogCallbacks {
	onSubmit(result: PickerSubmit): void;
	onCancel(draft: PickerDraft): void;
}

interface PromptRequest {
	title: string;
	/** Text and images already in this field; images stay while their label stays in the text. */
	current: AnswerText | undefined;
	/** Receives the saved text; empty text clears the field. */
	apply(text: AnswerText | undefined): void;
}

/** What a key or a pointer action does to the highlighted row. */
type RowCommand = "enter" | "space" | "edit" | "clear";

type Span = ReturnType<typeof span>;

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(value, max));
}

function displayText(text: string): string {
	return replaceTabs(sanitizeCarriageReturns(text));
}

function inlineText(text: string): string {
	return replaceTabs(text).replace(/\s+/g, " ").trim();
}

function optionMarker(multi: boolean, checked: boolean): string {
	if (multi) return checked ? theme.checkbox.checked : theme.checkbox.unchecked;
	return checked ? theme.radio.selected : theme.radio.unselected;
}

function tabLabel(question: AskQuestion, index: number): string {
	const base = inlineText(displayText(question.tab)) || `Q${index + 1}`;
	return truncateToWidth(base, MAX_TAB_LABEL_WIDTH, Ellipsis.Unicode);
}

/** `lines` cut to `room` rows (at least 1), the last row saying how many were left out. */
function fitLines(lines: readonly string[], room: number): string[] {
	if (lines.length <= room) return [...lines];
	return [...lines.slice(0, room - 1), theme.fg("dim", `… ${lines.length - room + 1} more lines`)];
}

/** The option rows, then `Other` when the question offers one. */
function questionRows(question: AskQuestion): QuestionRow[] {
	const rows: QuestionRow[] = question.options.map((_, index) => ({
		kind: "option",
		key: `option:${index}`,
		optionIndex: index,
	}));
	if (question.field.other) rows.push({ kind: "other", key: "other", optionIndex: undefined });
	return rows;
}

/** Spans styled over `base`, as native ask's form rows draw them; code keeps the Markdown code color. */
function styleSpans(spans: readonly FormSpan[], base: (text: string) => string): string {
	let out = "";
	for (const item of spans) {
		const value = displayText(item.text).replace(/\n/g, " ");
		if (item.style === "code") out += theme.fg("mdCode", value);
		else if (item.style === "strong") out += theme.bold(base(value));
		else if (item.style === "em") out += theme.italic(base(value));
		else out += base(value);
	}
	return out;
}

/** Spans as Tern spans; `extra` tokens apply to every run. */
function nativeSpans(spans: readonly FormSpan[], extra: string | undefined): Span[] {
	return spans.map(item => {
		const tokens = [item.style, extra].filter(Boolean).join(" ");
		return span(displayText(item.text), tokens || undefined);
	});
}

/** Whether the state differs from how the form opens. */
function changedFromForm(question: AskQuestion, state: QuestionState): boolean {
	const initial = initialAnswer(question).checked;
	return (
		state.otherPicked ||
		state.other !== undefined ||
		state.notes.size > 0 ||
		initial.size !== state.checked.size ||
		[...state.checked].some(index => !initial.has(index))
	);
}

/** Whether a Picker draft holds anything you entered: a pick, text, a Submit note, or a Picker btw turn. */
function hasAnswers(form: AskForm, draft: PickerDraft): boolean {
	return (
		draft.submitNote !== undefined ||
		draft.btwTurns.length > 0 ||
		draft.states.some((state, index) => {
			const question = form.questions[index];
			return question !== undefined && changedFromForm(question, state);
		})
	);
}

/** Every option note, in option order. */
function optionNotes(question: AskQuestion, state: QuestionState): { option: string; note: string; picked: boolean }[] {
	return question.options.flatMap((_, index) => {
		const note = state.notes.get(index);
		return note ? [{ option: optionText(question, index), note: note.text, picked: state.checked.has(index) }] : [];
	});
}

/** Submit-tab summary line. */
function answerSummary(question: AskQuestion, state: QuestionState): string {
	const parts = answerParts(question, state);
	if (parts.length > 0) return parts.join(", ");
	return theme.fg("warning", question.field.required ? "unanswered (required)" : "unanswered");
}

/** Markdown of a question's context, without its pictures. */
function contextMarkdown(question: AskQuestion): string {
	return question.context
		.flatMap(part => (part.kind === "markdown" ? [part.text] : []))
		.join("\n\n")
		.trim();
}

/** Preview blocks: Markdown, with fenced code syntax-highlighted (native parity). */
function renderPreview(preview: string, width: number): string[] {
	const out: string[] = [];
	const markdown: string[] = [];
	let fence: { char: string; length: number; language: string | undefined; code: string[] } | undefined;
	const flushMarkdown = () => {
		if (markdown.length === 0) return;
		out.push(
			...new Markdown(markdown.join("\n"), 0, 0, getMarkdownTheme(), { color: t => theme.fg("muted", t) }).render(
				width,
			),
		);
		markdown.length = 0;
	};
	const flushCode = () => {
		if (!fence) return;
		out.push(...new Text(highlightCode(fence.code.join("\n"), fence.language).join("\n"), 0, 0).render(width));
		fence = undefined;
	};
	for (const line of replaceTabs(preview).split("\n")) {
		const fenceMatch = /^(\s{0,3})(`{3,}|~{3,})(.*)$/.exec(line);
		if (fence) {
			const marker = fenceMatch?.[2] ?? "";
			if (fenceMatch && marker.startsWith(fence.char) && marker.length >= fence.length && !fenceMatch[3]?.trim()) {
				flushCode();
			} else {
				fence.code.push(line);
			}
			continue;
		}
		if (fenceMatch) {
			flushMarkdown();
			const marker = fenceMatch[2] ?? "";
			const language = fenceMatch[3]?.trim().split(/\s+/, 1)[0] || undefined;
			fence = { char: marker[0] ?? "`", length: marker.length, language, code: [] };
			continue;
		}
		markdown.push(line);
	}
	flushCode();
	flushMarkdown();
	return out;
}

function pageKeysLabel(): string {
	const pageUp = editorKey("tui.select.pageUp");
	const pageDown = editorKey("tui.select.pageDown");
	return `${pageUp === "pageup" ? "PgUp" : pageUp}/${pageDown === "pagedown" ? "PgDn" : pageDown}`;
}

function cancelKeyLabel(): string {
	const [key = ""] = editorKey("tui.select.cancel").split("/");
	return key === "escape" ? "Esc" : key;
}

function isEnter(data: string): boolean {
	return matchesKey(data, "enter") || matchesKey(data, "return") || data === "\n";
}

function isSpace(data: string): boolean {
	return matchesKey(data, "space") || data === " ";
}

/** The printable character a key sends, for single-letter shortcuts. */
function printableKey(data: string): string | undefined {
	return data.length === 1 ? data : decodePrintableKey(data);
}

function isUpKey(data: string): boolean {
	return getKeybindings().matches(data, "tui.select.up") || printableKey(data) === "k";
}

function isDownKey(data: string): boolean {
	return getKeybindings().matches(data, "tui.select.down") || printableKey(data) === "j";
}

/** Tab/→/l next tab, Shift+Tab/←/h previous tab. */
function handleTabKey(data: string, switchTab: (direction: 1 | -1) => void): boolean {
	if (handleTabSwitchKey(data, switchTab)) return true;
	const key = printableKey(data);
	if (key !== "h" && key !== "l") return false;
	switchTab(key === "l" ? 1 : -1);
	return true;
}

function isEditKey(data: string): boolean {
	const key = printableKey(data);
	return key === "n" || key === "N";
}

function isClearKey(data: string): boolean {
	const key = printableKey(data);
	return key === "x" || key === "X";
}

function isBtwKey(data: string): boolean {
	return printableKey(data) === "?";
}

/** The last segment of a native event key path (`"q0/option:1"` → `"option:1"`). */
function leafKey(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

/** Name of the picker's Tern stylesheet (`s` verb, one per surface; resending replaces it in place). */
const NATIVE_SHEET_NAME = "omp-tools-ask";
// Tern program sheets reach only strict descendants of a region. Read
// --sf-fs/--sf-lh on the row; assigning them on .sf-region cannot apply.
const NATIVE_SHEET = `
${SCROLL_BOX_CSS}
.sf-list[data-role='omp-tools.ask-body'] > .sf-list-scroll > .sf-list-slot > .sf-col { gap: 0; }
.sf-list[data-role='omp-tools.ask-body'] [data-role='omp.ask.question'] { margin-bottom: 6px; }
[data-role^='omp-tools.ask-row'] {
	padding: 2px 10px;
	border-radius: 8px;
	font-family: var(--sans);
	transition: background-color 120ms ease;
}
[data-role^='omp-tools.ask-row'] .sf-col { gap: 0; }
[data-role^='omp-tools.ask-row']:hover { background: var(--l1); }
[data-role='omp-tools.ask-row.on'], [data-role='omp-tools.ask-row.on']:hover { background: var(--l2); }
[data-role='omp-tools.ask-label'] { font: 500 var(--sf-fs, 13px)/var(--sf-lh, 17px) var(--sans); color: var(--t1); }
[data-role='omp-tools.ask-label'] .sf-t-code { font-family: var(--tv-font, var(--mono)); }
[data-role^='omp-tools.ask-row'] .sf-md, [data-role^='omp-tools.ask-row'] .sf-md .md { font-family: var(--sans); font-size: var(--sf-fs, 13px); line-height: var(--sf-lh, 17px); color: var(--t3); }
[data-role^='omp-tools.ask-row'] .sf-md code { font-family: var(--tv-font, var(--mono)); }
[data-role='omp-tools.ask-typed'] { font: var(--sf-fs, 13px)/var(--sf-lh, 17px) var(--sans); }
[data-role='omp-tools.ask-marker'] { font-size: 0.75em; line-height: var(--sf-lh, 17px); }
[data-role='omp-tools.ask-answers'] { font-family: var(--sans); font-size: 13px; }
[data-role='omp-tools.ask-title'] { font: 600 13px/1.4 var(--sans); color: var(--t3); }
`;

/**
 * The stylesheet message (`ESC _ tsp;s;{name,css} ESC \`) for the live surface;
 * pi-tui sends no `s` of its own. A sheet belongs to one surface, and pi-tui
 * opens a new inline surface (same describe context) when the terminal drops
 * the old one, so the picker sends this with every describe.
 */
const NATIVE_SHEET_MESSAGE = `\x1b_tsp;s;${JSON.stringify({ name: NATIVE_SHEET_NAME, css: NATIVE_SHEET })}\x1b\\`;

/** A button that runs one key's path, drawn as pi-tui's `actionButton` (label and keycap). */
function actionButton(label: string, act: string, key: string, options: { accent?: boolean; title?: string } = {}): NativeNode {
	return node(
		"row",
		{
			role: "omp.btn",
			gap: "xs",
			align: "center",
			actions: { click: act },
			title: options.title ?? label,
			...(options.accent ? { tone: "accent" as const } : {}),
		},
		[text(label), kbd(key)],
		act,
	);
}

/** A row of buttons; `null` is the spacer that end-aligns what follows. */
function actionBar(buttons: readonly (NativeNode | null)[]): NativeNode {
	const children = buttons.map(button => button ?? node("spacer", { grow: 1 }));
	return node("row", { role: "omp.actions", gap: "sm", align: "center" }, children, "actions");
}

class Picker implements Component, Focusable {
	#focused = false;
	readonly #form: AskForm;
	readonly #questions: AskQuestion[];
	readonly #states: QuestionState[];
	readonly #tui: TUI;
	readonly #callbacks: DialogCallbacks;
	readonly #options: DialogOptions;
	readonly #pictures: AskPictures;
	readonly #panel = new OverlayPanel("Ask");
	readonly #header = new PanelRows();
	readonly #body = new PanelRows();
	readonly #footer = new PanelRows();
	#activeTab = 0;
	#submitScroll = 0;
	#bodyRows = MIN_BODY_ROWS;
	#countdown: CountdownTimer | undefined;
	#remainingSeconds: number | undefined;
	/** When the countdown answers, as of its last (re)start; drives the Tern ring. */
	#countdownDeadline = 0;
	/** Re-describes the Tern ring once a second; its value is data, not a terminal clock. */
	#ringTick: ReturnType<typeof setInterval> | undefined;
	/** Stopped by `?`; the next key in the options restarts it in full. */
	#countdownPaused = false;
	#timeoutPending = false;
	#closed = false;
	#notice: { text: string; tone: "warning" | "muted" } | undefined;
	#prompt: AnswerEditor | undefined;
	#btw: PickerBtwView | undefined;
	readonly #btwTurns: SideQuestionTurn[];
	#btwOpen = false;
	/** Rows of the last options render; the Picker btw view is at least this tall. */
	#optionsHeight = 0;
	/** Images pasted into the open prompt; filtered by label on submit. */
	#promptImages: AskImage[] = [];
	/** Dialog-wide counter so `[Image #N]` labels stay unique across fields. */
	#imageCount = 0;
	/** Latest layout per `question:width`; rebuilt when answer/cursor state changes. */
	#layoutCache = new Map<string, { stateKey: string; layout: QuestionLayout }>();
	/** Markdown blocks keyed by color and source; reused across cursor moves. */
	#markdownCache = new Map<string, Markdown>();
	#previewCache = new Map<string, string[]>();
	/** Cursor visibility from the last rendered question body. */
	#renderedCursor: { questionIndex: number; cursorIndex: number; visible: boolean } | undefined;
	/** Written on the Submit tab; sent once for the whole ask. */
	#submitNote: AnswerText | undefined;
	/** PgUp/PgDn and Submit-tab j/k forwarded to Tern, which owns the scroller there. */
	#nativeScroll: NativeScroll | undefined;
	/** Whether Tern draws the picker (`describe`) rather than the classic rows (`render`). */
	#nativeMode = false;
	/** Tern: the terminal takes stylesheets (`styles`), so the picker sends its sheet and rows take the native look. */
	#nativeSheet = false;
	/**
	 * Tern: PgUp/PgDn moved the box away from the highlighted row, which may
	 * now be hidden. The next j/k or action key brings it back instead of
	 * acting, as the classic picker does with a row it did not draw.
	 */
	#nativePagedAway = false;
	/** Tern: bumped to scroll the highlighted row into view again when it did not change. */
	#nativeReveal = 0;
	/** Tern: the scroller key in the last description; a scroller mounted anew starts at its top. */
	#nativeShownBody: string | undefined;
	/** Tern: questions whose scroller was shown; a first showing starts at the question, not the highlighted row. */
	#nativeSeen = new Set<number>();
	/** Tern: the first showing's cursor, unrevealed until it moves or a reveal is asked for; `size` is the box it was checked against. */
	#nativeHold: { index: number; cursor: number; reveal: number; size: string } | undefined;

	constructor(form: AskForm, tui: TUI, callbacks: DialogCallbacks, options: DialogOptions) {
		this.#form = form;
		this.#questions = form.questions;
		this.#tui = tui;
		this.#callbacks = callbacks;
		this.#options = options;
		this.#pictures = new AskPictures(tui, options.cwd);
		const timeoutMs = options.timeout;
		const draft = options.draft;
		this.#states =
			draft?.states ??
			form.questions.map(question => {
				const answer = initialAnswer(question);
				return { ...answer, cursorIndex: initialCursor(question, answer), scrollOffset: 0, followCursor: false };
			});
		this.#btwTurns = draft?.btwTurns ?? [];
		if (draft) {
			this.#activeTab = draft.activeTab;
			this.#submitNote = draft.submitNote;
			this.#imageCount = draft.imageCount;
			if (hasAnswers(form, draft)) this.#notice = { text: "Restored your answers", tone: "muted" };
		}
		if (this.#hasSubmitTab()) {
			this.#panel.addChild(this.#header);
			this.#panel.addChild(new PanelDivider());
		}
		this.#panel.addChild(this.#body);
		this.#panel.addChild(new PanelDivider());
		this.#panel.addChild(this.#footer);
		this.#footer.setHeight(1);
		if (timeoutMs !== undefined && timeoutMs > 0) {
			this.#countdown = new CountdownTimer(
				timeoutMs,
				tui,
				seconds => {
					this.#remainingSeconds = seconds;
					this.#countdownDeadline = Date.now() + seconds * 1000;
				},
				() => this.#handleTimeout(),
			);
		}
	}

	get focused(): boolean {
		return this.#focused;
	}

	/**
	 * Focus given to the Picker while an editor is open goes on to that editor.
	 * The host refocuses its editor slot's child, the Picker, when Ctrl+R history
	 * search closes; the editor must hold focus for the next Ctrl+R and the
	 * external-editor key to reach it rather than the hidden main prompt.
	 */
	set focused(focused: boolean) {
		this.#focused = focused;
		if (!focused || this.#closed) return;
		const editor = this.#btwOpen ? this.#btw?.editor : this.#prompt;
		if (editor) this.#tui.setFocus(editor);
	}

	setUseTerminalCursor(useTerminalCursor: boolean): void {
		this.#prompt?.setUseTerminalCursor(useTerminalCursor);
		this.#btw?.setUseTerminalCursor(useTerminalCursor);
	}

	invalidate(): void {
		this.#layoutCache.clear();
		this.#markdownCache.clear();
		this.#previewCache.clear();
		this.#panel.invalidate();
		this.#prompt?.invalidate?.();
		this.#btw?.invalidate();
	}

	dispose(): void {
		this.#closed = true;
		this.#countdown?.dispose();
		this.#stopRingTick();
		this.#prompt?.dispose();
		this.#prompt = undefined;
		this.#btw?.dispose();
		this.#btw = undefined;
		this.#pictures.dispose();
		this.#panel.dispose();
	}

	get acceptsImages(): boolean {
		return !this.#closed;
	}

	pasteText(_text: string): void {
		this.#refusePaste();
	}

	attachImage(_image: ImageContent): undefined {
		this.#refusePaste();
		return undefined;
	}

	#refusePaste(): void {
		if (this.#closed) return;
		this.#notice = { text: "Open a note (n) or Other to paste", tone: "warning" };
		this.#requestRender();
	}

	handleInput(data: string): void {
		if (this.#closed) return;
		if (this.#btwOpen) {
			// The question box normally holds TUI focus; the countdown stays paused.
			this.#btw?.handleInput(data);
			return;
		}
		this.#countdownPaused = false;
		this.#countdown?.reset();
		if (this.#prompt) {
			// The prompt normally holds TUI focus; keep routing through its wrapper.
			this.#prompt.handleInput(data);
			return;
		}
		const keybindings = getKeybindings();
		this.#notice = undefined;
		if (keybindings.matches(data, "tui.select.cancel")) {
			this.#finish(undefined);
			return;
		}
		if (isBtwKey(data) && this.#options.askBtw) {
			this.#openBtw(this.#options.askBtw);
			return;
		}
		if (this.#hasSubmitTab() && handleTabKey(data, direction => this.#switchTab(direction))) {
			this.#requestRender();
			return;
		}
		if (this.#isSubmitTab()) {
			this.#handleSubmitTabInput(data);
			return;
		}
		this.#handleQuestionInput(data);
	}

	/** `?`: swap the options for the Picker btw thread and pause the countdown. */
	#openBtw(ask: AskPickerBtw): void {
		this.#countdown?.dispose();
		this.#countdownPaused = this.#countdown !== undefined;
		this.#btw ??= new PickerBtwView({
			tui: this.#tui,
			turns: this.#btwTurns,
			ask,
			cwd: this.#options.cwd,
			draftAnswers: () => formatAskAnswer(this.#answer(false)),
			heightRatio: DIALOG_HEIGHT_RATIO,
			autocomplete: this.#options.autocomplete,
			fileCommands: this.#options.fileCommands,
			editExternally: text => this.#editExternally(text),
			notify: this.#options.notify,
			onClose: () => {
				this.#btwOpen = false;
				if (!this.#closed) this.#tui.setFocus(this);
				this.#requestRender();
			},
		});
		this.#btwOpen = true;
		this.#btw.open();
	}

	render(width: number): readonly string[] {
		this.#nativeMode = false;
		const termRows = this.#tui.terminal?.rows ?? process.stdout.rows ?? 40;
		// Panels render two columns wider, then lose their `│` side borders.
		const innerWidth = Math.max(1, width - 2);
		if (this.#btwOpen && this.#btw) return this.#btw.render(width, termRows, this.#optionsHeight);
		if (this.#prompt) return this.#renderPrompt(width, innerWidth, termRows);

		const tabRows = this.#hasSubmitTab() ? 2 : 0;
		const total = this.#dialogHeight(innerWidth, termRows);
		// top border + [tab bar + divider] + body + divider + footer + bottom border
		const bodyRows = Math.max(MIN_BODY_ROWS, total - 4 - tabRows);
		this.#bodyRows = bodyRows;
		if (this.#hasSubmitTab()) this.#header.setLines(this.#renderTabBar(innerWidth));
		const body = this.#isSubmitTab()
			? this.#renderSubmitBody(innerWidth, bodyRows)
			: this.#renderQuestionBody(innerWidth, bodyRows);
		this.#panel.title = this.#countdownPaused
			? "Ask (timer paused)"
			: this.#remainingSeconds === undefined
				? "Ask"
				: `Ask (${this.#remainingSeconds}s)`;
		this.#body.setLines(body.lines);
		this.#body.setHeight(bodyRows);
		this.#footer.setLines([theme.fg("dim", truncateToWidth(this.#footerHint(body.indicator), innerWidth))]);
		const lines = withoutSideBorders(this.#panel.render(width + 2), width);
		this.#optionsHeight = lines.length;
		return lines;
	}

	// ---------------------------------------------------------------------------
	// Tern view: the same state as native nodes, in the composer's place
	// ---------------------------------------------------------------------------

	/**
	 * A column with the prompt editor's root role (`omp.editor`), as pi-tui's
	 * AskDialogComponent: the tabs and countdown, then the open editor, the
	 * Picker btw thread, the Submit summary, or the question and its options,
	 * then buttons for the keys. The middle part is as tall as its content up
	 * to a cap from the pane's height, and scrolls inside it.
	 */
	describe(cx: DescribeContext): NativeNode {
		// Classic-only scroll state: Tern owns the scroller; `#nativePagedAway` stands in for it.
		this.#renderedCursor = undefined;
		this.#nativeMode = true;
		this.#nativeSheet = cx.feature("styles");
		// Before the frame that uses it, on whatever surface is live; the same sheet replaces itself in place.
		if (this.#nativeSheet) this.#tui.terminal.write(NATIVE_SHEET_MESSAGE);
		const shownBody = this.#nativeShownBody;
		this.#nativeShownBody = undefined;
		const { lines, width } = this.#nativeHeights(cx);
		const children: NativeChild[] = [];
		const head = this.#describeHead(cx);
		if (head) children.push(head);
		if (this.#btwOpen && this.#btw) {
			children.push(...this.#btw.describe(Math.max(3, lines - NATIVE_EDITOR_LINES + NATIVE_ACTION_LINES)));
		} else if (this.#prompt) {
			// Above the editor: what it annotates, as tall as it needs up to the cap.
			const room = Math.max(3, lines - NATIVE_EDITOR_LINES + NATIVE_ACTION_LINES);
			const content = node("col", { gap: "sm" }, this.#describePromptContext());
			children.push(scrollBox(content, { lines: room, fixed: false, key: "context", scroll: undefined }));
			children.push(this.#prompt);
		} else if (this.#isSubmitTab()) {
			this.#describeSubmitBody(children, lines);
		} else {
			this.#describeQuestionBody(children, { lines, width }, shownBody);
		}
		if (this.#notice) children.push(text([span(this.#notice.text, this.#notice.tone)], { wrap: "word" }));
		// Inline `min`/`max` widths beat the composer's measure: the picker spans the pane.
		return col(children, { role: "omp.editor", gap: "sm", min: { w: 1 }, max: { w: 1 } });
	}

	/** The question's Markdown and pictures in form order, under its title when `withTitle`. */
	#describeContext(question: AskQuestion, withTitle: boolean): NativeChild[] {
		const children: NativeChild[] = [];
		const title = withTitle ? displayText(question.title).trim() : "";
		if (title) {
			const spans = [span(title, "muted strong")];
			children.push(node("text", { spans, wrap: "word", role: "omp-tools.ask-title" }, undefined, "title"));
		}
		question.context.forEach((part, index) => {
			if (part.kind !== "markdown") {
				children.push({ ...this.#pictures.describe(part), key: `context:${index}` });
				return;
			}
			const markdown = displayText(part.text).trim();
			if (markdown) children.push(node("md", { text: markdown, role: "omp.ask.question" }, undefined, `context:${index}`));
		});
		return children;
	}

	/**
	 * What the open editor annotates: for a note or `Other` text, the
	 * question's title and context over the row being edited (without its
	 * saved text, which the editor holds); for the Submit note, every answer.
	 */
	#describePromptContext(): NativeChild[] {
		if (this.#isSubmitTab()) return this.#describeAnswers();
		const index = this.#questionIndex();
		const question = this.#questions[index];
		const state = this.#states[index];
		if (!question || !state) return [];
		const children = this.#describeContext(question, true);
		const row = questionRows(question)[state.cursorIndex];
		if (row) children.push(this.#describeRow(question, state, row, state.cursorIndex, "none", false));
		return children;
	}

	/**
	 * Most text lines of the one scrolling box (the question and its options,
	 * the Submit tab, an editor's context, or the Picker btw thread): the
	 * classic dialog's share of the pane's rows less the picker's other parts.
	 * The box is as tall as its content up to this cap; anything taller
	 * scrolls. The Picker btw thread keeps the full cap so it does not grow
	 * with each turn.
	 */
	#nativeHeights(cx: DescribeContext): { lines: number; width: number } {
		const termRows = this.#tui.terminal?.rows ?? process.stdout.rows ?? 40;
		const lines = Math.max(MIN_BODY_ROWS, Math.floor(termRows * DIALOG_HEIGHT_RATIO) - NATIVE_CHROME_LINES);
		return { lines, width: Math.max(1, cx.cols - NATIVE_INSET_COLS) };
	}

	/** Question tabs (plus Submit) and the countdown; only the countdown while an editor is open. */
	#describeHead(cx: DescribeContext): NativeNode | undefined {
		const children: NativeChild[] = [];
		if (this.#hasSubmitTab() && !this.#prompt && !this.#btwOpen) {
			const items = this.#questions.map((question, index) => ({ id: String(index), label: tabLabel(question, index) }));
			items.push({ id: "submit", label: SUBMIT_OPTION });
			const active = this.#isSubmitTab() ? "submit" : String(this.#questionIndex());
			children.push(node("tabs", { items, active, role: "omp.ask.questions" }, undefined, "tabs"));
		}
		const timer = this.#describeTimer(cx);
		if (timer) children.push(node("spacer", { grow: 1 }), timer);
		if (children.length === 0) return undefined;
		return node("row", { role: "omp.ask.head", gap: "sm", align: "center" }, children, "head");
	}

	/** The countdown as pi-tui's ask draws it: a ring when Tern draws meters, else a terminal-clocked `elapsed`. */
	#describeTimer(cx: DescribeContext): NativeNode | undefined {
		const countdown = this.#countdown;
		if (!countdown || this.#closed) return undefined;
		if (this.#countdownPaused) {
			this.#stopRingTick();
			return node("text", { spans: [span("timer paused", "dim")] }, undefined, "paused");
		}
		const title = "Submits the current answers when the time runs out";
		if (!cx.supports("meter")) return node("row", { title }, [countdown.describe()], "elapsed");
		this.#startRingTick();
		const total = Math.max(1, this.#options.timeout ?? 1);
		const left = Math.max(0, this.#countdownDeadline - Date.now());
		return node(
			"meter",
			{
				value: Math.round((left / total) * 1000) / 1000,
				style: "ring",
				size: "sm",
				label: `${Math.ceil(left / 1000)}s`,
				title,
			},
			undefined,
			"timer",
		);
	}

	#startRingTick(): void {
		if (this.#ringTick) return;
		this.#ringTick = setInterval(() => this.#requestRender(), 1000);
		this.#ringTick.unref?.();
	}

	#stopRingTick(): void {
		clearInterval(this.#ringTick);
		this.#ringTick = undefined;
	}

	/**
	 * The question's context over its options, in one fixed-height box
	 * (PgUp/PgDn, j/k, and the wheel scroll it), then the buttons.
	 */
	#describeQuestionBody(
		children: NativeChild[],
		size: { lines: number; width: number },
		shownBody: string | undefined,
	): void {
		const index = this.#questionIndex();
		const question = this.#questions[index];
		const state = this.#states[index];
		if (!question || !state) return;
		const rows = questionRows(question);
		// Keyed per question: a click aimed at one question's rows never lands on the next, and each tab starts at its top.
		const key = `q${index}`;
		const mounted = shownBody !== key;
		if (!this.#nativeSeen.has(index)) {
			// First showing: keep the question in view. A highlighted row below the box counts as scrolled away, so the first key reveals it.
			this.#nativeSeen.add(index);
			this.#nativeHold = { index, cursor: state.cursorIndex, reveal: this.#nativeReveal, size: `${size.lines}:${size.width}` };
			this.#nativePagedAway = !this.#nativeCursorFits(index, state.cursorIndex, size);
		} else if (mounted) {
			// Mounted again (a tab switch, or back from an editor): the scroller starts at its top, so bring the highlighted row in.
			this.#nativeHold = undefined;
			this.#nativePagedAway = false;
		}
		const hold = this.#nativeHold;
		const held = hold?.index === index && hold.cursor === state.cursorIndex && hold.reveal === this.#nativeReveal;
		if (!held) {
			this.#nativeHold = undefined;
		} else if (hold.size !== `${size.lines}:${size.width}`) {
			// The pane was resized before any move: a row that fit can now end below the box.
			hold.size = `${size.lines}:${size.width}`;
			if (!this.#nativeCursorFits(index, state.cursorIndex, size)) this.#nativePagedAway = true;
		}
		const reveal = held ? "none" : mounted ? "mount" : "token";
		this.#nativeShownBody = key;
		const body = this.#describeContext(question, false);
		for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
			body.push(this.#describeRow(question, state, rows[rowIndex]!, rowIndex, reveal));
		}
		children.push(this.#scroller(body, size.lines, key));
		children.push(this.#describeQuestionActions(question, state, rows[state.cursorIndex]));
	}

	/** Whether row `cursor` ends inside the box with the box at its top, estimated from the classic layout as `#nativeHeights` sizes it. */
	#nativeCursorFits(index: number, cursor: number, size: { lines: number; width: number }): boolean {
		const question = this.#questions[index];
		if (!question) return true;
		const layout = this.#questionLayout(index, size.width);
		const headings = contextMarkdown(question)
			.split("\n")
			.filter(line => /^\s*#{1,6}\s/.test(line)).length;
		const end = (layout.rowStarts[cursor + 1] ?? layout.lines.length) + headings + this.#nativeRowExtra(cursor + 1);
		return end <= size.lines;
	}

	/** Text lines that `count` Tern rows add beyond their text: the gap between rows, plus the sheet's padding. */
	#nativeRowExtra(count: number): number {
		return Math.ceil(count * (this.#nativeSheet ? NATIVE_STYLED_ROW_LINES : NATIVE_ROW_GAP_LINES));
	}

	/** A scroller as tall as its content up to `lines`; PgUp/PgDn and Submit-tab j/k move it. */
	#scroller(children: readonly NativeChild[], lines: number, key: string): NativeNode {
		return scrollBox(node("col", { gap: "sm" }, children), { lines, fixed: false, key, scroll: this.#nativeScroll });
	}

	/**
	 * One option as a compact row: the marker, then the label over its
	 * Markdown description, preview, and note or `Other` text, all hanging
	 * from the label. The highlighted row's marker and label are accent (as in
	 * the classic picker), and it is kept in view. A click is Space on it, a
	 * double-click Enter. `showText` false leaves out the note or `Other`
	 * text, for the row above its own editor.
	 */
	#describeRow(
		question: AskQuestion,
		state: QuestionState,
		row: QuestionRow,
		rowIndex: number,
		reveal: "none" | "mount" | "token",
		showText = true,
	): NativeNode {
		const option = row.kind === "option" ? question.options[row.optionIndex ?? -1] : undefined;
		const checked = this.#isPickedRow(state, row);
		const cursor = rowIndex === state.cursorIndex;
		const disabled = option?.disabled === true;
		// With the sheet, the highlighted row is a neutral fill and the label stays primary text, as native ask's items.
		const styled = this.#nativeSheet;
		const labelStyle = disabled ? "dim" : !styled && cursor ? "accent strong" : undefined;
		const labelText = node(
			"text",
			{
				spans: option ? nativeSpans(option.label, labelStyle) : [span(OTHER_OPTION, labelStyle)],
				wrap: "word",
				role: "omp-tools.ask-label",
			},
			undefined,
			"label",
		);
		const badges = [
			...(option?.recommended ? [node("badge", { text: "Recommended", tone: "success" })] : []),
			...(disabled ? [node("badge", { text: "Unavailable" })] : []),
		];
		const labelLine =
			badges.length > 0 ? node("row", { gap: "sm", align: "center", wrap: true }, [labelText, ...badges], "label-line") : labelText;

		const lines: NativeChild[] = [labelLine];
		const description = option?.description ? displayText(option.description).trim() : "";
		if (description) lines.push(node("md", { text: description, role: "omp.ask.description" }, undefined, "description"));
		const preview = option?.preview ? displayText(option.preview) : "";
		if (preview.trim()) lines.push(node("md", { text: preview, role: "omp.ask.preview" }, undefined, "preview"));
		const typed = row.kind === "other" ? state.other?.text : state.notes.get(row.optionIndex ?? -1)?.text;
		if (showText && typed !== undefined) {
			const spans =
				row.kind === "other"
					? [span(inlineText(typed), checked ? "muted" : "dim")]
					: [span("✎ ", "success"), span(inlineText(typed), "success")];
			lines.push(node("text", { spans, wrap: "word", role: "omp-tools.ask-typed" }, undefined, "text"));
		}
		const multi = question.field.multi;
		const markerStyle = checked ? (multi ? "success" : "strong") : !styled && cursor ? "accent" : "dim";
		const marker = span(optionMarker(multi, checked), markerStyle);
		const role = cursor ? "omp-tools.ask-row.on" : "omp-tools.ask-row";
		return {
			...node(
				"row",
				{
					role,
					gap: "sm",
					align: "start",
					actions: { click: "pick", dblclick: "enter" },
				},
				[
					node("text", { spans: [marker], shrink: 0, role: "omp-tools.ask-marker" }, undefined, "marker"),
					node("col", { gap: "xs", grow: 1, basis: 0 }, lines, "lines"),
				],
				row.key,
			),
			// The highlighted row scrolls into view when it is mounted, becomes the highlighted one, or is revealed again; not on a question's first showing.
			...(cursor && reveal !== "none"
				? { reveal: reveal === "mount" ? ("nearest" as const) : { at: "nearest" as const, n: this.#nativeReveal } }
				: {}),
		};
	}

	/** The question tab's keys as buttons: `?`, Space, `n`, `x`, Esc, Enter. */
	#describeQuestionActions(question: AskQuestion, state: QuestionState, row: QuestionRow | undefined): NativeNode {
		const btw = this.#options.askBtw ? actionButton("Ask aside", "btw", "?", { title: "Picker btw: ask a side question  ?" }) : null;
		const cancel = actionButton("Cancel", "cancel", "escape");
		if (!row) return actionBar([btw, null, cancel]);
		const typed = row.kind === "other" ? state.other : state.notes.get(row.optionIndex ?? -1);
		if (row.kind === "other" && !typed) {
			return actionBar([btw, null, actionButton("Type answer", "edit", "n", { accent: true }), cancel]);
		}
		const noun = row.kind === "other" ? "answer" : "note";
		const edit = actionButton(typed ? `Edit ${noun}` : `Add ${noun}`, "edit", "n");
		const clear = typed ? actionButton(`Clear ${noun}`, "clear", "x") : null;
		const disabled = row.kind === "option" && question.options[row.optionIndex ?? -1]?.disabled === true;
		const pick = disabled ? null : actionButton(this.#isPickedRow(state, row) ? "Unpick" : "Pick", "space", "space");
		const next = this.#hasSubmitTab() ? "next" : "submit";
		const enterLabel = question.field.multi ? `${next[0]?.toUpperCase()}${next.slice(1)}` : `Pick & ${next}`;
		const moves = this.#hasSubmitTab() ? "j/k move · h/l tabs" : "j/k move";
		const enter = actionButton(enterLabel, "enter", "enter", { accent: true, title: `${enterLabel}  enter · ${moves}` });
		const buttons = [btw, null, pick, edit, clear, cancel, enter].filter((button, index) => button !== null || index === 1);
		return actionBar(buttons);
	}

	/** Submit tab: unanswered warning, every answer and note, the Submit note (in the scroller), then the buttons. */
	#describeSubmitBody(children: NativeChild[], lines: number): void {
		children.push(this.#scroller(this.#describeAnswers(), lines, "submit"));
		const submitNote = this.#submitNote;
		const btw = this.#options.askBtw ? actionButton("Ask aside", "btw", "?", { title: "Picker btw: ask a side question  ?" }) : null;
		const edit = actionButton(submitNote ? "Edit note" : "Add note", "edit", "n", { title: "A note on all answers  n" });
		const clear = submitNote ? actionButton("Clear note", "clear", "x") : null;
		const cancel = actionButton("Cancel", "cancel", "escape");
		const submit = actionButton(SUBMIT_OPTION, "enter", "enter", { accent: true, title: "Submit  enter · h/l tabs" });
		children.push(actionBar(clear ? [btw, null, edit, clear, cancel, submit] : [btw, null, edit, cancel, submit]));
	}

	/** How many questions are unanswered, and how many of those Submit requires. */
	#unansweredWarning(): string | undefined {
		const unanswered = this.#questions.filter((question, index) => {
			const state = this.#states[index];
			return state !== undefined && !isAnswered(question, state);
		});
		if (unanswered.length === 0) return undefined;
		const required = unanswered.filter(question => question.field.required).length;
		if (required > 0) return `${required} required question${required === 1 ? "" : "s"} unanswered; Enter shows the first.`;
		return `${unanswered.length} unanswered question${unanswered.length === 1 ? "" : "s"}; Enter still submits.`;
	}

	/** The unanswered warning, then every answer and note and the Submit note as key/value rows. */
	#describeAnswers(): NativeNode[] {
		const body: NativeNode[] = [];
		const warning = this.#unansweredWarning();
		if (warning) {
			body.push(node("text", { spans: [span(warning, "warning")], role: "omp-tools.ask-answers" }, undefined, "warning"));
		}
		const items: { k: Span[]; v: Span[] }[] = [];
		for (let index = 0; index < this.#questions.length; index++) {
			const question = this.#questions[index];
			const state = this.#states[index];
			if (!question || !state) continue;
			const parts = answerParts(question, state);
			items.push({
				k: [span(`${index + 1}. ${tabLabel(question, index)}`, "dim")],
				v: parts.length > 0 ? [span(parts.join(", "))] : [span(question.field.required ? "unanswered (required)" : "unanswered", "warning")],
			});
			for (const { option, note, picked } of optionNotes(question, state)) {
				items.push({
					k: [span(`Note (${inlineText(option)}${picked ? "" : ", not picked"})`, "dim")],
					v: [span(inlineText(note), "muted")],
				});
			}
		}
		const submitNote = this.#submitNote;
		items.push({
			k: [span("Submit note", "dim")],
			v: submitNote ? [span(inlineText(submitNote.text), "muted")] : [span("none", "dim")],
		});
		body.push(node("kv", { items, role: "omp-tools.ask-answers" }, undefined, "answers"));
		return body;
	}

	/**
	 * Pointer actions run the key paths: a tab click switches to it, a card
	 * click highlights it and is Space, a double-click is Enter, and each
	 * button is its key. Ignored while an editor or the Picker btw owns input.
	 */
	handleNativeEvent(event: NativeUiEvent): void {
		if (this.#closed || this.#prompt || this.#btwOpen) return;
		this.#notice = undefined;
		this.#countdownPaused = false;
		this.#countdown?.reset();
		if (event.type === "select" && leafKey(event.key) === "tabs") {
			const target = event.item === "submit" ? this.#questions.length : Number(event.item);
			if (!this.#hasSubmitTab() || !Number.isInteger(target) || target < 0 || target > this.#questions.length) return;
			this.#activeTab = target;
			this.#submitScroll = 0;
			this.#requestRender();
			return;
		}
		if (event.type !== "action") return;
		if (event.act === "cancel") {
			this.#finish(undefined);
			return;
		}
		if (event.act === "btw") {
			if (this.#options.askBtw) this.#openBtw(this.#options.askBtw);
			return;
		}
		const command = event.act === "pick" ? "space" : event.act;
		if (command !== "enter" && command !== "space" && command !== "edit" && command !== "clear") return;
		if (this.#isSubmitTab()) {
			if (command !== "space") this.#runSubmitCommand(command);
			return;
		}
		const index = this.#questionIndex();
		const question = this.#questions[index];
		const state = this.#states[index];
		if (!question || !state) return;
		// A card names its row; a button acts on the highlighted row.
		const rowIndex = questionRows(question).findIndex(row => row.key === leafKey(event.key));
		if (rowIndex >= 0) {
			if (!event.key.split("/").includes(`q${index}`)) return;
			state.cursorIndex = rowIndex;
			state.followCursor = true;
			this.#nativePagedAway = false;
		} else if (!this.#cursorVisible(index)) {
			// A button acts on the highlighted row: never on one the user scrolled away from.
			this.#revealCursor(state);
			return;
		}
		this.#runRowCommand(question, state, command);
	}

	// ---------------------------------------------------------------------------
	// Layout
	// ---------------------------------------------------------------------------

	#hasSubmitTab(): boolean {
		// Multi-select confirms on the Submit tab, so it forces the tab even for
		// a single question (native parity).
		return this.#questions.length > 1 || this.#questions.some(question => question.field.multi);
	}

	#isSubmitTab(): boolean {
		return this.#hasSubmitTab() && this.#activeTab === this.#questions.length;
	}

	#questionIndex(): number {
		return clamp(this.#activeTab, 0, Math.max(0, this.#questions.length - 1));
	}

	#requestRender(): void {
		this.#tui.requestRender();
	}

	/** The current tab's content plus the panel's chrome, up to the classic dialog's share of the terminal; overflow scrolls. */
	#dialogHeight(width: number, termRows: number): number {
		const maxHeight = Math.max(MIN_DIALOG_ROWS, Math.floor(termRows * DIALOG_HEIGHT_RATIO));
		const chrome = 4 + (this.#hasSubmitTab() ? 2 : 0);
		const body = this.#isSubmitTab()
			? this.#questions.length * 2 + 4
			: this.#questionLayout(this.#questionIndex(), width).lines.length;
		return clamp(chrome + body, MIN_DIALOG_ROWS, maxHeight);
	}

	/** The question's context (Markdown and pictures), a blank separator, then
	 *  every option row. `rowStarts` indexes each row's first line. */
	#questionLayout(index: number, width: number): QuestionLayout {
		const question = this.#questions[index];
		const state = this.#states[index];
		if (!question || !state) return { lines: [], rowStarts: [], pictures: [] };
		const key = [
			index,
			width,
			state.cursorIndex,
			[...state.checked].join("\u0000"),
			state.other?.text ?? "\u0001",
			state.otherPicked,
			[...state.notes].map(([option, note]) => `${option}\u0000${note.text}`).join("\u0000"),
			this.#pictures.version,
		].join("\u0002");
		const cacheKey = `${index}:${width}`;
		const cached = this.#layoutCache.get(cacheKey);
		if (cached?.stateKey === key) return cached.layout;

		const lines: string[] = [];
		const pictures: QuestionLayout["pictures"] = [];
		for (const part of question.context) {
			if (part.kind === "markdown") {
				const markdown = displayText(part.text).trim();
				if (markdown) lines.push(...this.#markdown(markdown, "text").render(Math.max(1, width)));
				continue;
			}
			const start = lines.length;
			lines.push(...this.#pictures.rows(part, Math.max(1, width)));
			pictures.push({ start, end: lines.length, picture: part });
		}
		if (lines.length > 0) lines.push("");
		const rowStarts: number[] = [];
		const rows = questionRows(question);
		for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
			const row = rows[rowIndex];
			if (!row) continue;
			rowStarts.push(lines.length);
			lines.push(...this.#renderRow(question, state, row, rowIndex === state.cursorIndex, width));
		}
		const layout = { lines, rowStarts, pictures };
		this.#layoutCache.set(cacheKey, { stateKey: key, layout });
		return layout;
	}

	#renderRow(question: AskQuestion, state: QuestionState, row: QuestionRow, selected: boolean, width: number, showText = true): string[] {
		const option = row.kind === "option" ? question.options[row.optionIndex ?? -1] : undefined;
		const checked = this.#isPickedRow(state, row);
		const disabled = option?.disabled === true;
		// No `❯` cursor column: the focused row shows as an accent, bold label
		// with an accent marker; the marker glyph alone shows the checked state.
		const color = disabled ? "dim" : selected ? "accent" : checked ? "toolOutput" : "text";
		const markerColor = checked ? "success" : selected ? "accent" : "dim";
		const marker = `${theme.fg(markerColor, optionMarker(question.field.multi, checked))} `;
		const style = (t: string) => (selected ? theme.bold(theme.fg(color, t)) : theme.fg(color, t));
		const suffix = option?.recommended ? RECOMMENDED_SUFFIX : disabled ? " (unavailable)" : "";
		const label = option ? `${styleSpans(option.label, style)}${suffix ? style(suffix) : ""}` : style(OTHER_OPTION);
		const wrapped = wrapTextWithAnsi(label, Math.max(1, width - visibleWidth(marker)));
		// Label wrap lines, descriptions, previews, notes, and custom answers all
		// start at the label's text column so the option reads as one aligned block.
		const labelColumn = visibleWidth(marker);
		const indent = padding(labelColumn);
		const lines = [`${marker}${wrapped[0] ?? ""}`];
		for (let i = 1; i < wrapped.length; i++) lines.push(`${indent}${wrapped[i] ?? ""}`);

		const detailWidth = Math.max(1, width - labelColumn);
		const description = option?.description ? displayText(option.description).trim() : "";
		if (description) {
			for (const line of this.#markdown(description, "muted").render(detailWidth)) lines.push(`${indent}${line}`);
		}
		const preview = option?.preview ? sanitizeCarriageReturns(option.preview) : "";
		if (preview.trim()) {
			const previewWidth = Math.max(1, detailWidth - 2);
			for (const line of this.#preview(preview, previewWidth)) {
				lines.push(`${indent}${theme.fg("border", "│")} ${line}`);
			}
		}
		// Unpicked text stays visible (dim) so nothing typed looks lost.
		const typed = row.kind === "other" ? state.other?.text : state.notes.get(row.optionIndex ?? -1)?.text;
		if (showText && typed !== undefined) {
			const prefix = row.kind === "other" ? "" : "✎ ";
			const shown = truncateToWidth(`${prefix}${inlineText(typed)}`, detailWidth, Ellipsis.Unicode);
			const textColor = row.kind === "other" ? (checked ? "muted" : "dim") : "success";
			lines.push(theme.fg(textColor, `${indent}${shown}`));
		}
		return lines;
	}

	#renderTabBar(width: number): string[] {
		const tabs: Tab[] = [
			...this.#questions.map((question, index) => ({ id: String(index), label: tabLabel(question, index) })),
			{ id: "submit", label: SUBMIT_OPTION },
		];
		const tabBar = new TabBar("", tabs, getTabBarTheme(), this.#activeTab);
		tabBar.showHint = false;
		return [...tabBar.render(width)];
	}

	#renderQuestionBody(width: number, rows: number): { lines: string[]; indicator: string } {
		const index = this.#questionIndex();
		const state = this.#states[index];
		if (!state) return { lines: [], indicator: "" };
		let layout = this.#questionLayout(index, width);
		const scrollbar = layout.lines.length > rows && width > 1;
		if (scrollbar) layout = this.#questionLayout(index, width - 1);
		const maxOffset = Math.max(0, layout.lines.length - rows);
		let offset = clamp(state.scrollOffset, 0, maxOffset);
		if (state.followCursor) {
			const start = layout.rowStarts[state.cursorIndex] ?? 0;
			const end = layout.rowStarts[state.cursorIndex + 1] ?? layout.lines.length;
			if (start < offset || end > offset + rows) offset = end - start <= rows ? end - rows : start;
			offset = clamp(offset, 0, maxOffset);
		}
		state.scrollOffset = offset;
		const cursorStart = layout.rowStarts[state.cursorIndex] ?? 0;
		this.#renderedCursor = {
			questionIndex: index,
			cursorIndex: state.cursorIndex,
			visible: cursorStart >= offset && cursorStart < offset + rows,
		};
		return {
			lines: this.#scrollWindow(this.#fitPictures(layout, offset, rows, scrollbar ? width - 1 : width), offset, rows, width),
			indicator: this.#indicator(offset, rows, layout.lines.length),
		};
	}

	/** The layout's lines with each picture the window cuts replaced by its one-line stand-in, keeping its height. */
	#fitPictures(layout: QuestionLayout, offset: number, rows: number, width: number): string[] {
		const cut = layout.pictures.filter(({ start, end }) => end > offset && start < offset + rows && (start < offset || end > offset + rows));
		if (cut.length === 0) return layout.lines;
		const lines = [...layout.lines];
		for (const { start, end, picture } of cut) {
			lines.splice(start, end - start, this.#pictures.placeholder(picture, width), ...Array<string>(end - start - 1).fill(""));
		}
		return lines;
	}

	#markdown(text: string, color: "text" | "muted"): Markdown {
		const key = `${color}\u0000${text}`;
		let markdown = this.#markdownCache.get(key);
		if (!markdown) {
			markdown = new Markdown(text, 0, 0, getMarkdownTheme(), { color: t => theme.fg(color, t) });
			this.#markdownCache.set(key, markdown);
		}
		return markdown;
	}

	#preview(preview: string, width: number): string[] {
		const key = `${width}\u0000${preview}`;
		let lines = this.#previewCache.get(key);
		if (!lines) {
			lines = renderPreview(preview, width);
			this.#previewCache.set(key, lines);
		}
		return lines;
	}

	#renderSubmitBody(width: number, rows: number): { lines: string[]; indicator: string } {
		const lines: string[] = [];
		const warning = this.#unansweredWarning();
		if (warning) {
			lines.push(theme.fg("warning", warning));
			lines.push("");
		}
		const noteLine = (label: string, text: string) => {
			const prefix = `   ${label}: `;
			const room = Math.max(1, width - visibleWidth(prefix));
			return theme.fg("muted", `${prefix}${truncateToWidth(inlineText(text), room, Ellipsis.Unicode)}`);
		};
		for (let index = 0; index < this.#questions.length; index++) {
			const question = this.#questions[index];
			const state = this.#states[index];
			if (!question || !state) continue;
			const summary = `${theme.fg("dim", `${index + 1}. ${tabLabel(question, index)}:`)} ${answerSummary(question, state)}`;
			lines.push(truncateToWidth(summary, width, Ellipsis.Unicode));
			for (const { option, note, picked } of optionNotes(question, state)) {
				lines.push(noteLine(`Note (${inlineText(option)}${picked ? "" : ", not picked"})`, note));
			}
		}
		lines.push("");
		const submitNote = this.#submitNote;
		lines.push(
			submitNote
				? truncateToWidth(
						`${theme.fg("dim", "Submit note:")} ${theme.fg("muted", inlineText(submitNote.text))}`,
						width,
						Ellipsis.Unicode,
					)
				: theme.fg("dim", "Submit note: none"),
		);
		lines.push("");
		lines.push(theme.fg("accent", `${theme.nav.cursor} ${SUBMIT_OPTION}`));
		this.#submitScroll = clamp(this.#submitScroll, 0, Math.max(0, lines.length - rows));
		return {
			lines: this.#scrollWindow(lines, this.#submitScroll, rows, width),
			indicator: this.#indicator(this.#submitScroll, rows, lines.length),
		};
	}

	#scrollWindow(lines: string[], offset: number, rows: number, width: number): string[] {
		const view = new ScrollView(lines, {
			height: rows,
			scrollbar: "auto",
			theme: { track: t => theme.fg("muted", t), thumb: t => theme.fg("accent", t) },
		});
		view.setScrollOffset(offset);
		const out = [...view.render(width)].slice(0, rows);
		while (out.length < rows) out.push("");
		return out;
	}

	#indicator(offset: number, rows: number, total: number): string {
		const above = offset > 0;
		const below = offset + rows < total;
		if (above && below) return "↕";
		if (above) return "↑";
		if (below) return "↓";
		return "";
	}

	#footerHint(indicator: string): string {
		if (this.#notice) return this.#notice.text;
		const cancel = `${cancelKeyLabel()} cancel`;
		const btw = this.#options.askBtw ? " · ? btw" : "";
		const scroll = indicator ? ` · ${pageKeysLabel()} ${indicator} scroll` : "";
		const tabs = this.#hasSubmitTab() ? " · h/l tabs" : "";
		if (this.#isSubmitTab()) {
			const note = this.#submitNote ? "n edit submit note · x clear it" : "n add submit note";
			return `Enter submit · ${note} · j/k scroll${tabs}${btw} · ${cancel}`;
		}
		const question = this.#questions[this.#questionIndex()];
		const state = this.#states[this.#questionIndex()];
		const row = question && state ? questionRows(question)[state.cursorIndex] : undefined;
		if (!question || !state || !row) return `j/k move${tabs}${scroll}${btw} · ${cancel}`;
		const next = this.#hasSubmitTab() ? "next" : "submit";
		const typed = row.kind === "other" ? state.other : state.notes.get(row.optionIndex ?? -1);
		const noun = row.kind === "other" ? "answer" : "note";
		const disabled = row.kind === "option" && question.options[row.optionIndex ?? -1]?.disabled === true;
		let keys: string;
		if (row.kind === "other" && !typed) {
			keys = "Space/Enter/n type answer";
		} else {
			const edit = typed ? `n edit ${noun} · x clear ${noun}` : `n add ${noun}`;
			const enter = question.field.multi ? `Enter ${next}` : `Enter pick & ${next}`;
			keys = disabled ? `unavailable · ${edit}` : `Space ${this.#isPickedRow(state, row) ? "unpick" : "pick"} · ${enter} · ${edit}`;
		}
		return `${keys} · j/k move${tabs}${scroll}${btw} · ${cancel}`;
	}

	/** Whether `row` is picked: a checked option, or a picked `Other`. */
	#isPickedRow(state: QuestionState, row: QuestionRow): boolean {
		if (row.kind === "other") return state.otherPicked;
		return state.checked.has(row.optionIndex ?? -1);
	}

	// ---------------------------------------------------------------------------
	// Input
	// ---------------------------------------------------------------------------

	/** Enter submits; `n`/`x` edit or clear the Submit note; j/k scroll. */
	#handleSubmitTabInput(data: string): void {
		if (isUpKey(data) || isDownKey(data)) {
			const up = isUpKey(data);
			this.#submitScroll = up ? Math.max(0, this.#submitScroll - 1) : this.#submitScroll + 1;
			this.#scrollNative(up ? "line-up" : "line-down");
			this.#requestRender();
			return;
		}
		const command = isEnter(data) ? "enter" : isEditKey(data) ? "edit" : isClearKey(data) ? "clear" : undefined;
		if (command) this.#runSubmitCommand(command);
	}

	#runSubmitCommand(command: Exclude<RowCommand, "space">): void {
		if (command === "enter") {
			this.#submit();
			return;
		}
		if (command === "edit") {
			this.#openPrompt({
				title: "Submit note",
				current: this.#submitNote,
				apply: text => {
					this.#submitNote = text;
				},
			});
			return;
		}
		this.#submitNote = undefined;
		this.#requestRender();
	}

	#scrollNative(by: NativeScroll["by"]): void {
		this.#nativeScroll = { by, n: (this.#nativeScroll?.n ?? 0) + 1 };
	}

	/** Keys of a question tab: PgUp/PgDn scroll, j/k move, then one row command per key. */
	#handleQuestionInput(data: string): void {
		const index = this.#questionIndex();
		const question = this.#questions[index];
		const state = this.#states[index];
		if (!question || !state) return;
		const rows = questionRows(question);
		const keybindings = getKeybindings();
		const page = Math.max(1, this.#bodyRows - 1);
		if (keybindings.matches(data, "tui.select.pageUp")) {
			state.scrollOffset = Math.max(0, state.scrollOffset - page);
			state.followCursor = false;
			this.#nativePagedAway = true;
			this.#scrollNative("page-up");
			this.#requestRender();
			return;
		}
		if (keybindings.matches(data, "tui.select.pageDown")) {
			state.scrollOffset += page;
			state.followCursor = false;
			this.#nativePagedAway = true;
			this.#scrollNative("page-down");
			this.#requestRender();
			return;
		}
		if (isUpKey(data) || isDownKey(data)) {
			// The first move after reading reveals the cursor instead of skipping past it.
			if (!state.followCursor && !this.#cursorVisible(index)) {
				this.#revealCursor(state);
				return;
			}
			const delta = isUpKey(data) ? -1 : 1;
			state.cursorIndex = clamp(state.cursorIndex + delta, 0, Math.max(0, rows.length - 1));
			state.followCursor = true;
			this.#requestRender();
			return;
		}
		const command = isEnter(data)
			? "enter"
			: isSpace(data)
				? "space"
				: isEditKey(data)
					? "edit"
					: isClearKey(data)
						? "clear"
						: undefined;
		if (!command) return;
		// Never act on a row the user cannot see; reveal it first.
		if (!this.#cursorVisible(index)) {
			this.#revealCursor(state);
			return;
		}
		this.#runRowCommand(question, state, command);
	}

	/**
	 * One meaning per command: Space toggles the row, Enter finishes the
	 * question (a single choice picks the row first), `n` edits the row's text,
	 * `x` clears it. An `Other` without text opens its editor on Space or Enter.
	 */
	#runRowCommand(question: AskQuestion, state: QuestionState, command: RowCommand): void {
		const row = questionRows(question)[state.cursorIndex];
		if (!row) return;
		if (command === "edit" || (row.kind === "other" && !state.other && command !== "clear")) {
			this.#editRow(question, state, row);
			return;
		}
		if (command === "clear") {
			if (row.kind === "other") setOther(question, state, undefined);
			else setNote(state, row.optionIndex ?? -1, undefined);
			this.#requestRender();
			return;
		}
		if (command === "space") {
			if (this.#isPickedRow(state, row)) this.#unpickRow(question, state, row);
			else this.#pickRow(question, state, row);
			this.#requestRender();
			return;
		}
		if (!question.field.multi && !this.#pickRow(question, state, row)) {
			this.#requestRender();
			return;
		}
		this.#advance();
	}

	/** Pick `row`; a single choice unpicks every other row, keeping their text. A disabled option says so. */
	#pickRow(question: AskQuestion, state: QuestionState, row: QuestionRow): boolean {
		if (row.kind === "other") {
			pickOther(question, state);
			return true;
		}
		if (pickOption(question, state, row.optionIndex ?? -1)) return true;
		this.#notice = { text: "This option is unavailable", tone: "warning" };
		return false;
	}

	#unpickRow(question: AskQuestion, state: QuestionState, row: QuestionRow): void {
		if (row.kind === "other") state.otherPicked = false;
		else unpickOption(question, state, row.optionIndex ?? -1);
	}

	/** Open the row's editor: the option's Note, or the `Other` text (saving non-empty text picks it). */
	#editRow(question: AskQuestion, state: QuestionState, row: QuestionRow): void {
		if (row.kind === "other") {
			this.#openPrompt({
				title: "Other answer",
				current: state.other,
				apply: text => setOther(question, state, text),
			});
			return;
		}
		const optionIndex = row.optionIndex ?? -1;
		this.#openPrompt({
			title: `Note for ${inlineText(optionText(question, optionIndex))}`,
			current: state.notes.get(optionIndex),
			apply: text => setNote(state, optionIndex, text),
		});
	}

	/** Whether the cursor row was on screen in the last render. Unrendered
	 *  state (a tab switch or cursor move not yet drawn) counts as visible.
	 *  In Tern, the row counts as hidden after PgUp/PgDn until it is revealed. */
	#cursorVisible(index: number): boolean {
		if (this.#nativeMode) return !this.#nativePagedAway;
		const rendered = this.#renderedCursor;
		const state = this.#states[index];
		if (!rendered || !state || rendered.questionIndex !== index || rendered.cursorIndex !== state.cursorIndex) {
			return true;
		}
		return rendered.visible;
	}

	/** Scroll the highlighted row back into view (classic: follow it; Tern: bump its reveal). */
	#revealCursor(state: QuestionState): void {
		state.followCursor = true;
		this.#nativePagedAway = false;
		this.#nativeReveal += 1;
		this.#requestRender();
	}

	#switchTab(direction: 1 | -1): void {
		const tabCount = this.#questions.length + 1;
		this.#activeTab = (this.#activeTab + direction + tabCount) % tabCount;
		this.#submitScroll = 0;
	}

	/** Next question; the last one goes to the Submit tab, or submits when there is none. */
	#advance(): void {
		if (!this.#hasSubmitTab()) {
			this.#submit();
			return;
		}
		const current = this.#questionIndex();
		this.#activeTab = current + 1 < this.#questions.length ? current + 1 : this.#questions.length;
		this.#submitScroll = 0;
		this.#requestRender();
	}

	// ---------------------------------------------------------------------------
	// Note / Other / Submit note editor: Enter saves and stays, Esc discards
	// ---------------------------------------------------------------------------

	#openPrompt(request: PromptRequest): void {
		const close = () => {
			this.#prompt?.dispose();
			this.#prompt = undefined;
			this.#promptImages = [];
			if (!this.#closed) this.#tui.setFocus(this);
			if (this.#timeoutPending) {
				this.#timeoutPending = false;
				this.#handleTimeout();
			}
			this.#requestRender();
		};
		this.#promptImages = [...(request.current?.images ?? [])];
		const prompt = new AnswerEditor(this.#tui, {
			title: request.title,
			prefill: request.current?.text,
			maxHeight: PROMPT_EDITOR_ROWS,
			autocomplete: this.#options.autocomplete(),
			fileCommands: this.#options.fileCommands,
			hints: [
				{ keys: ["enter", "ctrl+q"], label: "save" },
				{ keys: ["escape"], label: "discard" },
				{ keys: [externalEditorKey()], label: "external editor" },
			],
			onSubmit: value => {
				if (!this.#closed) {
					// Deleting an image chip (or its `[Image #N]` text) drops that image.
					const images = this.#promptImages.filter(image => value.includes(image.label));
					request.apply(value.trim() === "" ? undefined : { text: value, images });
				}
				close();
			},
			onCancel: close,
			onAttachImage: image => this.#retainImage({ image }),
			onPasteImage: async editor => this.#insertPaste(editor, await readClipboardPaste(this.#options.cwd)),
			onPasteImagePath: async (editor, path) => {
				const outcome = await loadImagePaths([path], this.#options.cwd);
				// Like the main prompt: an unreadable path stays as text.
				if (!(await this.#insertPaste(editor, outcome))) editor.pasteText(path);
			},
			editExternally: text => this.#editExternally(text),
			onInput: () => this.#countdown?.reset(),
		});
		// omp opens the external editor on the hidden main prompt unless a
		// HookEditorComponent holds TUI focus, so the answer editor takes focus.
		this.#prompt = prompt;
		this.#tui.setFocus(prompt);
		this.#requestRender();
	}

	async #editExternally(text: string): Promise<string | null> {
		const command = getEditorCommand();
		if (!command) {
			this.#options.notify("No editor configured. Set $VISUAL or $EDITOR environment variable.");
			return null;
		}
		try {
			return await openInEditor(command, text);
		} catch (error) {
			this.#options.notify(`Failed to open external editor: ${error instanceof Error ? error.message : String(error)}`);
			return null;
		}
	}

	#retainImage(image: PastedImage): number {
		this.#imageCount += 1;
		this.#promptImages.push({ ...image, label: `[Image #${this.#imageCount}]` });
		return this.#imageCount;
	}

	/** Insert pasted images as main-prompt image chips expanding to `[Image #N]`. */
	async #insertPaste(editor: CustomEditor, outcome: PasteOutcome): Promise<boolean> {
		if (this.#prompt?.editor !== editor) return false;
		if ("error" in outcome) {
			this.#options.notify(outcome.error);
			return false;
		}
		if ("text" in outcome) {
			editor.pasteText(outcome.text);
		} else {
			for (const image of outcome.images) {
				const number = this.#retainImage(image);
				editor.insertAtom(`${theme.symbol("chip.image")} #${number}`, `[Image #${number}]`);
			}
		}
		this.#requestRender();
		return true;
	}

	/**
	 * Above the editor, trimmed to fit: the question's Markdown and, for a
	 * note or `Other` text, its title above and the row being edited below
	 * (without its saved text, which the editor holds).
	 */
	#renderPrompt(width: number, innerWidth: number, termRows: number): string[] {
		const prompt = this.#prompt;
		if (!prompt) return [];
		const editorLines = withoutSideBorders(prompt.render(width + 2), width);
		const budget = Math.max(3, Math.floor(termRows * DIALOG_HEIGHT_RATIO) - editorLines.length - 1);
		const index = this.#questionIndex();
		const question = this.#questions[index];
		const state = this.#isSubmitTab() ? undefined : this.#states[index];
		const head: string[] = [];
		const tail: string[] = [];
		if (question && state) {
			const title = question.title.trim();
			if (title) head.push(...wrapTextWithAnsi(theme.bold(theme.fg("muted", displayText(title))), innerWidth), "");
			const row = questionRows(question)[state.cursorIndex];
			if (row) tail.push("", ...this.#renderRow(question, state, row, true, innerWidth, false));
		}
		const text = question ? displayText(contextMarkdown(question)) : "";
		const markdown = text ? this.#markdown(text, "text").render(innerWidth) : [];
		// The row keeps at least two lines' room for the question; the question takes what is left.
		const rowShown = fitLines(tail, Math.max(1, budget - head.length - 2));
		const shown = [...head, ...fitLines(markdown, Math.max(1, budget - head.length - rowShown.length)), ...rowShown];
		return [...shown.map(line => ` ${line}`), ...editorLines];
	}

	// ---------------------------------------------------------------------------
	// Completion
	// ---------------------------------------------------------------------------

	/** The deadline submits the answers as they stand, unvalidated and marked automatic, as native does. */
	#handleTimeout(): void {
		if (this.#closed) return;
		if (this.#prompt) {
			this.#timeoutPending = true;
			return;
		}
		this.#options.onTimeout?.();
		this.#finish({ kind: "submit", answer: this.#answer(true) });
	}

	/** A manual Submit: refused with native's reason, on the first question that fails, until every answer is valid. */
	#submit(): void {
		const invalid = firstInvalid(this.#form, this.#states);
		if (invalid) {
			const question = this.#questions[invalid.index];
			this.#activeTab = invalid.index;
			if (question) this.#notice = { text: `${tabLabel(question, invalid.index)}: ${invalid.error}`, tone: "warning" };
			this.#requestRender();
			return;
		}
		this.#finish({ kind: "submit", answer: this.#answer(false) });
	}

	/** The answer as it stands; also the Picker btw's draft. */
	#answer(timedOut: boolean): AskFormAnswer {
		return formAnswer(this.#form, this.#states, this.#submitNote, timedOut);
	}

	#finish(result: PickerSubmit | undefined): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#countdown?.dispose();
		this.#stopRingTick();
		if (result) this.#callbacks.onSubmit(result);
		else this.#callbacks.onCancel(this.#pickerDraft());
	}

	#pickerDraft(): PickerDraft {
		return {
			states: this.#states,
			activeTab: this.#activeTab,
			submitNote: this.#submitNote,
			imageCount: this.#imageCount,
			btwTurns: this.#btwTurns,
		};
	}
}

/**
 * Show the Picker in place of the prompt editor. Resolves `kind: "cancel"`
 * on Esc; rejects with an `AbortError` when `signal` aborts.
 */
export function showPicker(
	ui: Pick<ExtensionUIContext, "custom">,
	form: AskForm,
	options: DialogOptions & { signal?: AbortSignal },
): Promise<PickerSubmit | PickerCancel> {
	// The host's custom-UI options do not declare `timeout`, but the host reads
	// it: a dialog with a deadline settles by itself, so its time stays the
	// agent's and the display stays awake, as with native timed ask.
	const customOptions = { signal: options.signal, timeout: options.timeout };
	return ui.custom<PickerSubmit | PickerCancel>(
		(tui, _theme, _keybindings, done) =>
			new Picker(
				form,
				tui,
				{ onSubmit: result => done(result), onCancel: draft => done({ kind: "cancel", draft }) },
				options,
			),
		customOptions,
	);
}
