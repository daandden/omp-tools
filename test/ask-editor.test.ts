import { beforeAll, describe, expect, test } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent";
import type { TUI } from "@oh-my-pi/pi-tui";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import { AnswerEditor } from "../extensions/ask-editor";

beforeAll(async () => {
	await Settings.init({ inMemory: true });
	await initTheme();
});

function editorFixture() {
	const submitted: string[] = [];
	const tui = {
		terminal: { rows: 40, columns: 100 },
		getShowHardwareCursor: () => false,
		requestRender() {},
	} as unknown as TUI;
	const editor = new AnswerEditor(tui, {
		title: "Other answer",
		prefill: undefined,
		maxHeight: 4,
		autocomplete: undefined,
		fileCommands: new Set(),
		hints: [],
		onSubmit: text => submitted.push(text),
		onCancel() {},
		onAttachImage: () => 1,
		onPasteImage: async () => false,
		onPasteImagePath: async () => {},
		editExternally: async () => null,
		onInput() {},
	});
	return { editor, submitted };
}

describe("Picker editor host paste", () => {
	test("pasted text reaches the answer rather than the hidden main composer", () => {
		const { editor, submitted } = editorFixture();
		editor.pasteText("a pasted answer");
		editor.handleInput("\r");
		expect(submitted).toEqual(["a pasted answer"]);
		editor.dispose();
	});

	test("a host-pasted image is an atomic chip that expands in the answer", () => {
		const { editor, submitted } = editorFixture();
		editor.pasteText("Look at ");
		const marker = editor.attachImage({ type: "image", mimeType: "image/png", data: "aW1hZ2U=" });
		expect(marker).toBe("[Image #1]");
		editor.pasteText(marker!);
		editor.handleInput("\r");
		expect(submitted).toEqual(["Look at [Image #1]"]);
		editor.dispose();
	});

	test("Enter waits for a host image paste before saving the answer", () => {
		const { editor, submitted } = editorFixture();
		editor.pasteText("See ");
		const finish = editor.beginPaste();
		editor.handleInput("\r");
		expect(submitted).toEqual([]);
		const marker = editor.attachImage({ type: "image", mimeType: "image/png", data: "aW1hZ2U=" });
		finish(marker);
		expect(submitted).toEqual(["See [Image #1]"]);
		editor.dispose();
	});

	test("a failed paste releases typing but does not save a stale answer", () => {
		const { editor, submitted } = editorFixture();
		editor.pasteText("original");
		const finish = editor.beginPaste();
		editor.handleInput("\r");
		finish(undefined);
		expect(submitted).toEqual([]);
		editor.handleInput("!");
		editor.handleInput("\r");
		expect(submitted).toEqual(["original!"]);
		editor.dispose();
	});

	test("keys typed between two pastes keep their place", () => {
		const { editor, submitted } = editorFixture();
		const finish = editor.beginPaste();
		editor.handleInput("x");
		editor.pasteText("B");
		finish("A");
		editor.handleInput("\r");
		expect(submitted).toEqual(["AxB"]);
		editor.dispose();
	});
});
