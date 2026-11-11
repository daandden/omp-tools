import { beforeAll, describe, expect, test } from "bun:test";
import { type ExtensionUIContext, Settings } from "@oh-my-pi/pi-coding-agent";
import type { Component, TUI } from "@oh-my-pi/pi-tui";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import type { PickerDraft } from "../extensions/ask-dialog";
import { type AskForm, readHtmlForm } from "../extensions/ask-form";
import type { PickerBtwRunner } from "../extensions/picker-btw";
import { openPicker, PickerDraftSlot } from "../extensions/picker-draft";

beforeAll(async () => {
	await Settings.init({ inMemory: true });
	await initTheme();
});

const ESC = "\x1b";
const ENTER = "\r";

function form(html: string): AskForm {
	const read = readHtmlForm(html);
	if (read.kind !== "form") throw new Error(`not a Picker form: ${read.kind}`);
	return read.form;
}

const STORE = `<form><p>Where should drafts live?</p>
	<label><input type="radio" name="store" value="memory"> Memory</label>
	<label><input type="radio" name="store" value="disk"> Disk</label></form>`;

function thread() {
	const runner: PickerBtwRunner & { disposed: boolean } = {
		disposed: false,
		ask: async () => "",
		dispose: async () => {
			runner.disposed = true;
		},
	};
	return runner;
}

const draft = () => ({ activeTab: 1 }) as unknown as PickerDraft;

describe("PickerDraftSlot", () => {
	test("hands the draft and its thread to a Picker with the same form, once", () => {
		const slot = new PickerDraftSlot();
		const kept = { draft: draft(), btw: thread() };
		slot.keep(form(STORE), kept);

		expect(slot.take(form(STORE))).toBe(kept);
		expect(kept.btw.disposed).toBe(false);
		expect(slot.take(form(STORE))).toBeUndefined();
	});

	test("a form that differs only in layout and whitespace still matches", () => {
		const slot = new PickerDraftSlot();
		const kept = { draft: draft(), btw: undefined };
		slot.keep(form(STORE), kept);

		expect(slot.take(form(`\n${STORE.replace(/\n\t/g, "\n\n    ").replace("<p>", "<div><p>").replace("</p>", "</p></div>")}`))).toBe(kept);
	});

	for (const [change, html] of [
		["an option added", STORE.replace("</form>", '<label><input type="radio" name="store" value="db"> Database</label></form>')],
		["a default checked", STORE.replace('value="disk"', 'value="disk" checked')],
		["the choice made required", STORE.replace('value="memory"', 'value="memory" required')],
		["radios turned into checkboxes", STORE.replaceAll('type="radio"', 'type="checkbox"')],
		["the context reworded", STORE.replace("Where should drafts live?", "Where should drafts go?")],
		["a hidden value changed", STORE.replace("<form>", '<form><input type="hidden" name="v" value="2">')],
	] as const) {
		test(`a form with ${change} opens empty and ends the thread`, () => {
			const slot = new PickerDraftSlot();
			const btw = thread();
			slot.keep(form(STORE), { draft: draft(), btw });

			expect(slot.take(form(html))).toBeUndefined();
			expect(btw.disposed).toBe(true);
			expect(slot.take(form(STORE))).toBeUndefined();
		});
	}

	test("drop settles only after the kept thread has ended, so its files are gone first", async () => {
		const slot = new PickerDraftSlot();
		const thread = threadWithDeferredDispose();
		slot.keep(form(STORE), { draft: draft(), btw: thread.btw });

		await expectDropToWaitFor(slot, thread.finish);
	});

	test("drop also waits for a thread that another form started ending", async () => {
		const slot = new PickerDraftSlot();
		const thread = threadWithDeferredDispose();
		slot.keep(form(STORE), { draft: draft(), btw: thread.btw });
		slot.take(form(STORE.replace('name="store"', 'name="place"').replace('name="store"', 'name="place"')));

		await expectDropToWaitFor(slot, thread.finish);
	});

	test("drop also waits for the thread of a Picker that closed without a draft", async () => {
		const slot = new PickerDraftSlot();
		const thread = threadWithDeferredDispose();
		slot.end(thread.btw);

		await expectDropToWaitFor(slot, thread.finish);
	});
});

describe("openPicker", () => {
	function host() {
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
		const threads: ReturnType<typeof thread>[] = [];
		const session = {
			cwd: process.cwd(),
			drafts: new PickerDraftSlot(),
			btw: () => {
				const started = thread();
				threads.push(started);
				return started;
			},
			autocomplete: () => undefined,
			fileCommands: async () => new Set<string>(),
		};
		const open = (html = STORE) => openPicker(ui, form(html), session, { timeout: undefined, signal: undefined, notify() {} });
		const press = async (...keys: string[]) => {
			await Bun.sleep(0);
			for (const key of keys) picker?.handleInput?.(key);
		};
		return { open, press, threads };
	}

	test("Esc keeps the Picker btw thread for the same form, and its submit ends it", async () => {
		const { open, press, threads } = host();
		const first = open();
		await press(ESC);
		expect(await first).toBeUndefined();

		const again = open();
		await press(ENTER);
		expect((await again)?.answer.data).toEqual({ store: "memory" });
		expect(threads).toHaveLength(1);
		await Bun.sleep(0);
		expect(threads[0]?.disposed).toBe(true);
	});

	test("another form ends the kept thread and starts its own", async () => {
		const { open, press, threads } = host();
		const first = open();
		await press(ESC);
		await first;

		const other = open(STORE.replace("Disk", "Cloud"));
		await press(ENTER);
		await other;
		expect(threads).toHaveLength(2);
		expect(threads.every(started => started.disposed)).toBe(true);
	});
});

function threadWithDeferredDispose() {
	let finish: () => void = () => {};
	const btw: PickerBtwRunner = { ask: async () => "", dispose: () => new Promise<void>(resolve => (finish = resolve)) };
	return { btw, finish: () => finish() };
}

async function expectDropToWaitFor(slot: PickerDraftSlot, finish: () => void) {
	let dropped = false;
	const dropping = slot.drop().then(() => {
		dropped = true;
	});
	await Bun.sleep(0);
	expect(dropped).toBe(false);
	finish();
	await dropping;
	expect(dropped).toBe(true);
}
