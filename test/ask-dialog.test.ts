import { beforeAll, describe, expect, test } from "bun:test";
import { type ExtensionAskDialogQuestion, type ExtensionUIContext, Settings } from "@oh-my-pi/pi-coding-agent";
import type { Component, TUI } from "@oh-my-pi/pi-tui";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import { type PickerDraft, showMarkdownAskDialog } from "../extensions/ask-dialog";

beforeAll(async () => {
	await Settings.init({ inMemory: true });
	await initTheme();
});

const ESC = "\x1b";
const ENTER = "\r";

const questions: ExtensionAskDialogQuestion[] = [
	{ id: "store", question: "Where should drafts live?", options: [{ label: "Memory" }, { label: "Disk" }] },
	{
		id: "keep",
		question: "What should a draft keep?",
		options: [{ label: "Picks" }, { label: "Notes" }, { label: "Thread" }],
		multi: true,
	},
];

function openPicker(draft?: PickerDraft) {
	let picker: Component | undefined;
	const tui = {
		terminal: { rows: 40, columns: 100, write() {} },
		getShowHardwareCursor: () => false,
		requestRender() {},
		setFocus() {},
	} as unknown as TUI;
	const ui = {
		custom: (factory: (tui: TUI, theme: unknown, keybindings: unknown, done: (value: unknown) => void) => Component) =>
			new Promise(resolve => {
				picker = factory(tui, undefined, undefined, resolve);
			}),
	} as unknown as ExtensionUIContext;
	const result = showMarkdownAskDialog(ui, questions, {
		cwd: process.cwd(),
		notify() {},
		autocomplete: () => undefined,
		fileCommands: new Set(),
		askBtw: undefined,
		draft,
	});
	const press = (...keys: string[]) => {
		for (const key of keys) picker?.handleInput?.(key);
	};
	return { result, press, render: () => picker?.render(100).join("\n") ?? "" };
}

describe("Picker draft", () => {
	test("the same questions open where Esc left them, and Enter sends the earlier picks", async () => {
		const first = openPicker();
		first.press("j", ENTER, " ", ESC);
		const cancelled = await first.result;
		if (cancelled?.kind !== "cancel" || !cancelled.draft) throw new Error("Esc kept no draft");

		const again = openPicker(cancelled.draft);
		again.press("j", " ", ENTER, ENTER);
		const submitted = await again.result;
		if (submitted?.kind !== "submit") throw new Error("the restored Picker did not submit");
		expect(submitted.results.map(answer => answer.selectedOptions)).toEqual([["Disk"], ["Picks", "Notes"]]);
	});

	test("a restored Picker says so until the first key", async () => {
		const first = openPicker();
		first.press(" ", ESC);
		const cancelled = await first.result;
		if (cancelled?.kind !== "cancel" || !cancelled.draft) throw new Error("Esc kept no draft");

		const again = openPicker(cancelled.draft);
		expect(again.render()).toContain("Restored your answers");
		again.press("j");
		expect(again.render()).not.toContain("Restored your answers");
	});

	test("Esc before any answer keeps the row you were on, without the restore note", async () => {
		const first = openPicker();
		first.press("j", ESC);
		const cancelled = await first.result;
		if (cancelled?.kind !== "cancel" || !cancelled.draft) throw new Error("Esc kept no draft");

		const again = openPicker(cancelled.draft);
		expect(again.render()).not.toContain("Restored your answers");
		again.press(ENTER, ENTER, ENTER);
		const submitted = await again.result;
		if (submitted?.kind !== "submit") throw new Error("the restored Picker did not submit");
		expect(submitted.results.map(answer => answer.selectedOptions)).toEqual([["Disk"], []]);
	});
});
