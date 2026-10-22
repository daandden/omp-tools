import { describe, expect, test } from "bun:test";
import type { ExtensionAskDialogQuestion } from "@oh-my-pi/pi-coding-agent";
import type { PickerDraft } from "../extensions/ask-dialog";
import type { PickerBtwRunner } from "../extensions/picker-btw";
import { PickerDraftSlot } from "../extensions/picker-draft";

const question = (overrides: Partial<ExtensionAskDialogQuestion> = {}): ExtensionAskDialogQuestion => ({
	id: "store",
	question: "Where should drafts live?",
	options: [{ label: "Memory" }, { label: "Disk" }],
	...overrides,
});

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
	test("hands the draft and its thread to a Picker with the same questions, once", () => {
		const slot = new PickerDraftSlot();
		const kept = { draft: draft(), btw: thread() };
		slot.keep([question({ multi: true })], kept);

		expect(slot.take([question({ multi: true, header: "Store" })])).toBe(kept);
		expect(kept.btw.disposed).toBe(false);
		expect(slot.take([question({ multi: true })])).toBeUndefined();
	});

	test("a question that turns from multi-select to single-select opens empty and ends the thread", () => {
		const slot = new PickerDraftSlot();
		const btw = thread();
		slot.keep([question({ multi: true })], { draft: draft(), btw });

		expect(slot.take([question({ multi: false })])).toBeUndefined();
		expect(btw.disposed).toBe(true);
		expect(slot.take([question({ multi: true })])).toBeUndefined();
	});

	test("other questions drop the draft and end its thread", () => {
		const slot = new PickerDraftSlot();
		const btw = thread();
		slot.keep([question()], { draft: draft(), btw });

		expect(slot.take([question({ options: [{ label: "Memory" }, { label: "Database" }] })])).toBeUndefined();
		expect(btw.disposed).toBe(true);
	});

	test("an unset multi matches multi: false", () => {
		const slot = new PickerDraftSlot();
		const kept = { draft: draft(), btw: undefined };
		slot.keep([question()], kept);

		expect(slot.take([question({ multi: false })])).toBe(kept);
	});

	test("drop settles only after the kept thread has ended, so its files are gone first", async () => {
		const slot = new PickerDraftSlot();
		const thread = threadWithDeferredDispose();
		slot.keep([question()], { draft: draft(), btw: thread.btw });

		await expectDropToWaitFor(slot, thread.finish);
	});

	test("drop also waits for a thread that other questions started ending", async () => {
		const slot = new PickerDraftSlot();
		const thread = threadWithDeferredDispose();
		slot.keep([question()], { draft: draft(), btw: thread.btw });
		slot.take([question({ id: "color" })]);

		await expectDropToWaitFor(slot, thread.finish);
	});

	test("drop also waits for the thread of a Picker that closed without a draft", async () => {
		const slot = new PickerDraftSlot();
		const thread = threadWithDeferredDispose();
		slot.end(thread.btw);

		await expectDropToWaitFor(slot, thread.finish);
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
