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
	ExtensionAskDialogQuestion,
	ExtensionAskDialogResultItem,
	ExtensionUIContext,
} from "@oh-my-pi/pi-coding-agent";
import { HookEditorComponent } from "@oh-my-pi/pi-coding-agent";
import {
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
	sliceByColumn,
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
import { type PasteOutcome, type PastedImage, readClipboardPaste } from "./ask-images";

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
/** Host keybinding for the main prompt's clipboard image paste (Ctrl+V by default). */
const PASTE_IMAGE_KEY = "app.clipboard.pasteImage";

/** An image attached to a custom answer or note, referenced by `label` in its text. */
export interface AskImage extends PastedImage {
	label: string;
}

export interface MarkdownAskResultItem extends ExtensionAskDialogResultItem {
	images: AskImage[];
}

export interface MarkdownAskResult {
	kind: "submit";
	results: MarkdownAskResultItem[];
}

interface DialogOptions {
	timeout?: number;
	/** Resolves relative pasted image paths. */
	cwd: string;
	/** Surfaces paste failures (unsupported format, missing file, empty clipboard). */
	notify(message: string): void;
}

interface QuestionState {
	selectedOptions: Set<string>;
	customInput: string | undefined;
	note: string | undefined;
	noteRowKey: string | undefined;
	cursorIndex: number;
	scrollOffset: number;
	/** True after a cursor move: keep the cursor row in view. False after
	 *  manual paging, so a long question can be read without snapping back. */
	followCursor: boolean;
	timedOut: boolean;
	customImages: AskImage[];
	noteImages: AskImage[];
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
	prefill: string | undefined;
	/** Images already attached to this field, kept while their label stays in the text. */
	images: AskImage[];
	apply(value: string, images: AskImage[]): void;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(value, max));
}

/** Drop the first and last column of a boxed panel rendered at `width + 2`,
 *  leaving horizontal rules and one-space content insets. */
function withoutSideBorders(lines: readonly string[], width: number): string[] {
	return lines.map(line => sliceByColumn(line, 1, width));
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

function noteForSubmittedAnswer(question: ExtensionAskDialogQuestion, state: QuestionState): string | undefined {
	if (state.note === undefined || state.noteRowKey === undefined) return undefined;
	if (state.noteRowKey === "other") return state.customInput !== undefined ? state.note : undefined;
	const match = /^option:(\d+)$/.exec(state.noteRowKey);
	const option = match?.[1] === undefined ? undefined : question.options[Number.parseInt(match[1], 10)];
	return option && state.selectedOptions.has(option.label) ? state.note : undefined;
}

function answerSummary(question: ExtensionAskDialogQuestion, state: QuestionState): string {
	const display = displayOptionLabels(question);
	const selected = question.options.flatMap((option, index) =>
		state.selectedOptions.has(option.label) ? [display[index] ?? sanitizeCarriageReturns(option.label)] : [],
	);
	if (question.multi) {
		if (state.customInput !== undefined) selected.push(`Other: “${inlineText(state.customInput)}”`);
		return selected.length > 0 ? selected.join(", ") : theme.fg("warning", "unanswered");
	}
	if (state.customInput !== undefined) return `“${inlineText(state.customInput)}”`;
	return selected[0] ?? theme.fg("warning", "unanswered");
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

function isNoteKey(data: string): boolean {
	const key = data.length === 1 ? data : decodePrintableKey(data);
	return key === "n" || key === "N";
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
	#timeoutPending = false;
	#closed = false;
	#prompt: HookEditorComponent | undefined;
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

	constructor(questions: ExtensionAskDialogQuestion[], tui: TUI, callbacks: DialogCallbacks, options: DialogOptions) {
		this.#questions = questions;
		this.#tui = tui;
		this.#callbacks = callbacks;
		this.#options = options;
		const timeoutMs = options.timeout;
		this.#states = questions.map(question => ({
			selectedOptions: new Set<string>(),
			customInput: undefined,
			note: undefined,
			noteRowKey: undefined,
			cursorIndex: clamp(question.recommended ?? 0, 0, Math.max(0, question.options.length - 1)),
			scrollOffset: 0,
			followCursor: false,
			timedOut: false,
			customImages: [],
			noteImages: [],
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
	}

	invalidate(): void {
		this.#stableHeight = undefined;
		this.#layoutCache.clear();
		this.#markdownCache.clear();
		this.#previewCache.clear();
		this.#panel.invalidate();
		this.#prompt?.invalidate?.();
	}

	dispose(): void {
		this.#closed = true;
		this.#countdown?.dispose();
		this.#prompt?.dispose();
		this.#prompt = undefined;
		this.#panel.dispose();
	}

	handleInput(data: string): void {
		if (this.#closed) return;
		this.#countdown?.reset();
		if (this.#prompt) {
			this.#handlePromptInput(this.#prompt, data);
			this.#requestRender();
			return;
		}
		const keybindings = getKeybindings();
		if (keybindings.matches(data, "tui.select.cancel")) {
			this.#finish(undefined);
			return;
		}
		if (this.#hasSubmitTab() && handleTabSwitchKey(data, direction => this.#switchTab(direction))) {
			this.#requestRender();
			return;
		}
		if (this.#isSubmitTab()) {
			if (keybindings.matches(data, "tui.select.up")) this.#submitScroll = Math.max(0, this.#submitScroll - 1);
			else if (keybindings.matches(data, "tui.select.down")) this.#submitScroll += 1;
			else if (isEnter(data)) this.#submit();
			this.#requestRender();
			return;
		}
		this.#handleQuestionInput(data);
	}

	render(width: number): readonly string[] {
		const termRows = this.#tui.terminal?.rows ?? process.stdout.rows ?? 40;
		// Panels render two columns wider, then lose their `│` side borders.
		const innerWidth = Math.max(1, width - 2);
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
		this.#panel.title = this.#remainingSeconds === undefined ? "Ask" : `Ask (${this.#remainingSeconds}s)`;
		this.#body.setLines(body.lines);
		this.#body.setHeight(bodyRows);
		this.#footer.setLines([theme.fg("dim", truncateToWidth(this.#footerHint(body.indicator), innerWidth))]);
		return withoutSideBorders(this.#panel.render(width + 2), width);
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
			state.customInput ?? "\u0001",
			state.noteRowKey ?? "",
			state.note ?? "",
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
		const checked = option ? state.selectedOptions.has(option.label) : state.customInput !== undefined;
		// No `❯` cursor column: the focused row shows as an accent, bold label
		// with an accent marker; the marker glyph alone shows the checked state.
		const color = selected ? "accent" : checked ? "toolOutput" : "text";
		const markerColor = checked ? "success" : selected ? "accent" : "dim";
		const marker = `${theme.fg(markerColor, optionMarker(question.multi, checked))} `;
		const noteMarker = state.note && state.noteRowKey === row.key ? theme.fg("success", "  ✎ note") : "";
		const style = (t: string) => (selected ? theme.bold(theme.fg(color, t)) : theme.fg(color, t));
		const label = renderInlineMarkdown(row.label, getMarkdownTheme(), style);
		const labelWidth = Math.max(1, width - visibleWidth(marker) - (noteMarker ? visibleWidth(noteMarker) : 0));
		const wrapped = wrapTextWithAnsi(label, labelWidth);
		// Label wrap lines, descriptions, previews, and custom answers all start
		// at the label's text column so the option reads as one aligned block.
		const labelColumn = visibleWidth(marker);
		const indent = padding(labelColumn);
		const lines = [`${marker}${wrapped[0] ?? ""}${noteMarker}`];
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
		if (row.kind === "other" && state.customInput !== undefined) {
			const answer = truncateToWidth(inlineText(state.customInput), detailWidth, Ellipsis.Unicode);
			lines.push(theme.fg("muted", `${detailIndent}${answer}`));
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
		const unanswered = this.#states.filter(state => state.selectedOptions.size === 0 && state.customInput === undefined)
			.length;
		if (unanswered > 0) {
			lines.push(
				theme.fg("warning", `${unanswered} unanswered question${unanswered === 1 ? "" : "s"}; Enter still submits.`),
			);
			lines.push("");
		}
		for (let index = 0; index < this.#questions.length; index++) {
			const question = this.#questions[index];
			const state = this.#states[index];
			if (!question || !state) continue;
			const summary = `${theme.fg("dim", `${index + 1}. ${tabLabel(question, index)}:`)} ${answerSummary(question, state)}`;
			lines.push(truncateToWidth(summary, width, Ellipsis.Unicode));
			const note = noteForSubmittedAnswer(question, state);
			if (note?.trim()) {
				lines.push(theme.fg("muted", `   Note: ${truncateToWidth(inlineText(note), Math.max(1, width - 9), Ellipsis.Unicode)}`));
			}
		}
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
		const scroll = indicator ? ` · ${pageKeysLabel()} ${indicator} scroll` : "";
		if (this.#isSubmitTab()) return `Enter submit · ↑/↓ scroll · Tab/←/→ · ${cancel}`;
		const question = this.#questions[this.#questionIndex()];
		const enterAction = this.#questions.length > 1 ? "next" : "submit";
		const action = question?.multi ? `Space toggle · Enter ${enterAction}` : "Enter select";
		const tabs = this.#hasSubmitTab() ? " · Tab/←/→" : "";
		return `${action} · n note · ↑/↓ move${tabs}${scroll} · ${cancel}`;
	}

	// ---------------------------------------------------------------------------
	// Input
	// ---------------------------------------------------------------------------

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
		if (keybindings.matches(data, "tui.select.up") || keybindings.matches(data, "tui.select.down")) {
			// The first move after reading reveals the cursor instead of skipping past it.
			if (state.followCursor || this.#cursorVisible(index)) {
				const delta = keybindings.matches(data, "tui.select.up") ? -1 : 1;
				state.cursorIndex = clamp(state.cursorIndex + delta, 0, Math.max(0, rows.length - 1));
			}
			state.followCursor = true;
			this.#requestRender();
			return;
		}
		const row = rows[state.cursorIndex];
		if (!row) return;
		const note = isNoteKey(data);
		const enter = isEnter(data);
		const space = question.multi === true && isSpace(data);
		if (!note && !enter && !space) return;
		// Never act on a row the user cannot see; reveal it first.
		if (!this.#cursorVisible(index)) {
			state.followCursor = true;
			this.#requestRender();
			return;
		}
		if (note) {
			this.#openPrompt({
				title: `Note for ${inlineText(row.label)}`,
				prefill: state.noteRowKey === row.key ? state.note : undefined,
				images: state.noteRowKey === row.key ? state.noteImages : [],
				apply: (value, images) => {
					state.note = value;
					state.noteRowKey = row.key;
					state.noteImages = images;
				},
			});
			return;
		}
		if (row.kind === "other") {
			this.#openPrompt({
				title: "Custom answer",
				prefill: state.customInput,
				images: state.customImages,
				apply: (value, images) => this.#applyCustomInput(question, state, row, value, images),
			});
			return;
		}
		const option = question.options[row.optionIndex ?? -1];
		if (!option) return;
		if (question.multi) {
			if (enter) {
				this.#advance();
				return;
			}
			if (state.selectedOptions.has(option.label)) {
				state.selectedOptions.delete(option.label);
				if (state.noteRowKey === row.key) this.#clearNote(state);
			} else {
				state.selectedOptions.add(option.label);
			}
			this.#requestRender();
			return;
		}
		state.selectedOptions = new Set([option.label]);
		state.customInput = undefined;
		state.customImages = [];
		if (state.noteRowKey !== undefined && state.noteRowKey !== row.key) this.#clearNote(state);
		this.#advance();
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

	#applyCustomInput(
		question: ExtensionAskDialogQuestion,
		state: QuestionState,
		row: QuestionRow,
		value: string,
		images: AskImage[],
	): void {
		if (value.trim() === "") {
			// Submitting an empty value unselects the custom answer.
			state.customInput = undefined;
			state.customImages = [];
			if (state.noteRowKey === row.key) this.#clearNote(state);
			return;
		}
		state.customInput = value;
		state.customImages = images;
		if (!question.multi) {
			state.selectedOptions.clear();
			if (state.noteRowKey !== undefined && state.noteRowKey !== row.key) this.#clearNote(state);
		}
		if (question.multi && this.#questions.length === 1) {
			this.#activeTab = this.#questions.length;
			this.#submitScroll = 0;
		} else {
			this.#advance();
		}
	}

	#clearNote(state: QuestionState): void {
		state.note = undefined;
		state.noteRowKey = undefined;
		state.noteImages = [];
	}

	#switchTab(direction: 1 | -1): void {
		const tabCount = this.#questions.length + 1;
		this.#activeTab = (this.#activeTab + direction + tabCount) % tabCount;
		this.#submitScroll = 0;
	}

	#advance(): void {
		if (this.#questions.length === 1) {
			this.#submit();
			return;
		}
		const current = this.#questionIndex();
		this.#activeTab = current + 1 < this.#questions.length ? current + 1 : this.#questions.length;
		this.#submitScroll = 0;
		this.#requestRender();
	}

	// ---------------------------------------------------------------------------
	// Custom answer / note editor
	// ---------------------------------------------------------------------------

	#openPrompt(request: PromptRequest): void {
		const close = () => {
			this.#prompt?.dispose();
			this.#prompt = undefined;
			this.#promptImages = [];
			if (this.#timeoutPending) {
				this.#timeoutPending = false;
				this.#handleTimeout();
			}
			this.#requestRender();
		};
		this.#promptImages = [...request.images];
		this.#prompt = new HookEditorComponent(
			this.#tui,
			request.title,
			request.prefill,
			value => {
				if (!this.#closed) {
					// Deleting an `[Image #N]` label from the text drops that image.
					request.apply(
						value,
						this.#promptImages.filter(image => value.includes(image.label)),
					);
				}
				close();
			},
			close,
			{ promptStyle: true, maxHeight: PROMPT_EDITOR_ROWS },
		);
		this.#prompt.focused = this.focused;
		this.#requestRender();
	}

	/** Only the image-paste key (Ctrl+V by default) reads the clipboard for images,
	 *  matching the main prompt; terminal pastes (Cmd+V) stay plain text. */
	#handlePromptInput(prompt: HookEditorComponent, data: string): void {
		if (getKeybindings().matches(data, PASTE_IMAGE_KEY)) {
			this.#attachPaste(prompt, readClipboardPaste(this.#options.cwd));
			return;
		}
		prompt.handleInput(data);
	}

	/** Reserve the paste slot now so later keystrokes and submit wait for the async read. */
	#attachPaste(prompt: HookEditorComponent, outcome: Promise<PasteOutcome>): void {
		const deliver = prompt.beginPaste();
		void outcome.then(result => {
			if (this.#prompt !== prompt) {
				deliver(undefined);
				return;
			}
			if ("error" in result) {
				this.#options.notify(result.error);
				deliver(undefined);
			} else if ("text" in result) {
				deliver(result.text);
			} else {
				const labels = result.images.map(image => {
					this.#imageCount += 1;
					const attached: AskImage = { ...image, label: `[Image #${this.#imageCount}]` };
					this.#promptImages.push(attached);
					return attached.label;
				});
				deliver(`${labels.join(" ")} `);
			}
			this.#requestRender();
		});
	}

	/** Keep the question's Markdown visible above the editor, trimmed to fit. */
	#renderPrompt(width: number, innerWidth: number, termRows: number): string[] {
		const prompt = this.#prompt;
		if (!prompt) return [];
		prompt.focused = this.focused;
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
			if (state.selectedOptions.size > 0 || state.customInput !== undefined) continue;
			const noted = /^option:(\d+)$/.exec(state.noteRowKey ?? "");
			const notedIndex = noted?.[1] === undefined ? Number.NaN : Number.parseInt(noted[1], 10);
			const fallbackIndex =
				Number.isInteger(notedIndex) && question.options[notedIndex]
					? notedIndex
					: clamp(question.recommended ?? 0, 0, Math.max(0, question.options.length - 1));
			const fallback = question.options[fallbackIndex];
			if (fallback) state.selectedOptions.add(fallback.label);
			state.timedOut = true;
		}
		this.#submit();
	}

	#submit(): void {
		const results: MarkdownAskResultItem[] = this.#questions.flatMap((question, index) => {
			const state = this.#states[index];
			if (!state) return [];
			const note = noteForSubmittedAnswer(question, state);
			return [
				{
					id: question.id,
					question: question.question,
					options: question.options.map(option => option.label),
					multi: question.multi ?? false,
					selectedOptions: question.options
						.map(option => option.label)
						.filter(label => state.selectedOptions.has(label)),
					customInput: state.customInput,
					note,
					timedOut: state.timedOut || undefined,
					images: [
						...(state.customInput !== undefined ? state.customImages : []),
						...(note !== undefined ? state.noteImages : []),
					],
				},
			];
		});
		this.#finish({ kind: "submit", results });
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
