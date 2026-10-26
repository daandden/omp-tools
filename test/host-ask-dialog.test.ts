import { beforeAll, describe, expect, test } from "bun:test";
import {
	type ExtensionAskDialogQuestion,
	type ExtensionAskDialogResult,
	type ExtensionUIContext,
	type ExtensionUIDialogOptions,
	Settings,
} from "@oh-my-pi/pi-coding-agent";
import type { Component, TUI } from "@oh-my-pi/pi-tui";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import { askInPicker, routeHostAskDialog } from "../extensions/host-ask-dialog";
import { PickerDraftSlot } from "../extensions/picker-draft";

beforeAll(async () => {
	await Settings.init({ inMemory: true });
	await initTheme();
});

const ESC = "\x1b";
const ENTER = "\r";

const approval: ExtensionAskDialogQuestion[] = [
	{
		id: "inputs",
		header: "ratchet · inputs",
		question: "Q3. Approve the inputs? See the Grilling page.",
		options: [
			{ label: "Approve", description: "Record this approval and continue" },
			{ label: "Revise", description: "Say what to change; nothing is recorded" },
			{ label: "Abort", description: "Stop the ratchet run" },
		],
	},
];

function routedHost() {
	let picker: Component | undefined;
	const tui = {
		terminal: { rows: 40, columns: 100, write() {} },
		getShowHardwareCursor: () => false,
		requestRender() {},
		setFocus() {},
	} as unknown as TUI;
	const nativeCalls: ExtensionAskDialogQuestion[][] = [];
	let pickers = 0;
	const ui = {
		askDialog: async (questions: ExtensionAskDialogQuestion[]) => {
			nativeCalls.push(questions);
			return undefined;
		},
		// Like the host's `custom`: an aborted signal rejects with its reason.
		custom: (
			factory: (tui: TUI, theme: unknown, keybindings: unknown, done: (value: unknown) => void) => Component,
			options?: { signal?: AbortSignal },
		) =>
			new Promise((resolve, reject) => {
				pickers++;
				options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
				picker = factory(tui, undefined, undefined, resolve);
			}),
		notify() {},
	} as unknown as ExtensionUIContext;
	const drafts = new PickerDraftSlot();
	const route = (through: ExtensionUIContext = ui) =>
		routeHostAskDialog(through, (questions, options, host) =>
			askInPicker(questions, options, host, {
				cwd: process.cwd(),
				drafts,
				btw: () => undefined,
				autocomplete: () => undefined,
				fileCommands: async () => new Set(),
			}),
		);
	const unroute = route();
	const ask = (questions = approval, options?: ExtensionUIDialogOptions) => ui.askDialog!(questions, options);
	const press = async (...keys: string[]) => {
		await Bun.sleep(0);
		for (const key of keys) picker?.handleInput?.(key);
	};
	return {
		ui,
		ask,
		press,
		route,
		unroute,
		nativeCalls,
		pickers: () => pickers,
		render: () => picker?.render(100).join("\n") ?? "",
	};
}

describe("host askDialog in the picker", () => {
	test("picking Approve answers with Approve in the host's result shape", async () => {
		const host = routedHost();
		const answer = host.ask();
		await host.press(ENTER);
		expect(await answer).toEqual({
			kind: "submit",
			results: [
				{
					id: "inputs",
					question: approval[0]!.question,
					options: ["Approve", "Revise", "Abort"],
					multi: false,
					selectedOptions: ["Approve"],
				},
			],
		});
		expect(host.nativeCalls).toEqual([]);
	});

	test("a note on Revise goes back as the question's note, with the Revise pick", async () => {
		const host = routedHost();
		const answer = host.ask();
		await host.press("j", "n", ..."Split the rubric", ENTER, ENTER);
		const result = await answer;
		if (result?.kind !== "submit") throw new Error("the picker did not submit");
		expect(result.results[0]).toMatchObject({
			selectedOptions: ["Revise"],
			note: "Revise: Split the rubric",
		});
	});

	test("Esc dismisses with no answer, and the same question reopens with the pick but waits for Enter", async () => {
		const host = routedHost();
		const first = host.ask();
		await host.press(" ", ESC);
		expect(await first).toBeUndefined();

		const again = host.ask();
		await host.press();
		expect(host.render()).toContain("Restored your answers");
		expect(await Promise.race([again, Bun.sleep(20).then(() => "waiting")])).toBe("waiting");
		await host.press(ENTER);
		const result = await again;
		if (result?.kind !== "submit") throw new Error("the restored picker did not submit");
		expect(result.results[0]?.selectedOptions).toEqual(["Approve"]);
	});

	test("an aborted signal closes the picker with no answer, as the native dialog does", async () => {
		const host = routedHost();
		const controller = new AbortController();
		const answer = host.ask(approval, { signal: controller.signal });
		await host.press();
		controller.abort();
		expect(await answer).toBeUndefined();
	});

	test("questions the native dialog must judge (a reserved label) go to the host's own dialog", async () => {
		const host = routedHost();
		const reserved: ExtensionAskDialogQuestion[] = [
			{ id: "pick", question: "Pick one", options: [{ label: "Chat about this" }, { label: "Keep" }] },
		];
		expect(await host.ask(reserved)).toBeUndefined();
		expect(host.nativeCalls).toEqual([reserved]);
		expect(host.pickers()).toBe(0);
	});

	test("a malformed question goes to the host's own dialog, which coerces it", async () => {
		const host = routedHost();
		const malformed = [{ id: "pick", question: "Pick one" }] as unknown as ExtensionAskDialogQuestion[];
		expect(await host.ask(malformed)).toBeUndefined();
		expect(host.nativeCalls).toEqual([malformed]);
	});

	test("the answer echoes the caller's ids and labels as given, carriage returns included", async () => {
		const host = routedHost();
		const answer = host.ask([{ id: "step\r1", question: "Go?", options: [{ label: "Ship\rit" }, { label: "Wait" }] }]);
		await host.press(ENTER);
		const result = await answer;
		if (result?.kind !== "submit") throw new Error("the picker did not submit");
		expect(result.results[0]).toMatchObject({ id: "step\r1", options: ["Ship\rit", "Wait"], selectedOptions: ["Ship\rit"] });
	});

	test("routes in any order never stack: one picker per ask, and the host's dialog once every route ended", async () => {
		const host = routedHost();
		const proxied = new Proxy(host.ui, {
			get(target, property) {
				const value: unknown = Reflect.get(target, property, target);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		const unrouteSecond = host.route(proxied);
		host.unroute();

		const answer = host.ask();
		await host.press(ENTER);
		expect(await answer).toMatchObject({ kind: "submit" });
		expect(host.pickers()).toBe(1);

		unrouteSecond();
		expect(await host.ask()).toBeUndefined();
		expect(host.nativeCalls).toEqual([approval]);
		expect(host.pickers()).toBe(1);
	});
});
