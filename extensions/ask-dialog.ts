// Interactive ask dialog with full-Markdown questions, option descriptions,
// and previews. Mirrors the native pi-tui AskDialogComponent (tabs, Submit
// review tab, multi-select, "Other" custom input, notes, timeout countdown),
// but renders the question as block Markdown inside the scrollable body
// instead of a condensed inline header. In Tern (Surface Protocol terminals)
// it describes the same state as native nodes instead (`describe`): each
// option is a card with its Markdown, and pointer actions run the key paths.
//
// Runtime imports resolve to the host's in-process pi-tui/coding-agent
// modules through OMP's extension specifier shim; they must stay on exported
// package subpaths (`@oh-my-pi/pi-tui`, `/chrome`, `/render`, `/theme`).
import type {
	CustomEditor,
	ExtensionAskDialogQuestion,
	ExtensionAskDialogResultItem,
	ExtensionUIContext,
} from "@oh-my-pi/pi-coding-agent";
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
	md,
	type NativeChild,
	type NativeNode,
	type NativeScroll,
	type NativeUiEvent,
	node,
	padding,
	renderInlineMarkdown,
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
import { disambiguateDisplayLabels, sanitizeCarriageReturns } from "@oh-my-pi/pi-tui/render";
import { getMarkdownTheme, highlightCode, theme } from "@oh-my-pi/pi-tui/theme";
import { AnswerEditor, externalEditorKey, scrollBox, withoutSideBorders } from "./ask-editor";
import { loadImagePaths, type PasteOutcome, type PastedImage, readClipboardPaste } from "./ask-images";
import { formatAskAnswers } from "./ask-result";
import type { AskPickerBtw } from "./picker-btw";
import { PickerBtwView } from "./picker-btw-view";

const OTHER_OPTION = "Other (type your own)";
const SUBMIT_OPTION = "Submit";
const RECOMMENDED_SUFFIX = " (Recommended)";
/** Native reserved action rows; option labels must disambiguate against them. */
const RESERVED_LABELS = [OTHER_OPTION, "Chat about this", "Next →"];
/** Fraction of the terminal the dialog may occupy (matches native). */
const DIALOG_HEIGHT_RATIO = 0.7;
const MIN_DIALOG_ROWS = 12;
const MIN_BODY_ROWS = 5;
const MAX_TAB_LABEL_WIDTH = 16;
/** Rows reserved for the custom-answer/note editor while it is open. */
const PROMPT_EDITOR_ROWS = 6;
/** Lines Tern spends outside the scroller: the tab row, the button row, gaps, and insets. */
const NATIVE_CHROME_LINES = 4;
/** Share of the pane's rows the scroller may take. Tern's text line is taller than a terminal row, so this is under the classic ratio. */
const NATIVE_HEIGHT_RATIO = 0.5;
/** Columns the picker's insets take from the pane's width. */
const NATIVE_INSET_COLS = 6;
/** Lines of a Tern editor card (title, one text line, key hints, insets), less the gap it shares. */
const NATIVE_EDITOR_LINES = 5;
/** Lines of the Tern button row, which an open editor replaces. */
const NATIVE_ACTION_LINES = 2;
/** Text lines one Tern option row adds beyond its text: the gap between rows. */
const NATIVE_ROW_GAP_LINES = 0.5;
/** The same with the picker's sheet, whose rows also have 7px padding above and below. */
const NATIVE_STYLED_ROW_LINES = 1.25;

/** An image attached to a custom answer or note, referenced by `label` in its text. */
export interface AskImage extends PastedImage {
	label: string;
}

/** A note on one option; every note is sent, `picked` tells whether its option is picked. */
export interface OptionNote {
	option: string;
	note: string;
	picked: boolean;
}

export interface MarkdownAskResultItem
	extends Omit<ExtensionAskDialogResultItem, "note" | "noteImages" | "customInputImages"> {
	/** Notes in option order, picked or not. */
	notes: OptionNote[];
	images: AskImage[];
}

/** Free text written on the Submit tab for the whole ask. */
export interface SubmitNote {
	text: string;
	images: AskImage[];
}

export interface MarkdownAskResult {
	kind: "submit";
	results: MarkdownAskResultItem[];
	submitNote: SubmitNote | undefined;
}

interface DialogOptions {
	timeout?: number;
	/** Resolves relative pasted image paths. */
	cwd: string;
	/** Surfaces paste failures (unsupported format, missing file, empty clipboard). */
	notify(message: string): void;
	/** Main prompt suggestion provider, borrowed from the host. */
	autocomplete(): AutocompleteProvider | undefined;
	/** File command names offered under `/` in the answer box. */
	fileCommands: ReadonlySet<string>;
	/** Picker btw side questions; `undefined` when the host has no side turns (`?` is then off). */
	askBtw: AskPickerBtw | undefined;
}

/** Text written in the picker editor, with the images its labels refer to. */
interface Draft {
	text: string;
	images: AskImage[];
}

interface QuestionState {
	selectedOptions: Set<string>;
	/** The `Other` text; kept when `Other` is un-picked. */
	other: Draft | undefined;
	otherPicked: boolean;
	/** Notes by option index; kept through select and deselect. */
	notes: Map<number, Draft>;
	cursorIndex: number;
	scrollOffset: number;
	/** True after a cursor move: keep the cursor row in view. False after
	 *  manual paging, so a long question can be read without snapping back. */
	followCursor: boolean;
	timedOut: boolean;
}

interface QuestionRow {
	kind: "option" | "other";
	key: string;
	label: string;
	optionIndex: number | undefined;
}

interface QuestionLayout {
	lines: string[];
	rowStarts: number[];
}

interface DialogCallbacks {
	onSubmit(result: MarkdownAskResult): void;
	onCancel(): void;
}

interface PromptRequest {
	title: string;
	/** Text and images already in this field; images stay while their label stays in the text. */
	current: Draft | undefined;
	/** Receives the saved text; empty text clears the field. */
	apply(draft: Draft | undefined): void;
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

function optionMarker(multi: boolean | undefined, checked: boolean): string {
	if (multi) return checked ? theme.checkbox.checked : theme.checkbox.unchecked;
	return checked ? theme.radio.selected : theme.radio.unselected;
}

function tabLabel(question: ExtensionAskDialogQuestion, index: number): string {
	const base = question.header?.trim() || sanitizeCarriageReturns(question.id) || `Q${index + 1}`;
	return truncateToWidth(replaceTabs(base), MAX_TAB_LABEL_WIDTH, Ellipsis.Unicode);
}

/** Sanitized, recommendation-badged, collision-free option labels (native parity). */
function displayOptionLabels(question: ExtensionAskDialogQuestion): string[] {
	const badged = question.options.map((option, index) => {
		const base = sanitizeCarriageReturns(option.label);
		return question.recommended === index && !base.endsWith(RECOMMENDED_SUFFIX) ? `${base}${RECOMMENDED_SUFFIX}` : base;
	});
	return disambiguateDisplayLabels(badged, RESERVED_LABELS);
}

function questionRows(question: ExtensionAskDialogQuestion): QuestionRow[] {
	const display = displayOptionLabels(question);
	const rows: QuestionRow[] = question.options.map((option, index) => ({
		kind: "option",
		key: `option:${index}`,
		label: display[index] ?? sanitizeCarriageReturns(option.label),
		optionIndex: index,
	}));
	rows.push({ kind: "other", key: "other", label: OTHER_OPTION, optionIndex: undefined });
	return rows;
}

function isAnswered(state: QuestionState): boolean {
	return state.selectedOptions.size > 0 || state.otherPicked;
}

/** Every option note, in option order. */
function optionNotes(question: ExtensionAskDialogQuestion, state: QuestionState): OptionNote[] {
	return question.options.flatMap((option, index) => {
		const note = state.notes.get(index);
		return note ? [{ option: option.label, note: note.text, picked: state.selectedOptions.has(option.label) }] : [];
	});
}

/** Picked options, then the picked `Other` text, for both single and multi questions. */
function answerParts(question: ExtensionAskDialogQuestion, state: QuestionState): string[] {
	const display = displayOptionLabels(question);
	const parts = question.options.flatMap((option, index) =>
		state.selectedOptions.has(option.label) ? [display[index] ?? sanitizeCarriageReturns(option.label)] : [],
	);
	if (state.otherPicked && state.other) parts.push(`Other: “${inlineText(state.other.text)}”`);
	return parts;
}

/** Submit-tab summary line. */
function answerSummary(question: ExtensionAskDialogQuestion, state: QuestionState): string {
	const parts = answerParts(question, state);
	return parts.length > 0 ? parts.join(", ") : theme.fg("warning", "unanswered");
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

/** A label with inline code as mono spans, as the classic row renders inline Markdown. */
function labelSpans(label: string, style: string | undefined): Span[] {
	return label.split(/(`[^`]+`)/).flatMap(piece => {
		if (piece === "") return [];
		if (piece.length > 2 && piece.startsWith("`") && piece.endsWith("`")) {
			return [span(piece.slice(1, -1), style ? `code ${style}` : "code")];
		}
		return [span(piece, style)];
	});
}

/** Name of the picker's Tern stylesheet (`s` verb, one per surface; resending replaces it in place). */
const NATIVE_SHEET_NAME = "omp-tools-ask";
/**
 * The option rows in Tern's own look, as Tern draws native ask's items: the UI
 * font, primary label and muted description, a neutral fill on the
 * highlighted row and a hover fill. Colors are Tern's theme variables, so the
 * rows follow its theme (and the program palette where Tern applies it).
 *
 * Tern's Markdown gives a list 2 cells of indent and hangs its markers left of
 * that (`1. ` in the terminal font is wider), into the page margin in the
 * transcript. A scroll box clips at its edge, so it takes that room inside:
 * padding on the scroller, cancelled by a negative margin so nothing moves.
 */
const NATIVE_SHEET = `
.sf-list[data-role='omp-tools.ask-body'] > .sf-list-scroll {
	margin-left: calc(-2 * var(--sf-cw));
	padding-left: calc(2 * var(--sf-cw));
}
[data-role^='omp-tools.ask-row'] {
	padding: 7px 10px;
	border-radius: 10px;
	font-family: var(--sans);
	transition: background-color 120ms ease;
}
[data-role^='omp-tools.ask-row']:hover { background: var(--l1); }
[data-role='omp-tools.ask-row.on'], [data-role='omp-tools.ask-row.on']:hover { background: var(--l2); }
[data-role='omp-tools.ask-label'] { font: 500 14px/1.4 var(--sans); color: var(--t1); }
[data-role='omp-tools.ask-label'] .sf-t-code { font-family: var(--tv-font, var(--mono)); font-size: 13px; }
[data-role^='omp-tools.ask-row'] .sf-md, [data-role^='omp-tools.ask-row'] .sf-md .md { font-family: var(--sans); font-size: 13px; color: var(--t3); }
[data-role^='omp-tools.ask-row'] .sf-md code { font-family: var(--tv-font, var(--mono)); }
[data-role='omp-tools.ask-typed'] { font: 13px/1.4 var(--sans); }
[data-role='omp-tools.ask-marker'] { line-height: calc(14px * 1.4); }
[data-role='omp-tools.ask-answers'] { font-family: var(--sans); font-size: 13px; }
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

class MarkdownAskDialog implements Component, Focusable {
	focused = false;
	readonly #questions: ExtensionAskDialogQuestion[];
	readonly #states: QuestionState[];
	readonly #tui: TUI;
	readonly #callbacks: DialogCallbacks;
	readonly #options: DialogOptions;
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
	#prompt: AnswerEditor | undefined;
	/** The Picker btw thread; kept for this ask once `?` opens it. */
	#btw: PickerBtwView | undefined;
	#btwOpen = false;
	/** Rows of the last options render; the Picker btw view is at least this tall. */
	#optionsHeight = 0;
	/** Images pasted into the open prompt; filtered by label on submit. */
	#promptImages: AskImage[] = [];
	/** Dialog-wide counter so `[Image #N]` labels stay unique across fields. */
	#imageCount = 0;
	#stableHeight: { key: string; total: number } | undefined;
	/** Heights of the Tern scrollers, fixed per pane size. */
	#nativeHeight: { key: string; lines: number; width: number } | undefined;
	/** Latest layout per `question:width`; rebuilt when answer/cursor state changes. */
	#layoutCache = new Map<string, { stateKey: string; layout: QuestionLayout }>();
	/** Markdown blocks keyed by color and source; reused across cursor moves. */
	#markdownCache = new Map<string, Markdown>();
	#previewCache = new Map<string, string[]>();
	/** Cursor visibility from the last rendered question body. */
	#renderedCursor: { questionIndex: number; cursorIndex: number; visible: boolean } | undefined;
	/** Written on the Submit tab; sent once for the whole ask. */
	#submitNote: Draft | undefined;
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

	constructor(questions: ExtensionAskDialogQuestion[], tui: TUI, callbacks: DialogCallbacks, options: DialogOptions) {
		this.#questions = questions;
		this.#tui = tui;
		this.#callbacks = callbacks;
		this.#options = options;
		const timeoutMs = options.timeout;
		this.#states = questions.map(question => ({
			selectedOptions: new Set<string>(),
			other: undefined,
			otherPicked: false,
			notes: new Map<number, Draft>(),
			cursorIndex: clamp(question.recommended ?? 0, 0, Math.max(0, question.options.length - 1)),
			scrollOffset: 0,
			followCursor: false,
			timedOut: false,
		}));
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

	setUseTerminalCursor(useTerminalCursor: boolean): void {
		this.#prompt?.setUseTerminalCursor(useTerminalCursor);
		this.#btw?.setUseTerminalCursor(useTerminalCursor);
	}

	invalidate(): void {
		this.#stableHeight = undefined;
		this.#nativeHeight = undefined;
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
		this.#panel.dispose();
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
			ask,
			draftAnswers: () => formatAskAnswers(this.#questions, this.#results(), this.#submitNote?.text),
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
	 * then buttons for the keys. The middle part has one fixed height for the
	 * whole ask and scrolls inside it, so the picker never jumps between tabs.
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
			// Above the editor: what it annotates (the question, or every answer for the Submit note), in a fixed box.
			const question = this.#isSubmitTab() ? undefined : this.#questions[this.#questionIndex()];
			const content = question
				? node("md", { text: displayText(question.question).trim(), role: "omp.ask.question" })
				: node("col", { gap: "sm" }, this.#describeAnswers());
			const room = Math.max(3, lines - NATIVE_EDITOR_LINES + NATIVE_ACTION_LINES);
			children.push(scrollBox(content, { lines: room, fixed: true, key: "context", scroll: undefined }));
			children.push(this.#prompt);
		} else if (this.#isSubmitTab()) {
			this.#describeSubmitBody(children, lines);
		} else {
			this.#describeQuestionBody(children, { lines, width }, shownBody);
		}
		// Inline `min`/`max` widths beat the composer's measure: the picker spans the pane.
		return col(children, { role: "omp.editor", gap: "sm", min: { w: 1 }, max: { w: 1 } });
	}

	/**
	 * Height of the one scrolling box (the question and its options, the
	 * Submit tab, an editor's context, or the Picker btw thread), in text
	 * lines, fixed per pane size so switching tabs or answering never resizes
	 * the picker. It is the tallest question as the classic layout measures
	 * it at the pane's width, capped like the classic panel; anything taller
	 * scrolls.
	 */
	#nativeHeights(cx: DescribeContext): { lines: number; width: number } {
		const termRows = this.#tui.terminal?.rows ?? process.stdout.rows ?? 40;
		const width = Math.max(1, cx.cols - NATIVE_INSET_COLS);
		const key = `${width}:${termRows}`;
		if (this.#nativeHeight?.key === key) return this.#nativeHeight;
		let tallest = 0;
		for (let index = 0; index < this.#questions.length; index++) {
			const question = this.#questions[index];
			if (!question) continue;
			// Tern sets a heading in a larger face than a text line, and puts a gap between rows.
			const headings = displayText(question.question)
				.split("\n")
				.filter(line => /^\s*#{1,6}\s/.test(line)).length;
			const gaps = this.#nativeRowExtra(questionRows(question).length);
			tallest = Math.max(tallest, this.#questionLayout(index, width).lines.length + headings + gaps);
		}
		const submitLines = this.#hasSubmitTab() ? this.#questions.length * 2 + 3 : 0;
		const cap = Math.max(MIN_BODY_ROWS, Math.floor(termRows * NATIVE_HEIGHT_RATIO) - NATIVE_CHROME_LINES);
		this.#nativeHeight = { key, lines: clamp(Math.max(submitLines, tallest), MIN_BODY_ROWS, cap), width };
		return this.#nativeHeight;
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
		const title = "Picks the recommended option when the time runs out";
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
	 * The question as Markdown over its options, in one fixed-height box
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
		const questionText = displayText(question.question).trim();
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
		const body: NativeChild[] = questionText ? [node("md", { text: questionText, role: "omp.ask.question" })] : [];
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
		const headings = displayText(question.question)
			.split("\n")
			.filter(line => /^\s*#{1,6}\s/.test(line)).length;
		const end = (layout.rowStarts[cursor + 1] ?? layout.lines.length) + headings + this.#nativeRowExtra(cursor + 1);
		return end <= size.lines;
	}

	/** Text lines that `count` Tern rows add beyond their text: the gap between rows, plus the sheet's padding. */
	#nativeRowExtra(count: number): number {
		return Math.ceil(count * (this.#nativeSheet ? NATIVE_STYLED_ROW_LINES : NATIVE_ROW_GAP_LINES));
	}

	/** A fixed-height scroller; PgUp/PgDn and Submit-tab j/k move it. */
	#scroller(children: readonly NativeChild[], lines: number, key: string): NativeNode {
		return scrollBox(node("col", { gap: "sm" }, children), { lines, fixed: true, key, scroll: this.#nativeScroll });
	}

	/**
	 * One option as a compact row: the marker, then the label over its
	 * Markdown description, preview, and note or `Other` text, all hanging
	 * from the label. The highlighted row's marker and label are accent (as in
	 * the classic picker), and it is kept in view. A click is Space on it, a
	 * double-click Enter.
	 */
	#describeRow(
		question: ExtensionAskDialogQuestion,
		state: QuestionState,
		row: QuestionRow,
		rowIndex: number,
		reveal: "none" | "mount" | "token",
	): NativeNode {
		const option = row.kind === "option" ? question.options[row.optionIndex ?? -1] : undefined;
		const checked = this.#isPickedRow(question, state, row);
		const cursor = rowIndex === state.cursorIndex;
		const recommended = row.kind === "option" && question.recommended === row.optionIndex;
		const label =
			recommended && row.label.endsWith(RECOMMENDED_SUFFIX) ? row.label.slice(0, -RECOMMENDED_SUFFIX.length) : row.label;
		// With the sheet, the highlighted row is a neutral fill and the label stays primary text, as native ask's items.
		const styled = this.#nativeSheet;
		const labelStyle = !styled && cursor ? "accent strong" : undefined;
		const labelText = node(
			"text",
			{ spans: labelSpans(label, labelStyle), wrap: "word", role: "omp-tools.ask-label" },
			undefined,
			"label",
		);
		const labelLine = recommended
			? node(
					"row",
					{ gap: "sm", align: "center", wrap: true },
					[labelText, node("badge", { text: "Recommended", tone: "success" })],
					"label-line",
				)
			: labelText;

		const lines: NativeChild[] = [labelLine];
		const description = option?.description ? displayText(option.description).trim() : "";
		if (description) lines.push(node("md", { text: description, role: "omp.ask.description" }, undefined, "description"));
		const preview = option?.preview ? displayText(option.preview) : "";
		if (preview.trim()) lines.push(node("md", { text: preview, role: "omp.ask.preview" }, undefined, "preview"));
		const typed = row.kind === "other" ? state.other?.text : state.notes.get(row.optionIndex ?? -1)?.text;
		if (typed !== undefined) {
			const spans =
				row.kind === "other"
					? [span(inlineText(typed), checked ? "muted" : "dim")]
					: [span("✎ ", "success"), span(inlineText(typed), "success")];
			lines.push(node("text", { spans, wrap: "word", role: "omp-tools.ask-typed" }, undefined, "text"));
		}
		const markerStyle = checked ? (question.multi ? "success" : "strong") : !styled && cursor ? "accent" : "dim";
		const marker = span(optionMarker(question.multi, checked), markerStyle);
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
	#describeQuestionActions(
		question: ExtensionAskDialogQuestion,
		state: QuestionState,
		row: QuestionRow | undefined,
	): NativeNode {
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
		const pick = actionButton(this.#isPickedRow(question, state, row) ? "Unpick" : "Pick", "space", "space");
		const next = this.#hasSubmitTab() ? "next" : "submit";
		const enterLabel = question.multi ? `${next[0]?.toUpperCase()}${next.slice(1)}` : `Pick & ${next}`;
		const moves = this.#hasSubmitTab() ? "j/k move · h/l tabs" : "j/k move";
		const enter = actionButton(enterLabel, "enter", "enter", { accent: true, title: `${enterLabel}  enter · ${moves}` });
		return actionBar(clear ? [btw, null, pick, edit, clear, cancel, enter] : [btw, null, pick, edit, cancel, enter]);
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

	/** The unanswered warning, then every answer and note and the Submit note as key/value rows. */
	#describeAnswers(): NativeNode[] {
		const body: NativeNode[] = [];
		const unanswered = this.#states.filter(state => !isAnswered(state)).length;
		if (unanswered > 0) {
			const noun = `question${unanswered === 1 ? "" : "s"}`;
			body.push(
				node(
					"text",
					{ spans: [span(`${unanswered} unanswered ${noun}; Enter still submits.`, "warning")], role: "omp-tools.ask-answers" },
					undefined,
					"warning",
				),
			);
		}
		const items: { k: Span[]; v: Span[] }[] = [];
		for (let index = 0; index < this.#questions.length; index++) {
			const question = this.#questions[index];
			const state = this.#states[index];
			if (!question || !state) continue;
			const parts = answerParts(question, state);
			items.push({
				k: [span(`${index + 1}. ${tabLabel(question, index)}`, "dim")],
				v: parts.length > 0 ? [span(parts.join(", "))] : [span("unanswered", "warning")],
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
		return this.#questions.length > 1 || this.#questions.some(question => question.multi);
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

	#dialogHeight(width: number, termRows: number): number {
		const key = `${width}:${termRows}`;
		if (this.#stableHeight?.key === key) return this.#stableHeight.total;
		// Sized once per viewport from the tallest tab so switching tabs or
		// answering never resizes the panel; overflow scrolls.
		const maxHeight = Math.max(MIN_DIALOG_ROWS, Math.floor(termRows * DIALOG_HEIGHT_RATIO));
		const chrome = 4 + (this.#hasSubmitTab() ? 2 : 0);
		let tallestBody = this.#hasSubmitTab() ? this.#questions.length * 2 + 4 : 0;
		for (let index = 0; index < this.#questions.length; index++) {
			tallestBody = Math.max(tallestBody, this.#questionLayout(index, width).lines.length);
		}
		const total = clamp(chrome + tallestBody, MIN_DIALOG_ROWS, maxHeight);
		this.#stableHeight = { key, total };
		return total;
	}

	/** Question Markdown, a blank separator, then every option row with its
	 *  Markdown description and preview. `rowStarts` indexes each row's first line. */
	#questionLayout(index: number, width: number): QuestionLayout {
		const question = this.#questions[index];
		const state = this.#states[index];
		if (!question || !state) return { lines: [], rowStarts: [] };
		const key = [
			index,
			width,
			state.cursorIndex,
			[...state.selectedOptions].join("\u0000"),
			state.other?.text ?? "\u0001",
			state.otherPicked,
			[...state.notes].map(([option, note]) => `${option}\u0000${note.text}`).join("\u0000"),
		].join("\u0002");
		const cacheKey = `${index}:${width}`;
		const cached = this.#layoutCache.get(cacheKey);
		if (cached?.stateKey === key) return cached.layout;

		const lines: string[] = [];
		const questionText = displayText(question.question).trim();
		if (questionText) {
			lines.push(...this.#markdown(questionText, "text").render(Math.max(1, width)));
			lines.push("");
		}
		const rowStarts: number[] = [];
		const rows = questionRows(question);
		for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
			const row = rows[rowIndex];
			if (!row) continue;
			rowStarts.push(lines.length);
			lines.push(...this.#renderRow(question, state, row, rowIndex === state.cursorIndex, width));
		}
		const layout = { lines, rowStarts };
		this.#layoutCache.set(cacheKey, { stateKey: key, layout });
		return layout;
	}

	#renderRow(
		question: ExtensionAskDialogQuestion,
		state: QuestionState,
		row: QuestionRow,
		selected: boolean,
		width: number,
	): string[] {
		const option = row.kind === "option" ? question.options[row.optionIndex ?? -1] : undefined;
		const checked = option ? state.selectedOptions.has(option.label) : state.otherPicked;
		// No `❯` cursor column: the focused row shows as an accent, bold label
		// with an accent marker; the marker glyph alone shows the checked state.
		const color = selected ? "accent" : checked ? "toolOutput" : "text";
		const markerColor = checked ? "success" : selected ? "accent" : "dim";
		const marker = `${theme.fg(markerColor, optionMarker(question.multi, checked))} `;
		const style = (t: string) => (selected ? theme.bold(theme.fg(color, t)) : theme.fg(color, t));
		const label = renderInlineMarkdown(row.label, getMarkdownTheme(), style);
		const wrapped = wrapTextWithAnsi(label, Math.max(1, width - visibleWidth(marker)));
		// Label wrap lines, descriptions, previews, notes, and custom answers all
		// start at the label's text column so the option reads as one aligned block.
		const labelColumn = visibleWidth(marker);
		const indent = padding(labelColumn);
		const lines = [`${marker}${wrapped[0] ?? ""}`];
		for (let i = 1; i < wrapped.length; i++) lines.push(`${indent}${wrapped[i] ?? ""}`);

		const detailWidth = Math.max(1, width - labelColumn);
		const detailIndent = indent;
		const description = option?.description ? displayText(option.description).trim() : "";
		if (description) {
			for (const line of this.#markdown(description, "muted").render(detailWidth)) lines.push(`${detailIndent}${line}`);
		}
		const preview = option?.preview ? sanitizeCarriageReturns(option.preview) : "";
		if (preview.trim()) {
			const previewWidth = Math.max(1, detailWidth - 2);
			for (const line of this.#preview(preview, previewWidth)) {
				lines.push(`${detailIndent}${theme.fg("border", "│")} ${line}`);
			}
		}
		// Unpicked text stays visible (dim) so nothing typed looks lost.
		const text = row.kind === "other" ? state.other?.text : state.notes.get(row.optionIndex ?? -1)?.text;
		if (text !== undefined) {
			const prefix = row.kind === "other" ? "" : "✎ ";
			const shown = truncateToWidth(`${prefix}${inlineText(text)}`, detailWidth, Ellipsis.Unicode);
			const textColor = row.kind === "other" ? (checked ? "muted" : "dim") : "success";
			lines.push(theme.fg(textColor, `${detailIndent}${shown}`));
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
			lines: this.#scrollWindow(layout.lines, offset, rows, width),
			indicator: this.#indicator(offset, rows, layout.lines.length),
		};
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
		const unanswered = this.#states.filter(state => !isAnswered(state)).length;
		if (unanswered > 0) {
			lines.push(
				theme.fg("warning", `${unanswered} unanswered question${unanswered === 1 ? "" : "s"}; Enter still submits.`),
			);
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
		const text = row.kind === "other" ? state.other : state.notes.get(row.optionIndex ?? -1);
		const noun = row.kind === "other" ? "answer" : "note";
		let keys: string;
		if (row.kind === "other" && !text) {
			keys = "Space/Enter/n type answer";
		} else {
			const picked = this.#isPickedRow(question, state, row);
			const enter = question.multi ? `Enter ${next}` : `Enter pick & ${next}`;
			const edit = text ? `n edit ${noun} · x clear ${noun}` : `n add ${noun}`;
			keys = `Space ${picked ? "unpick" : "pick"} · ${enter} · ${edit}`;
		}
		return `${keys} · j/k move${tabs}${scroll}${btw} · ${cancel}`;
	}

	/** Whether `row` is picked: a selected option, or a picked `Other`. */
	#isPickedRow(question: ExtensionAskDialogQuestion, state: QuestionState, row: QuestionRow): boolean {
		if (row.kind === "other") return state.otherPicked;
		const option = question.options[row.optionIndex ?? -1];
		return option !== undefined && state.selectedOptions.has(option.label);
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
				apply: draft => {
					this.#submitNote = draft;
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
	 * question (single-select picks the row first), `n` edits the row's text,
	 * `x` clears it. An `Other` without text opens its editor on Space or Enter.
	 */
	#runRowCommand(question: ExtensionAskDialogQuestion, state: QuestionState, command: RowCommand): void {
		const row = questionRows(question)[state.cursorIndex];
		if (!row) return;
		if (command === "edit" || (row.kind === "other" && !state.other && command !== "clear")) {
			this.#editRow(question, state, row);
			return;
		}
		if (command === "clear") {
			if (row.kind === "other") {
				state.other = undefined;
				state.otherPicked = false;
			} else {
				state.notes.delete(row.optionIndex ?? -1);
			}
			this.#requestRender();
			return;
		}
		if (command === "space") {
			if (this.#isPickedRow(question, state, row)) this.#unpickRow(question, state, row);
			else this.#pickRow(question, state, row);
			this.#requestRender();
			return;
		}
		if (!question.multi) this.#pickRow(question, state, row);
		this.#advance();
	}

	/** Pick `row`; single-select un-picks every other row, keeping their text. */
	#pickRow(question: ExtensionAskDialogQuestion, state: QuestionState, row: QuestionRow): void {
		const option = question.options[row.optionIndex ?? -1];
		if (!question.multi) {
			state.selectedOptions.clear();
			state.otherPicked = false;
		}
		if (row.kind === "other") state.otherPicked = true;
		else if (option) state.selectedOptions.add(option.label);
	}

	#unpickRow(question: ExtensionAskDialogQuestion, state: QuestionState, row: QuestionRow): void {
		const option = question.options[row.optionIndex ?? -1];
		if (row.kind === "other") state.otherPicked = false;
		else if (option) state.selectedOptions.delete(option.label);
	}

	/** Open the row's editor: the option's Note, or the `Other` text (saving non-empty text picks it). */
	#editRow(question: ExtensionAskDialogQuestion, state: QuestionState, row: QuestionRow): void {
		if (row.kind === "other") {
			this.#openPrompt({
				title: "Other answer",
				current: state.other,
				apply: draft => {
					state.other = draft;
					if (draft) this.#pickRow(question, state, row);
					else state.otherPicked = false;
				},
			});
			return;
		}
		const optionIndex = row.optionIndex ?? -1;
		this.#openPrompt({
			title: `Note for ${inlineText(row.label)}`,
			current: state.notes.get(optionIndex),
			apply: draft => {
				if (draft) state.notes.set(optionIndex, draft);
				else state.notes.delete(optionIndex);
			},
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
				this.#imageCount += 1;
				const attached: AskImage = { ...image, label: `[Image #${this.#imageCount}]` };
				this.#promptImages.push(attached);
				// Same token as the main prompt's image chip (pi-tui `chipLabel`), so it deletes as a unit.
				editor.insertAtom(`${theme.symbol("chip.image")} #${this.#imageCount}`, attached.label);
			}
		}
		this.#requestRender();
		return true;
	}

	/** Keep the question's Markdown visible above the editor, trimmed to fit. */
	#renderPrompt(width: number, innerWidth: number, termRows: number): string[] {
		const prompt = this.#prompt;
		if (!prompt) return [];
		const editorLines = withoutSideBorders(prompt.render(width + 2), width);
		const question = this.#questions[this.#questionIndex()];
		const text = question ? displayText(question.question).trim() : "";
		let shown: string[] = [];
		if (text) {
			const budget = Math.max(3, Math.floor(termRows * DIALOG_HEIGHT_RATIO) - editorLines.length - 1);
			const markdown = this.#markdown(text, "text").render(innerWidth);
			shown =
				markdown.length <= budget
					? [...markdown]
					: [...markdown.slice(0, budget - 1), theme.fg("dim", `… ${markdown.length - budget + 1} more lines`)];
		}
		return [...shown.map(line => ` ${line}`), ...editorLines];
	}

	// ---------------------------------------------------------------------------
	// Completion
	// ---------------------------------------------------------------------------

	#handleTimeout(): void {
		if (this.#closed) return;
		if (this.#prompt) {
			this.#timeoutPending = true;
			return;
		}
		for (let index = 0; index < this.#questions.length; index++) {
			const question = this.#questions[index];
			const state = this.#states[index];
			if (!question || !state) continue;
			if (isAnswered(state)) continue;
			const fallback = question.options[clamp(question.recommended ?? 0, 0, Math.max(0, question.options.length - 1))];
			if (fallback) state.selectedOptions.add(fallback.label);
			state.timedOut = true;
		}
		this.#submit();
	}

	#submit(): void {
		this.#finish({ kind: "submit", results: this.#results(), submitNote: this.#submitNote });
	}

	/** Every question's answer as it stands; also the Picker btw's draft. */
	#results(): MarkdownAskResultItem[] {
		return this.#questions.flatMap((question, index) => {
			const state = this.#states[index];
			if (!state) return [];
			const other = state.otherPicked ? state.other : undefined;
			return [
				{
					id: question.id,
					question: question.question,
					options: question.options.map(option => option.label),
					multi: question.multi ?? false,
					selectedOptions: question.options
						.map(option => option.label)
						.filter(label => state.selectedOptions.has(label)),
					customInput: other?.text,
					notes: optionNotes(question, state),
					timedOut: state.timedOut || undefined,
					images: [...(other?.images ?? []), ...[...state.notes.values()].flatMap(note => note.images)],
				},
			];
		});
	}

	#finish(result: MarkdownAskResult | undefined): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#countdown?.dispose();
		this.#stopRingTick();
		if (result) this.#callbacks.onSubmit(result);
		else this.#callbacks.onCancel();
	}
}

/**
 * Show the Markdown ask dialog in place of the prompt editor. Resolves
 * `undefined` on cancel; rejects with an `AbortError` when `signal` aborts.
 */
export function showMarkdownAskDialog(
	ui: ExtensionUIContext,
	questions: ExtensionAskDialogQuestion[],
	options: DialogOptions & { signal?: AbortSignal },
): Promise<MarkdownAskResult | undefined> {
	return ui.custom<MarkdownAskResult | undefined>(
		(tui, _theme, _keybindings, done) =>
			new MarkdownAskDialog(
				questions,
				tui,
				{ onSubmit: result => done(result), onCancel: () => done(undefined) },
				options,
			),
		options.signal ? { signal: options.signal } : undefined,
	);
}
