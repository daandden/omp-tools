// Interactive ask dialog with full-Markdown questions, option descriptions,
// and previews. Mirrors the native pi-tui AskDialogComponent (tabs, Submit
// review tab, multi-select, "Other" custom input, notes, timeout countdown),
// but renders the question as block Markdown inside the scrollable body
// instead of a condensed inline header.
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
	decodePrintableKey,
	Ellipsis,
	type Focusable,
	getKeybindings,
	Markdown,
	matchesKey,
	padding,
	renderInlineMarkdown,
	replaceTabs,
	ScrollView,
	type Tab,
	TabBar,
	Text,
	type TUI,
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
import { AnswerEditor, withoutSideBorders } from "./ask-editor";
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

/** Submit-tab summary: picked options, then the picked `Other` text, for both single and multi questions. */
function answerSummary(question: ExtensionAskDialogQuestion, state: QuestionState): string {
	const display = displayOptionLabels(question);
	const parts = question.options.flatMap((option, index) =>
		state.selectedOptions.has(option.label) ? [display[index] ?? sanitizeCarriageReturns(option.label)] : [],
	);
	if (state.otherPicked && state.other) parts.push(`Other: “${inlineText(state.other.text)}”`);
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
	/** Latest layout per `question:width`; rebuilt when answer/cursor state changes. */
	#layoutCache = new Map<string, { stateKey: string; layout: QuestionLayout }>();
	/** Markdown blocks keyed by color and source; reused across cursor moves. */
	#markdownCache = new Map<string, Markdown>();
	#previewCache = new Map<string, string[]>();
	/** Cursor visibility from the last rendered question body. */
	#renderedCursor: { questionIndex: number; cursorIndex: number; visible: boolean } | undefined;
	/** Written on the Submit tab; sent once for the whole ask. */
	#submitNote: Draft | undefined;

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
		if (isUpKey(data)) this.#submitScroll = Math.max(0, this.#submitScroll - 1);
		else if (isDownKey(data)) this.#submitScroll += 1;
		else if (isClearKey(data)) this.#submitNote = undefined;
		else if (isEnter(data)) {
			this.#submit();
			return;
		} else if (isEditKey(data)) {
			this.#openPrompt({
				title: "Submit note",
				current: this.#submitNote,
				apply: draft => {
					this.#submitNote = draft;
				},
			});
			return;
		}
		this.#requestRender();
	}

	/**
	 * One meaning per key: Space toggles the row, Enter finishes the question
	 * (single-select picks the row first), `n` edits the row's text, `x` clears
	 * it. An `Other` without text opens its editor on Space or Enter.
	 */
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
			this.#requestRender();
			return;
		}
		if (keybindings.matches(data, "tui.select.pageDown")) {
			state.scrollOffset += page;
			state.followCursor = false;
			this.#requestRender();
			return;
		}
		if (isUpKey(data) || isDownKey(data)) {
			// The first move after reading reveals the cursor instead of skipping past it.
			if (state.followCursor || this.#cursorVisible(index)) {
				const delta = isUpKey(data) ? -1 : 1;
				state.cursorIndex = clamp(state.cursorIndex + delta, 0, Math.max(0, rows.length - 1));
			}
			state.followCursor = true;
			this.#requestRender();
			return;
		}
		const row = rows[state.cursorIndex];
		if (!row) return;
		const enter = isEnter(data);
		const space = isSpace(data);
		const edit = isEditKey(data);
		const clear = isClearKey(data);
		if (!enter && !space && !edit && !clear) return;
		// Never act on a row the user cannot see; reveal it first.
		if (!this.#cursorVisible(index)) {
			state.followCursor = true;
			this.#requestRender();
			return;
		}
		if (edit || (row.kind === "other" && !state.other && !clear)) {
			this.#editRow(question, state, row);
			return;
		}
		if (clear) {
			if (row.kind === "other") {
				state.other = undefined;
				state.otherPicked = false;
			} else {
				state.notes.delete(row.optionIndex ?? -1);
			}
			this.#requestRender();
			return;
		}
		if (space) {
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
	 *  state (a tab switch or cursor move not yet drawn) counts as visible. */
	#cursorVisible(index: number): boolean {
		const rendered = this.#renderedCursor;
		const state = this.#states[index];
		if (!rendered || !state || rendered.questionIndex !== index || rendered.cursorIndex !== state.cursorIndex) {
			return true;
		}
		return rendered.visible;
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
		const external = editorKey("app.editor.external") || "ctrl+g";
		const prompt = new AnswerEditor(this.#tui, {
			title: request.title,
			prefill: request.current?.text,
			maxHeight: PROMPT_EDITOR_ROWS,
			autocomplete: this.#options.autocomplete(),
			fileCommands: this.#options.fileCommands,
			hint: `enter or ctrl+q save  esc discard  ${external} external editor`,
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
