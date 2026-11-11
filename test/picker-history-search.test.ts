import { beforeAll, describe, expect, test } from "bun:test";
import { CustomEditor, type ExtensionAskDialogQuestion, type ExtensionUIContext, Settings } from "@oh-my-pi/pi-coding-agent";
import { SelectorController } from "@oh-my-pi/pi-coding-agent/modes/controllers/selector-controller";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { type Component, Container, type Terminal, TUI } from "@oh-my-pi/pi-tui";
import type { HistorySearchEntry } from "@oh-my-pi/pi-tui/overlays/history-search";
import { getEditorTheme, initTheme } from "@oh-my-pi/pi-tui/theme";
import { showMarkdownAskDialog } from "../extensions/ask-dialog";
import type { AskPickerBtw } from "../extensions/picker-btw";

beforeAll(async () => {
	await Settings.init({ inMemory: true });
	await initTheme();
});

const ESC = "\x1b";
const ENTER = "\r";
const CTRL_R = "\x12";

const store: ExtensionAskDialogQuestion = {
	id: "store",
	question: "Where should drafts live?",
	options: [{ label: "Memory" }, { label: "Disk" }],
};
const keep: ExtensionAskDialogQuestion = {
	id: "keep",
	question: "What should a draft keep?",
	options: [{ label: "Picks" }, { label: "Notes" }],
};

/**
 * The Picker in the host's editor slot, with the host's own Ctrl+R history
 * search (`SelectorController.showHistorySearch`) over a fixed global history.
 */
function openPicker(questions: ExtensionAskDialogQuestion[] = [store], askBtw?: AskPickerBtw) {
	const terminal = new Proxy({ rows: 40, columns: 100 } as Record<string | symbol, unknown>, {
		get: (target, key) => (key in target ? target[key] : () => {}),
	}) as unknown as Terminal;
	// No paints: the test reads results, not frames.
	const ui = new TUI(terminal, false, {
		renderScheduler: { now: () => 0, scheduleImmediate() {}, scheduleRender: () => ({ cancel() {} }) as never },
	});
	const editorContainer = new Container();
	const composer = new CustomEditor(ui, getEditorTheme());
	composer.setText("half-typed main prompt");
	editorContainer.addChild(composer);
	ui.setFocus(composer);
	const history: HistorySearchEntry[] = [{ prompt: "a prompt from history", created_at: Date.now() }];
	const ctx = {
		ui,
		editor: composer,
		editorContainer,
		historyStorage: { getRecent: () => history, search: () => history },
	} as unknown as InteractiveModeContext;
	const selector = new SelectorController(ctx);

	// As the host shows a non-overlay custom component: it replaces the editor slot and takes focus.
	const extensionUi = {
		custom: (factory: (tui: TUI, theme: unknown, keybindings: unknown, done: (value: unknown) => void) => Component) =>
			new Promise(resolve => {
				const picker = factory(ui, undefined, undefined, value => {
					editorContainer.clear();
					editorContainer.addChild(composer);
					ui.setFocus(composer);
					resolve(value);
				});
				editorContainer.clear();
				editorContainer.addChild(picker);
				ui.setFocus(picker);
			}),
	} as unknown as ExtensionUIContext;
	const result = showMarkdownAskDialog(extensionUi, questions, {
		cwd: process.cwd(),
		notify() {},
		autocomplete: () => undefined,
		fileCommands: new Set(),
		askBtw,
	});
	// The host's global Ctrl+R listener runs before the focused component.
	const press = (...keys: string[]) => {
		for (const key of keys) {
			if (key === CTRL_R) selector.showHistorySearch();
			else ui.getFocused()?.handleInput?.(key);
		}
	};
	return { result, press, composer };
}

describe("Ctrl+R history search in a Picker editor", () => {
	test("the picked entry replaces the note's text, which can then be edited and saved", async () => {
		const picker = openPicker();
		picker.press("n", ..."draft", CTRL_R, ENTER, ..." edited", ENTER, ENTER);
		const submitted = await picker.result;
		expect(submitted).toMatchObject({
			kind: "submit",
			results: [{ selectedOptions: ["Memory"], notes: [{ option: "Memory", note: "a prompt from history edited" }] }],
		});
		expect(picker.composer.getText()).toBe("half-typed main prompt");
	});

	test("cancelling the search keeps the note's text", async () => {
		const picker = openPicker();
		picker.press("n", ..."draft", CTRL_R, ESC, ..." kept", ENTER, ENTER);
		expect(await picker.result).toMatchObject({
			kind: "submit",
			results: [{ notes: [{ option: "Memory", note: "draft kept" }] }],
		});
	});

	test("after a cancelled search the note still has focus, so the next Ctrl+R fills it", async () => {
		const picker = openPicker();
		picker.press("n", ..."draft", CTRL_R, ESC, CTRL_R, ENTER, ENTER, ENTER);
		expect(await picker.result).toMatchObject({
			kind: "submit",
			results: [{ notes: [{ option: "Memory", note: "a prompt from history" }] }],
		});
		expect(picker.composer.getText()).toBe("half-typed main prompt");
	});

	test("an Other answer takes the picked entry", async () => {
		const picker = openPicker();
		picker.press("j", "j", ENTER, ..."draft", CTRL_R, ENTER, ..." edited", ENTER, ENTER);
		expect(await picker.result).toMatchObject({
			kind: "submit",
			results: [{ selectedOptions: [], customInput: "a prompt from history edited" }],
		});
		expect(picker.composer.getText()).toBe("half-typed main prompt");
	});

	test("the Submit note takes the picked entry", async () => {
		const picker = openPicker([store, keep]);
		picker.press(ENTER, ENTER, "n", ..."draft", CTRL_R, ENTER, ENTER, ENTER);
		expect(await picker.result).toMatchObject({
			kind: "submit",
			submitNote: { text: "a prompt from history" },
		});
		expect(picker.composer.getText()).toBe("half-typed main prompt");
	});

	test("a Picker btw question takes the picked entry", async () => {
		const asked: string[] = [];
		const picker = openPicker([store], async request => {
			asked.push(request.promptText);
			return "an answer";
		});
		picker.press("?", ..."draft", CTRL_R, ENTER, ENTER);
		expect(asked).toHaveLength(1);
		expect(asked[0]).toContain("a prompt from history");
		expect(asked[0]).not.toContain("draft");
		await Bun.sleep(0);
		picker.press(ESC, ENTER);
		expect(await picker.result).toMatchObject({ kind: "submit", results: [{ selectedOptions: ["Memory"] }] });
		expect(picker.composer.getText()).toBe("half-typed main prompt");
	});
});
