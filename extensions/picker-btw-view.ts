// The Picker btw view: `?` in the Picker swaps its options for this thread of
// side questions (oldest first, scrolling) above a question box. It renders
// inside the Picker's panel; the Picker owns focus hand-back and the answers.
// Answers come from ./picker-btw.ts; the thread lives as long as the Picker.
import type { CustomEditor } from "@oh-my-pi/pi-coding-agent";
import {
	type AutocompleteProvider,
	getKeybindings,
	type NativeChild,
	type NativeNode,
	type NativeScroll,
	node,
	span,
	type TUI,
	text,
} from "@oh-my-pi/pi-tui";
import { theme } from "@oh-my-pi/pi-tui/theme";
import type { AskImage } from "./ask-dialog";
import { AnswerEditor, externalEditorKey, scrollBox, withoutSideBorders } from "./ask-editor";
import { loadImagePaths, type PasteOutcome, type PastedImage, readClipboardPaste } from "./ask-images";
import { type AskPickerBtw, numberImagesByAppearance, renderPickerBtwPrompt } from "./picker-btw";
import { answerInto, isInterruptKey, newTurn, type SideQuestionTurn, SideQuestionTurnView } from "./side-question-view";

/** Rows reserved for the question box. */
const QUESTION_EDITOR_ROWS = 4;
const EMPTY_THREAD = "Ask about this question or the conversation. The agent never sees the answer.";

export interface PickerBtwViewOptions {
	tui: TUI;
	ask: AskPickerBtw;
	cwd: string;
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
	readonly #turns: SideQuestionTurn[] = [];
	readonly #turnView = new SideQuestionTurnView("Answering… esc cancels");
	#abort: AbortController | undefined;
	#editor: AnswerEditor | undefined;
	#scroll = 0;
	#follow = true;
	#maxScroll = 0;
	#threadRows = 1;
	/** PgUp/PgDn forwarded to Tern, which owns the scroller there. */
	#nativeScroll: NativeScroll | undefined;
	#disposed = false;
	#images: AskImage[] = [];
	#imageCount = 0;

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
			onAttachImage: image => this.#retainImage({ image }),
			onPasteImage: async target => this.#insertPaste(target, await readClipboardPaste(this.#options.cwd)),
			onPasteImagePath: async (target, path) => {
				const outcome = await loadImagePaths([path], this.#options.cwd);
				if (!this.#insertPaste(target, outcome)) target.pasteText(path);
			},
			editExternally: text => this.#options.editExternally(text),
			// The ask timeout stays paused while this view is open.
			onInput: () => {},
			onKey: data => {
				// Esc while answering cancels without closing the box, so what is
				// typed keeps its paste chips. The editor's own Esc jobs come first.
				if (
					this.#running() &&
					isInterruptKey(data) &&
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
		this.#turnView.invalidate();
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
		this.#clearImages();
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
				: this.#turns.map((turn, index) => this.#turnView.describe(turn, index, false));
		// Each new question brings the thread's end into view; Tern keeps the scroll position otherwise.
		const content: NativeNode = { ...node("col", { gap: "sm" }, thread), reveal: { at: "end", n: this.#turns.length } };
		const threadNode = scrollBox(content, { lines, fixed: true, key: "thread", scroll: this.#nativeScroll });
		return this.#editor ? [threadNode, this.#editor] : [threadNode];
	}

	#threadLines(width: number): string[] {
		if (this.#turns.length === 0) {
			return [theme.fg("dim", EMPTY_THREAD)];
		}
		const lines: string[] = [];
		for (const turn of this.#turns) {
			if (lines.length > 0) lines.push("");
			lines.push(...this.#turnView.lines(turn, width, false));
		}
		return lines;
	}

	#page(direction: 1 | -1): void {
		const step = Math.max(1, this.#threadRows - 1);
		this.#scroll = Math.max(0, Math.min(this.#maxScroll, this.#scroll + direction * step));
		// Paging back to the end follows new text again.
		this.#follow = this.#scroll >= this.#maxScroll;
		this.#nativeScroll = { by: direction < 0 ? "page-up" : "page-down", n: (this.#nativeScroll?.n ?? 0) + 1 };
		this.#options.tui.requestRender();
	}

	#running(): SideQuestionTurn | undefined {
		const last = this.#turns.at(-1);
		return last?.status === "running" ? last : undefined;
	}

	#retainImage(image: PastedImage): number {
		this.#imageCount += 1;
		this.#images.push({ ...image, label: `[Image #${this.#imageCount}]` });
		return this.#imageCount;
	}

	#insertPaste(editor: CustomEditor, outcome: PasteOutcome): boolean {
		if (this.#editor?.editor !== editor || this.#disposed) return false;
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
		this.#options.tui.requestRender();
		return true;
	}

	#submit(text: string): void {
		if (!text.trim()) {
			this.#clearImages();
			this.open();
			return;
		}
		if (this.#running()) {
			this.#options.notify("Wait for the answer, or press Esc to cancel it.");
			this.open(text);
			return;
		}
		const { text: question, images } = numberImagesByAppearance(text.trim(), this.#images);
		this.#clearImages();
		const turn = newTurn(question);
		this.#turns.push(turn);
		const abort = new AbortController();
		this.#abort = abort;
		this.#follow = true;
		this.open();
		const promptText = renderPickerBtwPrompt(question, this.#options.draftAnswers());
		void answerInto(
			turn,
			callbacks => this.#options.ask({ promptText, images, signal: abort.signal, ...callbacks }),
			() => this.#options.tui.requestRender(),
		).then(() => {
			if (this.#abort === abort) this.#abort = undefined;
		});
	}

	#clearImages(): void {
		this.#images = [];
		this.#imageCount = 0;
	}

	#cancel(): void {
		const running = this.#running();
		if (running) running.status = "cancelled";
		this.#abort?.abort();
		this.#abort = undefined;
	}
}
