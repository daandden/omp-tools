// The Picker btw view: `?` in the Picker swaps its options for this thread of
// side questions (oldest first, scrolling) above a question box. It renders
// inside the Picker's panel; the Picker owns focus hand-back and the answers.
// Answers come from ./picker-btw.ts; the thread lives as long as the Picker.
import {
	type AutocompleteProvider,
	getKeybindings,
	Markdown,
	matchesKey,
	md,
	type NativeChild,
	type NativeNode,
	type NativeScroll,
	node,
	replaceTabs,
	span,
	type TUI,
	text,
	wrapTextWithAnsi,
} from "@oh-my-pi/pi-tui";
import { getMarkdownTheme, theme } from "@oh-my-pi/pi-tui/theme";
import { AnswerEditor, externalEditorKey, scrollBox, withoutSideBorders } from "./ask-editor";
import { type AskPickerBtw, type PickerBtwTurn, renderPickerBtwPrompt } from "./picker-btw";

/** Rows reserved for the question box. */
const QUESTION_EDITOR_ROWS = 4;
const EMPTY_THREAD = "Ask about this question or the conversation. The agent never sees the answer.";

/** The interrupt key, as the question box's editor reads it (raw Escape when unbound). */
function isInterrupt(data: string): boolean {
	const keybindings = getKeybindings();
	if (keybindings.getKeys("app.interrupt").length > 0) return keybindings.matches(data, "app.interrupt");
	return matchesKey(data, "escape") || matchesKey(data, "esc");
}

export interface PickerBtwViewOptions {
	tui: TUI;
	ask: AskPickerBtw;
	/** The user's unsubmitted answers to the pending ask, as the agent would get them. */
	draftAnswers(): string;
	/** Fraction of the terminal the Picker may occupy. */
	heightRatio: number;
	autocomplete(): AutocompleteProvider | undefined;
	fileCommands: ReadonlySet<string>;
	editExternally(text: string): Promise<string | null>;
	notify(message: string): void;
	/** Esc with no answer running: back to the options. */
	onClose(): void;
}

export class PickerBtwView {
	readonly #options: PickerBtwViewOptions;
	readonly #turns: PickerBtwTurn[] = [];
	/** Thread id for the provider lineage; the epoch rotates after a cancelled or failed turn. */
	readonly #threadId = crypto.randomUUID();
	#epoch = 0;
	#abort: AbortController | undefined;
	#editor: AnswerEditor | undefined;
	#scroll = 0;
	#follow = true;
	#maxScroll = 0;
	#threadRows = 1;
	#markdown = new WeakMap<PickerBtwTurn, { source: string; markdown: Markdown }>();
	/** PgUp/PgDn forwarded to Tern, which owns the scroller there. */
	#nativeScroll: NativeScroll | undefined;
	#disposed = false;

	constructor(options: PickerBtwViewOptions) {
		this.#options = options;
	}

	/** Show the question box and take focus. */
	open(prefill?: string): void {
		if (this.#disposed) return;
		this.#editor?.dispose();
		const keybindings = getKeybindings();
		const editor = new AnswerEditor(this.#options.tui, {
			title: "Picker btw · only you see the answers",
			prefill,
			maxHeight: QUESTION_EDITOR_ROWS,
			autocomplete: this.#options.autocomplete(),
			fileCommands: this.#options.fileCommands,
			hints: [
				{ keys: ["enter"], label: "ask" },
				{ keys: ["escape"], label: "cancel answer, then back" },
				{ keys: ["pageUp", "pageDown"], label: "scroll" },
				{ keys: [externalEditorKey()], label: "external editor" },
			],
			onSubmit: text => this.#submit(text),
			onCancel: () => this.#close(),
			onPasteImage: async () => {
				this.#options.notify("Images can't be sent with a Picker btw question.");
				return true;
			},
			onPasteImagePath: async (target, path) => target.pasteText(path),
			editExternally: text => this.#options.editExternally(text),
			// The ask timeout stays paused while this view is open.
			onInput: () => {},
			onKey: data => {
				// Esc while answering cancels without closing the box, so what is
				// typed keeps its paste chips. The editor's own Esc jobs come first.
				if (
					this.#running() &&
					isInterrupt(data) &&
					!editor.editor.isShowingAutocomplete() &&
					!editor.editor.vimConsumesEscape()
				) {
					this.#cancel();
					return true;
				}
				if (keybindings.matches(data, "tui.select.pageUp")) {
					this.#page(-1);
					return true;
				}
				if (keybindings.matches(data, "tui.select.pageDown")) {
					this.#page(1);
					return true;
				}
				return false;
			},
		});
		this.#editor = editor;
		this.#options.tui.setFocus(editor);
		this.#options.tui.requestRender();
	}

	setUseTerminalCursor(useTerminalCursor: boolean): void {
		this.#editor?.setUseTerminalCursor(useTerminalCursor);
	}

	handleInput(data: string): void {
		this.#editor?.handleInput(data);
	}

	invalidate(): void {
		this.#markdown = new WeakMap();
		this.#editor?.invalidate?.();
	}

	/** Close the box and cancel a running answer; the thread is discarded with the view. */
	dispose(): void {
		this.#disposed = true;
		this.#cancel();
		this.#editor?.dispose();
		this.#editor = undefined;
	}

	/** Leave the view: the box closes, the thread stays for the next `?`. */
	#close(): void {
		this.#editor?.dispose();
		this.#editor = undefined;
		this.#options.onClose();
	}

	/** At least `minHeight` rows (the options' height), growing with the thread up to the Picker's cap. */
	render(width: number, termRows: number, minHeight: number): string[] {
		const innerWidth = Math.max(1, width - 2);
		const editorLines = this.#editor ? withoutSideBorders(this.#editor.render(width + 2), width) : [];
		const maxRows = Math.max(3, Math.floor(termRows * this.#options.heightRatio) - editorLines.length - 1);
		const thread = this.#threadLines(innerWidth);
		const rows = Math.min(maxRows, Math.max(thread.length, minHeight - editorLines.length - 1));
		const maxScroll = Math.max(0, thread.length - rows);
		if (this.#follow) this.#scroll = maxScroll;
		this.#scroll = Math.min(this.#scroll, maxScroll);
		this.#maxScroll = maxScroll;
		this.#threadRows = rows;
		const shown = thread.slice(this.#scroll, this.#scroll + rows);
		while (shown.length < rows) shown.push("");
		const above = this.#scroll > 0;
		const below = this.#scroll < maxScroll;
		const position = above || below ? theme.fg("dim", ` ${above ? "↑" : " "}${below ? "↓" : " "} pgup/pgdn`) : "";
		return [theme.fg("dim", ` thread${position}`), ...shown.map(line => ` ${line}`), ...editorLines];
	}

	/** The Tern view: the thread, `lines` text lines tall and scrolling, then the question box, which describes itself. */
	describe(lines: number): NativeChild[] {
		const thread =
			this.#turns.length === 0
				? [text([span(EMPTY_THREAD, "dim")], { wrap: "word" })]
				: this.#turns.map((turn, index) => this.#describeTurn(turn, index));
		// Each new question brings the thread's end into view; Tern keeps the scroll position otherwise.
		const content: NativeNode = { ...node("col", { gap: "sm" }, thread), reveal: { at: "end", n: this.#turns.length } };
		const threadNode = scrollBox(content, { lines, fixed: true, key: "thread", scroll: this.#nativeScroll });
		return this.#editor ? [threadNode, this.#editor] : [threadNode];
	}

	#describeTurn(turn: PickerBtwTurn, index: number): NativeNode {
		const children: NativeChild[] = [
			text([span("› ", "accent"), span(replaceTabs(turn.question).trim(), "muted")], { wrap: "word" }),
		];
		if (turn.answer.trim()) children.push(md(turn.answer, { stream: turn.status === "running" }));
		if (turn.status === "running") {
			children.push(node("spinner", { style: "dots", label: [span("Answering… esc cancels", "dim")] }));
		} else if (turn.status === "cancelled") {
			children.push(text([span("Cancelled", "warning")]));
		} else if (turn.status === "error") {
			const message = replaceTabs(turn.error ?? "Failed").replace(/\s+/g, " ").trim();
			children.push(text([span(`Error: ${message}`, "error")], { wrap: "word" }));
		}
		return node("col", { gap: "xs" }, children, `turn${index}`);
	}

	#threadLines(width: number): string[] {
		if (this.#turns.length === 0) {
			return [theme.fg("dim", EMPTY_THREAD)];
		}
		const lines: string[] = [];
		for (const turn of this.#turns) {
			if (lines.length > 0) lines.push("");
			const question = wrapTextWithAnsi(replaceTabs(turn.question).trim(), Math.max(1, width - 2));
			question.forEach((line, index) => {
				lines.push(`${theme.fg("accent", index === 0 ? "› " : "  ")}${theme.fg("muted", line)}`);
			});
			if (turn.answer.trim()) lines.push(...this.#answerMarkdown(turn).render(width));
			if (turn.status === "running") lines.push(theme.fg("dim", "Answering… esc cancels"));
			else if (turn.status === "cancelled") lines.push(theme.fg("warning", "Cancelled"));
			else if (turn.status === "error") {
				const message = replaceTabs(turn.error ?? "Failed").replace(/\s+/g, " ").trim();
				lines.push(...wrapTextWithAnsi(theme.fg("error", `Error: ${message}`), width));
			}
		}
		return lines;
	}

	#answerMarkdown(turn: PickerBtwTurn): Markdown {
		const cached = this.#markdown.get(turn);
		if (cached?.source === turn.answer) return cached.markdown;
		const markdown = new Markdown(turn.answer, 0, 0, getMarkdownTheme(), { color: text => theme.fg("text", text) });
		this.#markdown.set(turn, { source: turn.answer, markdown });
		return markdown;
	}

	#page(direction: 1 | -1): void {
		const step = Math.max(1, this.#threadRows - 1);
		this.#scroll = Math.max(0, Math.min(this.#maxScroll, this.#scroll + direction * step));
		// Paging back to the end follows new text again.
		this.#follow = this.#scroll >= this.#maxScroll;
		this.#nativeScroll = { by: direction < 0 ? "page-up" : "page-down", n: (this.#nativeScroll?.n ?? 0) + 1 };
		this.#options.tui.requestRender();
	}

	#running(): PickerBtwTurn | undefined {
		const last = this.#turns.at(-1);
		return last?.status === "running" ? last : undefined;
	}

	#submit(text: string): void {
		const question = text.trim();
		if (!question) {
			this.open();
			return;
		}
		if (this.#running()) {
			this.#options.notify("Wait for the answer, or press Esc to cancel it.");
			this.open(text);
			return;
		}
		const now = Date.now();
		const turn: PickerBtwTurn = {
			question,
			promptText: renderPickerBtwPrompt(question, this.#options.draftAnswers()),
			answer: "",
			status: "running",
			createdAt: now,
			updatedAt: now,
		};
		const earlier = [...this.#turns];
		this.#turns.push(turn);
		const abort = new AbortController();
		this.#abort = abort;
		this.#follow = true;
		this.open();
		void this.#options
			.ask({
				promptText: turn.promptText,
				earlier,
				conversationKey: `picker-btw:${this.#threadId}:${this.#epoch}`,
				signal: abort.signal,
				onTextDelta: delta => {
					if (turn.status !== "running") return;
					turn.answer += delta;
					turn.updatedAt = Date.now();
					this.#options.tui.requestRender();
				},
			})
			.then(
				answer => {
					if (turn.status !== "running") return;
					turn.answer = answer;
					turn.status = "complete";
					turn.updatedAt = Date.now();
				},
				(error: unknown) => {
					if (turn.status !== "running") return;
					turn.status = "error";
					turn.error = error instanceof Error ? error.message : String(error);
					turn.updatedAt = Date.now();
					this.#epoch += 1;
				},
			)
			.finally(() => {
				if (this.#abort === abort) this.#abort = undefined;
				this.#options.tui.requestRender();
			});
	}

	#cancel(): void {
		const running = this.#running();
		if (running) {
			running.status = "cancelled";
			running.updatedAt = Date.now();
			this.#epoch += 1;
		}
		this.#abort?.abort();
		this.#abort = undefined;
	}
}
