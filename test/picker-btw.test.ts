import { beforeAll, describe, expect, test } from "bun:test";
import { type ExtensionUIContext, Settings } from "@oh-my-pi/pi-coding-agent";
import { type Component, type Terminal, TUI } from "@oh-my-pi/pi-tui";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import { showPicker } from "../extensions/ask-dialog";
import { readHtmlForm } from "../extensions/ask-form";
import { type AskPickerBtw, numberImagesByAppearance } from "../extensions/picker-btw";

const ESC = "\x1b";
const ENTER = "\r";

const image = (data: string) => ({ type: "image" as const, mimeType: "image/png", data });

describe("numberImagesByAppearance", () => {
	test("numbers the images the question still mentions, in text order", () => {
		const result = numberImagesByAppearance("compare [Image #3] with [Image #2]", [
			{ label: "[Image #1]", image: image("one") },
			{ label: "[Image #2]", image: image("two") },
			{ label: "[Image #3]", image: image("three") },
		]);
		expect(result.text).toBe("compare [Image #1] with [Image #2]");
		expect(result.images.map(item => item.data)).toEqual(["three", "two"]);
	});

	test("leaves typed labels that name no pasted image as they are", () => {
		const result = numberImagesByAppearance("what is [Image #9]?", [{ label: "[Image #4]", image: image("four") }]);
		expect(result).toEqual({ text: "what is [Image #9]?", images: [] });
	});
});

describe("Picker btw on a form with text fields", () => {
	beforeAll(async () => {
		await Settings.init({ inMemory: true });
		await initTheme();
	});

	function openPicker(html: string, askBtw: AskPickerBtw, timeout: number) {
		const terminal = new Proxy({ rows: 40, columns: 100 } as Record<string | symbol, unknown>, {
			get: (target, key) => (key in target ? target[key] : () => {}),
		}) as unknown as Terminal;
		const ui = new TUI(terminal, false, {
			renderScheduler: { now: () => 0, scheduleImmediate() {}, scheduleRender: () => ({ cancel() {} }) as never },
		});
		// As the host shows a non-overlay custom component: it takes focus until done.
		const extensionUi = {
			custom: (factory: (tui: TUI, theme: unknown, keybindings: unknown, done: (value: unknown) => void) => Component) =>
				new Promise(resolve => {
					ui.setFocus(factory(ui, undefined, undefined, resolve));
				}),
		} as unknown as ExtensionUIContext;
		const read = readHtmlForm(html);
		if (read.kind !== "form") throw new Error(`not a Picker form: ${read.kind}`);
		const result = showPicker(extensionUi, read.form, {
			cwd: process.cwd(),
			notify() {},
			autocomplete: () => undefined,
			fileCommands: new Set(),
			askBtw,
			timeout,
		});
		const press = (...keys: string[]) => {
			for (const key of keys) ui.getFocused()?.handleInput?.(key);
		};
		return { result, press };
	}

	test("opens, pauses the countdown, and the next key in the form restarts it", async () => {
		const picker = openPicker(
			`<form><p>Where should drafts live?</p>
				<label><input type="radio" name="store" value="memory"> Memory</label>
				<label><input type="radio" name="store" value="disk"> Disk</label>
				<label>Title <input name="title"></label></form>`,
			async () => "an answer",
			1000,
		);
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
