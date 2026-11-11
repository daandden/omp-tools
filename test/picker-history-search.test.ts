import { beforeAll, describe, expect, test } from "bun:test";
import { CustomEditor, type ExtensionUIContext, Settings } from "@oh-my-pi/pi-coding-agent";
import { SelectorController } from "@oh-my-pi/pi-coding-agent/modes/controllers/selector-controller";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { type Component, Container, type Terminal, TUI } from "@oh-my-pi/pi-tui";
import type { HistorySearchEntry } from "@oh-my-pi/pi-tui/overlays/history-search";
import { getEditorTheme, initTheme } from "@oh-my-pi/pi-tui/theme";
import { showPicker } from "../extensions/ask-dialog";
import { type AskForm, readHtmlForm } from "../extensions/ask-form";
import type { AskPickerBtw } from "../extensions/picker-btw";

beforeAll(async () => {
	await Settings.init({ inMemory: true });
	await initTheme();
});

const ESC = "\x1b";
const ENTER = "\r";
const CTRL_R = "\x12";

const STORE = `<p>Where should drafts live?</p>
	<label><input type="radio" name="store" value="memory"> Memory</label>
	<label><input type="radio" name="store" value="disk"> Disk</label>`;
const KEEP = `<p>What should a draft keep?</p>
	<label><input type="radio" name="keep" value="picks"> Picks</label>
	<label><input type="radio" name="keep" value="notes"> Notes</label>`;

const TITLE = `<label>Title <input name="title"></label>`;

function form(...questions: string[]): AskForm {
	const read = readHtmlForm(`<form>${questions.join("\n")}</form>`);
	if (read.kind !== "form") throw new Error(`not a Picker form: ${read.kind}`);
	return read.form;
}

/**
 * The Picker in the host's editor slot, with the host's own Ctrl+R history
 * search (`SelectorController.showHistorySearch`) over a fixed global history.
 */
function openPicker(questions: string[] = [STORE], askBtw?: AskPickerBtw, timeout?: number) {
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
	const result = showPicker(extensionUi, form(...questions), {
		cwd: process.cwd(),
		notify() {},
		autocomplete: () => undefined,
		fileCommands: new Set(),
		askBtw,
		timeout,
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
			answer: {
				data: { store: "memory" },
				questions: [{ picked: [0], notes: [{ option: "Memory", text: "a prompt from history edited" }] }],
			},
		});
		expect(picker.composer.getText()).toBe("half-typed main prompt");
	});

	test("cancelling the search keeps the note's text", async () => {
		const picker = openPicker();
		picker.press("n", ..."draft", CTRL_R, ESC, ..." kept", ENTER, ENTER);
		expect(await picker.result).toMatchObject({
			kind: "submit",
			answer: { questions: [{ notes: [{ option: "Memory", text: "draft kept" }] }] },
		});
	});

	test("after a cancelled search the note still has focus, so the next Ctrl+R fills it", async () => {
		const picker = openPicker();
		picker.press("n", ..."draft", CTRL_R, ESC, CTRL_R, ENTER, ENTER, ENTER);
		expect(await picker.result).toMatchObject({
			kind: "submit",
			answer: { questions: [{ notes: [{ option: "Memory", text: "a prompt from history" }] }] },
		});
		expect(picker.composer.getText()).toBe("half-typed main prompt");
	});

	test("an Other answer takes the picked entry", async () => {
		const picker = openPicker();
		picker.press("j", "j", ENTER, ..."draft", CTRL_R, ENTER, ..." edited", ENTER, ENTER);
		expect(await picker.result).toMatchObject({
			kind: "submit",
			answer: { questions: [{ picked: [], other: { text: "a prompt from history edited" } }] },
		});
		expect(picker.composer.getText()).toBe("half-typed main prompt");
	});

	test("the Submit note takes the picked entry", async () => {
		const picker = openPicker([STORE, KEEP]);
		picker.press(ENTER, ENTER, "n", ..."draft", CTRL_R, ENTER, ENTER, ENTER);
		expect(await picker.result).toMatchObject({
			kind: "submit",
			answer: { submitNote: { text: "a prompt from history" } },
		});
		expect(picker.composer.getText()).toBe("half-typed main prompt");
	});

	test("a Picker btw question takes the picked entry", async () => {
		const asked: string[] = [];
		const picker = openPicker([STORE], async request => {
			asked.push(request.promptText);
			return "an answer";
		});
		picker.press("?", ..."draft", CTRL_R, ENTER, ENTER);
		expect(asked).toHaveLength(1);
		expect(asked[0]).toContain("a prompt from history");
		expect(asked[0]).not.toContain("draft");
		await Bun.sleep(0);
		picker.press(ESC, ENTER);
		expect(await picker.result).toMatchObject({ kind: "submit", answer: { questions: [{ picked: [0] }] } });
		expect(picker.composer.getText()).toBe("half-typed main prompt");
	});

	test("a text field's editor takes the picked entry", async () => {
		const picker = openPicker([TITLE]);
		picker.press(ENTER, ..."draft", CTRL_R, ENTER, ..." edited", ENTER, "l", ENTER);
		expect(await picker.result).toMatchObject({ kind: "submit", answer: { data: { title: "a prompt from history edited" } } });
		expect(picker.composer.getText()).toBe("half-typed main prompt");
	});
});

describe("Picker btw on a form with text fields", () => {
	test("opens, pauses the countdown, and the next key in the form restarts it", async () => {
		const picker = openPicker([STORE, TITLE], async () => "an answer", 1000);
		picker.press(ENTER, ENTER, ..."typed", ENTER, "?");
		await Bun.sleep(1300);
		picker.press(ESC);
		await Bun.sleep(1300);
		const open = await Promise.race([picker.result.then(() => "settled"), Bun.sleep(0).then(() => "open")]);
		expect(open).toBe("open");
		picker.press("k");
		expect(await picker.result).toMatchObject({
			kind: "submit",
			answer: { timedOut: true, data: { store: "memory", title: "typed" } },
		});
	});
});
