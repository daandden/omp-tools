import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { type } from "@oh-my-pi/omptype";
import {
	type AgentToolResult,
	type ExtensionAPI,
	type ExtensionContext,
	Settings,
	settings,
	type ToolDefinition,
} from "@oh-my-pi/pi-coding-agent";
import { cfgAskNotify, cfgAskTimeout } from "@oh-my-pi/pi-coding-agent/modes/settings";
import type { Component, NativeNode, TUI } from "@oh-my-pi/pi-tui";
import { initTheme, theme } from "@oh-my-pi/pi-tui/theme";
import flexibleAsk from "../extensions/flexible-ask";
import { textOf } from "./support";

beforeAll(async () => {
	await Settings.init({ inMemory: true });
	await initTheme();
	settings.writeValue(cfgAskNotify, "off", "override");
});

afterEach(() => {
	settings.clearOverrideValue(cfgAskTimeout);
});

const ESC = "\x1b";
const ENTER = "\r";

const IMAGE = { type: "image" as const, mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==" };

interface Details {
	answers: { name: string; question: string; answer: string }[];
	notes?: { name: string; question: string; option: string; value: string; text: string }[];
	unpickedNotes?: { name: string; question: string; option: string; value: string; text: string }[];
	other?: { name: string; question: string; text: string }[];
	submitNote?: string;
	timedOut?: boolean;
}

type AskResult = AgentToolResult<Details>;

/** Loads the plugin's `ask` as OMP does: its registered definition and event handlers. */
function loadAsk() {
	let registered: ToolDefinition | undefined;
	const handlers = new Map<string, ((event: unknown, ctx: unknown) => unknown)[]>();
	const pi = {
		arktype: type,
		registerTool: (definition: ToolDefinition) => {
			registered = definition;
		},
		on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
	};
	flexibleAsk(pi as unknown as ExtensionAPI);
	if (!registered) throw new Error("ask was not registered");
	const tool = registered;
	return {
		tool,
		emit: async (event: string) => {
			for (const handler of handlers.get(event) ?? []) await handler({ type: event }, {});
		},
	};
}

/** A TUI session: the Picker the host shows through `ui.custom`, keys sent to it, and native ask behind `invokeTool`. */
function tuiSession(mode: "tui" | "rpc" = "tui") {
	let picker: (Component & { attachImage?(image: unknown): unknown }) | undefined;
	let focused: (Component & { attachImage?(image: unknown): unknown; pasteText?(text: string): void }) | undefined;
	let pickers = 0;
	const tui = {
		terminal: { rows: 40, columns: 100, write() {} },
		getShowHardwareCursor: () => false,
		requestRender() {},
		setFocus(component: Component) {
			focused = component;
		},
	} as unknown as TUI;
	const nativeCalls: unknown[] = [];
	let aborts = 0;
	const ui = {
		custom: (
			factory: (tui: TUI, theme: unknown, keybindings: unknown, done: (value: unknown) => void) => Component,
			options?: { signal?: AbortSignal },
		) =>
			new Promise((resolve, reject) => {
				pickers++;
				options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
				picker = factory(tui, undefined, undefined, resolve);
				focused = picker;
			}),
		notify() {},
	};
	const ctx = {
		mode,
		hasUI: mode === "tui",
		ui,
		cwd: process.cwd(),
		agent: { kind: "subagent" },
		sessionManager: { getSessionFile: () => undefined },
		abort: () => {
			aborts++;
		},
		invokeTool: async (params: unknown) => {
			nativeCalls.push(params);
			return { content: [{ type: "text", text: "native ask" }], details: { answers: [] } };
		},
	} as unknown as ExtensionContext;
	const shown = async () => {
		for (let tries = 0; !picker && tries < 500; tries++) await Bun.sleep(1);
		if (!picker) throw new Error("no Picker opened");
		return picker;
	};
	return {
		ctx,
		nativeCalls,
		aborts: () => aborts,
		pickers: () => pickers,
		/** Sends keys to the Picker, which routes them to its open editor. */
		press: async (...keys: string[]) => {
			const target = await shown();
			for (const key of keys) target.handleInput?.(key);
		},
		type: async (text: string) => {
			const target = await shown();
			for (const char of text) target.handleInput?.(char);
		},
		/** Pastes an image the way the host does: into the focused component's paste contract. */
		pasteImage: async () => {
			await shown();
			const marker = focused?.attachImage?.(IMAGE);
			if (typeof marker === "string") focused?.pasteText?.(marker);
			return marker;
		},
		picker: shown,
		/** Pastes text the way the host does: into the focused component's paste contract. */
		pasteText: async (text: string) => {
			await shown();
			focused?.pasteText?.(text);
		},
		render: async () => (await shown()).render(100).join("\n"),
		reset: () => {
			picker = undefined;
			focused = undefined;
		},
	};
}

function run(tool: ToolDefinition, html: string, session: ReturnType<typeof tuiSession>): Promise<AskResult> {
	session.reset();
	return tool.execute("call-1", { html }, undefined, undefined, session.ctx) as Promise<AskResult>;
}

/** The submitted form data: the JSON block of the result text. */
function formData(result: AskResult): unknown {
	const text = textOf(result);
	return JSON.parse(text.slice(text.indexOf("{"), text.indexOf("\n}") + 2));
}

/** The result text after the form data: the Picker's extra channels. */
function extras(result: AskResult): string {
	const text = textOf(result);
	return text.slice(text.indexOf("\n}") + 2);
}

const STORE = `<form>
  <p>Which store?</p>
  <label><input type="radio" name="store" value="sqlite" checked> SQLite</label>
  <label><input type="radio" name="store" value="pg"> Postgres</label>
</form>`;

const TWO = `<form>
  <p>Which store?</p>
  <label><input type="radio" name="store" value="sqlite"> SQLite</label>
  <label><input type="radio" name="store" value="pg"> Postgres</label>
  <p>Keep what?</p>
  <label><input type="checkbox" name="keep" value="picks"> Picks</label>
  <label><input type="checkbox" name="keep" value="notes"> Notes</label>
</form>`;

describe("ask schema", () => {
	test("takes native HTML only; the old questions[] input is refused", () => {
		const { tool } = loadAsk();
		const parse = tool.parameters as unknown as (input: unknown) => unknown;
		const questions = [{ id: "store", question: "Where?", options: [{ label: "Memory" }, { label: "Disk" }] }];
		expect(parse({ questions })).toBeInstanceOf(type.errors);
		expect(parse({ html: STORE, questions })).toBeInstanceOf(type.errors);
		expect(parse({ html: STORE })).toEqual({ html: STORE });
	});
});

describe("ask in the Picker", () => {
	test("radio, checkbox group, select, multiple select, hidden and lone checkbox values come back as native form data", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const result = run(
			tool,
			`<form>
				<input type="hidden" name="ticket" value="49">
				<p>Which store?</p>
				<label><input type="radio" name="store" value="sqlite" checked> SQLite</label>
				<label><input type="radio" name="store" value="pg"> Postgres</label>
				<p>Keep what?</p>
				<label><input type="checkbox" name="keep" value="picks" checked> Picks</label>
				<label><input type="checkbox" name="keep" value="notes"> Notes</label>
				<label>Region <select name="region"><option value="eu">EU</option><option value="us" selected>US</option></select></label>
				<label>Languages <select name="langs" multiple><option value="ts">TS</option><option value="go">Go</option></select></label>
				<label><input type="checkbox" name="agree"> I agree</label>
			</form>`,
			session,
		);
		await session.press("j", ENTER); // store: Postgres
		await session.press("j", " ", ENTER); // keep: Picks (checked) and Notes
		await session.press(ENTER); // region: US, preselected
		await session.press(" ", "j", " ", ENTER); // langs: TS and Go
		await session.press(" ", ENTER); // agree: the lone checkbox
		await session.press(ENTER); // Submit
		const answered = await result;
		expect(formData(answered)).toEqual({
			ticket: "49",
			store: "pg",
			keep: ["picks", "notes"],
			region: "us",
			langs: ["ts", "go"],
			agree: "on",
		});
		expect(answered.details?.timedOut).toBeUndefined();
	});

	test("a form submitted as it opened sends its defaults: checked radios, checked boxes, the selected option", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const result = run(
			tool,
			`<form>
				<label><input type="radio" name="store" value="sqlite"> SQLite</label>
				<label><input type="radio" name="store" value="pg" checked> Postgres</label>
				<label><input type="checkbox" name="keep" value="picks" checked> Picks</label>
				<label><input type="checkbox" name="keep" value="notes"> Notes</label>
				<label><input type="checkbox" name="agree"> I agree</label>
			</form>`,
			session,
		);
		await session.press("h", ENTER); // Submit tab, Submit
		expect(formData(await result)).toEqual({ store: "pg", keep: ["picks"] });
	});

	test("an Other answer equal to an option's value keeps its Other provenance", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const result = run(tool, STORE, session);
		await session.press("j", "j", ENTER);
		await session.type("pg");
		await session.press(ENTER); // save the Other answer, which picks it
		await session.press(ENTER); // submit
		const answered = await result;
		expect(formData(answered)).toEqual({ store: "pg" });
		expect(answered.details?.other).toEqual([{ name: "store", question: "Which store?", text: "pg" }]);
		expect(answered.details?.answers[0]?.answer).not.toBe("Postgres");
		expect(extras(answered)).toContain("pg");
	});

	test("a Note on an option the user did not pick is sent, marked unpicked", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const result = run(tool, STORE, session);
		await session.press("n");
		await session.type("too slow for us");
		await session.press(ENTER); // save the Note on SQLite
		await session.press("j", ENTER); // pick Postgres and submit
		const answered = await result;
		expect(formData(answered)).toEqual({ store: "pg" });
		expect(answered.details?.notes).toBeUndefined();
		expect(answered.details?.unpickedNotes).toEqual([
			{ name: "store", question: "Which store?", option: "SQLite", value: "sqlite", text: "too slow for us" },
		]);
		expect(extras(answered)).toContain("too slow for us");
	});

	test("the Submit note goes back once, for the whole form", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const result = run(tool, TWO, session);
		await session.press("h", "n");
		await session.type("ship it friday");
		await session.press(ENTER, ENTER);
		const answered = await result;
		expect(answered.details?.submitNote).toBe("ship it friday");
		expect(extras(answered).split("ship it friday").length).toBe(2);
	});

	test("an image pasted into a Note arrives as labeled image content, and only there", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const result = run(tool, STORE, session);
		await session.press("n");
		await session.type("like this ");
		expect(await session.pasteImage()).toBe("[Image #1]");
		await session.press(ENTER, ENTER);
		const answered = await result;
		const images = answered.content.filter(block => block.type === "image");
		expect(images).toEqual([IMAGE]);
		const label = answered.content[answered.content.indexOf(IMAGE) - 1];
		expect(label).toEqual({ type: "text", text: "[Image #1]" });
		expect(JSON.stringify(answered.details)).not.toContain(IMAGE.data);
		expect(answered.details?.notes?.[0]?.text).toContain("[Image #1]");
	});

	test("Submit refuses an unanswered required choice and opens it; the answer then submits", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const result = run(
			tool,
			`<form>
				<p>Which store?</p>
				<label><input type="radio" name="store" value="sqlite" required> SQLite</label>
				<label><input type="radio" name="store" value="pg"> Postgres</label>
				<label><input type="checkbox" name="agree"> I agree</label>
			</form>`,
			session,
		);
		await session.press("h", ENTER); // Submit with store unanswered
		expect(await Promise.race([result, Bun.sleep(20).then(() => "waiting")])).toBe("waiting");
		await session.press("j", ENTER, ENTER, ENTER); // on store: Postgres, past agree, Submit
		expect(formData(await result)).toEqual({ store: "pg" });
	});

	test("at the timeout the current values go back marked automatic, even with a required choice empty", async () => {
		settings.writeValue(cfgAskTimeout, 1, "override");
		const { tool } = loadAsk();
		const session = tuiSession();
		const answered = await run(
			tool,
			`<form>
				<p>Which store?</p>
				<label><input type="radio" name="store" value="sqlite" required> SQLite</label>
				<label><input type="radio" name="store" value="pg"> Postgres</label>
				<label><input type="checkbox" name="keep" value="picks" checked> Picks</label>
				<label><input type="checkbox" name="keep" value="notes"> Notes</label>
			</form>`,
			session,
		);
		expect(formData(answered)).toEqual({ keep: ["picks"] });
		expect(answered.details?.timedOut).toBe(true);
	});

	test("Esc cancels the call and submits nothing", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const result = run(tool, STORE, session);
		await session.press("j", " ", ESC);
		await expect(result).rejects.toThrow();
		expect(session.aborts()).toBe(1);
		expect(session.nativeCalls).toEqual([]);
	});

	test("the option list refuses a pasted image", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const result = run(tool, STORE, session);
		expect(await session.pasteImage()).toBeUndefined();
		await session.press(ENTER);
		expect((await result).content.some(block => block.type === "image")).toBe(false);
	});

	test("a disabled option cannot be picked and never reaches the data", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const result = run(
			tool,
			`<form><p>Which store?</p>
				<label><input type="radio" name="store" value="sqlite" disabled> SQLite</label>
				<label><input type="radio" name="store" value="pg"> Postgres</label>
			</form>`,
			session,
		);
		await session.press(" ", ENTER); // neither picks SQLite
		expect(await Promise.race([result, Bun.sleep(20).then(() => "waiting")])).toBe("waiting");
		await session.press("j", ENTER);
		expect(formData(await result)).toEqual({ store: "pg" });
	});

	test("scripts, styles, buttons, form actions and file inputs are dropped, not offered", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const result = run(
			tool,
			`<form action="https://example.invalid/steal" method="post">
				<script>globalThis.pwned = true</script><style>p { color: red }</style>
				<p>Which store?</p>
				<label><input type="radio" name="store" value="sqlite"> SQLite</label>
				<label><input type="radio" name="store" value="pg"> Postgres</label>
				<input type="file" name="upload"><button type="submit">Go</button>
			</form>`,
			session,
		);
		const shown = await session.render();
		expect(shown).not.toContain("pwned");
		expect(shown).not.toContain("color: red");
		expect(shown).not.toContain("Go");
		await session.press(ENTER);
		expect(formData(await result)).toEqual({ store: "sqlite" });
		expect((globalThis as { pwned?: boolean }).pwned).toBeUndefined();
	});

	test("a form with a text, number or textarea field opens in the Picker, never in native ask", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const result = run(tool, STORE.replace("</form>", `<label>Days <input type="number" name="ttl_days" value="30"></label></form>`), session);
		await session.press("h", ENTER);
		expect(formData(await result)).toEqual({ store: "sqlite", ttl_days: 30 });
		expect(session.pickers()).toBe(1);
		expect(session.nativeCalls).toEqual([]);
	});
});

/** Whether `result` is still open after the Picker had time to act on the last key. */
async function stillOpen(result: Promise<unknown>): Promise<boolean> {
	return (await Promise.race([result.then(() => "settled"), Bun.sleep(20).then(() => "open")])) === "open";
}

const MIXED = `<form>
  <p>Which store?</p>
  <label><input type="radio" name="store" value="sqlite"> SQLite</label>
  <label><input type="radio" name="store" value="pg"> Postgres</label>
  <label>Title <input type="text" name="title" placeholder="One line"></label>
  <label>Days <input type="number" name="days" min="1" max="90"></label>
  <label>Why <textarea name="why"></textarea></label>
</form>`;

describe("text fields in the Picker", () => {
	test("text, number and textarea answers come back as native form data beside the choices; a number as a number", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const result = run(tool, MIXED, session);
		await session.press("j", ENTER); // store: Postgres
		await session.press(ENTER); // the empty title opens its editor
		await session.type("Ship drafts");
		await session.press(ENTER, ENTER); // save, next
		await session.press(ENTER);
		await session.type("14");
		await session.press(ENTER, ENTER);
		await session.press(ENTER);
		await session.type("Users lose answers");
		await session.press(ENTER, ENTER); // save, Submit tab
		await session.press(ENTER);
		const answered = await result;
		expect(formData(answered)).toEqual({ store: "pg", title: "Ship drafts", days: 14, why: "Users lose answers" });
		expect(answered.details?.answers.map(answer => answer.answer)).toEqual(["Postgres", "Ship drafts", "14", "Users lose answers"]);
		expect(answered.details?.timedOut).toBeUndefined();
	});

	test("prefilled values submit as they opened, and an untouched empty field gives empty text", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const result = run(
			tool,
			`<form>
				<label>Title <input name="title" value="Draft fix"></label>
				<label>Days <input type="number" name="days" value="30"></label>
				<label>Why <textarea name="why">
First line
second line</textarea></label>
				<label>Owner <input type="email" name="owner"></label>
			</form>`,
			session,
		);
		await session.press("h", ENTER); // Submit tab, Submit
		expect(formData(await result)).toEqual({ title: "Draft fix", days: 30, why: "First line\nsecond line", owner: "" });
	});

	test("a form of one optional text field can be submitted empty", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const result = run(tool, `<form><label>Anything else? <input name="extra"></label></form>`, session);
		await session.press("l", ENTER);
		expect(formData(await result)).toEqual({ extra: "" });
	});

	for (const [rule, control, fixed, value] of [
		["required text", `<input name="v" required>`, "set", "set"],
		["required textarea", `<textarea name="v" required></textarea>`, "set", "set"],
		["a number below min", `<input type="number" name="v" min="1" max="10" value="0">`, "5", 5],
		["a number above max", `<input type="number" name="v" min="1" max="10" value="11">`, "10", 10],
		["a number field holding no number", `<input type="number" name="v" value="many">`, "7", 7],
		["minlength", `<input name="v" minlength="3" value="ab">`, "abc", "abc"],
		["maxlength", `<input name="v" maxlength="3" value="abcd">`, "abc", "abc"],
		["an email field", `<input type="email" name="v" value="nobody">`, "a@b.co", "a@b.co"],
		["a url field", `<input type="url" name="v" value="example.com">`, "https://example.com", "https://example.com"],
		["a pattern", `<input name="v" pattern="[a-z]+" value="ABC">`, "abc", "abc"],
	] as const) {
		test(`Submit refuses ${rule} and opens the field; the corrected value then submits`, async () => {
			const { tool } = loadAsk();
			const session = tuiSession();
			const result = run(tool, `<form><label>Value ${control}</label></form>`, session);
			await session.press("l", ENTER); // Submit tab, Submit
			expect(await stillOpen(result)).toBe(true);
			await session.press("x", "n"); // on the refused field: clear it, type anew
			await session.type(fixed);
			await session.press(ENTER, "l", ENTER);
			expect(formData(await result)).toEqual({ v: value });
		});
	}

	for (const [constraint, control, value] of [
		["a non-numeric min", `<input type="number" name="v" min="lots" value="-5">`, -5],
		["an invalid pattern", `<input name="v" pattern="(" value="anything">`, "anything"],
		["a step", `<input type="number" name="v" step="5" value="3">`, 3],
		["a date type, which has no date widget or check", `<input type="date" name="v" value="next week">`, "next week"],
	] as const) {
		test(`${constraint} is ignored, as native ignores it`, async () => {
			const { tool } = loadAsk();
			const session = tuiSession();
			const result = run(tool, `<form><label>Value ${control}</label></form>`, session);
			await session.press("l", ENTER);
			expect(formData(await result)).toEqual({ v: value });
		});
	}

	test("Submit opens the first invalid field, then the next one", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const result = run(
			tool,
			`<form>
				<p>Which store?</p>
				<label><input type="radio" name="store" value="sqlite" checked> SQLite</label>
				<label><input type="radio" name="store" value="pg"> Postgres</label>
				<label>Owner <input type="email" name="owner" value="nobody"></label>
				<label>Days <input type="number" name="days" max="10" value="30"></label>
			</form>`,
			session,
		);
		await session.press("h", ENTER); // Submit: refused at Owner
		await session.press("x", "n");
		await session.type("a@b.co");
		await session.press(ENTER, "l", "l", ENTER); // Submit again: refused at Days
		expect(await stillOpen(result)).toBe(true);
		await session.press("x", "n");
		await session.type("9");
		await session.press(ENTER, "l", ENTER);
		expect(formData(await result)).toEqual({ store: "sqlite", owner: "a@b.co", days: 9 });
	});

	test("at the timeout an empty required field and an out-of-range number go back as they stand, marked automatic", async () => {
		settings.writeValue(cfgAskTimeout, 1, "override");
		const { tool } = loadAsk();
		const session = tuiSession();
		const answered = await run(
			tool,
			`<form>
				<label>Name <input name="name" required></label>
				<label>Days <input type="number" name="days" min="1" max="10" value="99"></label>
			</form>`,
			session,
		);
		expect(formData(answered)).toEqual({ name: "", days: 99 });
		expect(answered.details?.timedOut).toBe(true);
	});

	test("typed text survives picks, unpicks, the Submit tab, other fields, and Esc then F5", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const first = run(tool, MIXED, session);
		await session.press("l", ENTER); // title
		await session.type("Kept title");
		await session.press(ENTER, "h"); // save, back to store
		await session.press(" ", " ", "j", " "); // pick SQLite, unpick it, pick Postgres
		await session.press("l", "l", "l", "l", "h", "h", "h"); // through Submit and back to title
		await session.press(ESC);
		await expect(first).rejects.toThrow();

		const again = run(tool, MIXED, session);
		expect(await session.render()).toContain("Restored your answers");
		expect(await stillOpen(again)).toBe(true);
		await session.press("l", "l", "l", ENTER); // title → Submit tab, Submit
		expect(formData(await again)).toEqual({ store: "pg", title: "Kept title", days: "", why: "" });
	});

	test("a form whose text field changed does not get the old draft", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const first = run(tool, MIXED, session);
		await session.press("l", ENTER);
		await session.type("Old title");
		await session.press(ENTER, ESC);
		await expect(first).rejects.toThrow();

		const changed = run(tool, MIXED.replace('placeholder="One line"', 'placeholder="A short line"'), session);
		expect(await session.render()).not.toContain("Restored your answers");
		await session.press("h", ENTER);
		expect(formData(await changed)).toEqual({ title: "", days: "", why: "" });
	});

	test("an image pasted into a text field arrives as labeled image content", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const result = run(tool, `<form><label>Bug <textarea name="bug"></textarea></label></form>`, session);
		await session.press(ENTER);
		await session.type("looks like ");
		expect(await session.pasteImage()).toBe("[Image #1]");
		await session.press(ENTER, "l", ENTER);
		const answered = await result;
		expect(formData(answered)).toEqual({ bug: "looks like [Image #1]" });
		expect(answered.content.filter(block => block.type === "image")).toEqual([IMAGE]);
		expect(answered.content[answered.content.indexOf(IMAGE) - 1]).toEqual({ type: "text", text: "[Image #1]" });
	});

	test("pasted line breaks stay in a textarea and leave a one-line field", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const result = run(tool, `<form><label>Title <input name="title"></label><label>Body <textarea name="body"></textarea></label></form>`, session);
		await session.press(ENTER);
		await session.pasteText("two\nlines");
		await session.press(ENTER, ENTER, ENTER);
		await session.pasteText("two\nlines");
		await session.press(ENTER, ENTER, ENTER);
		expect(formData(await result)).toEqual({ title: "twolines", body: "two\nlines" });
	});

	test("a password is masked on screen and still reaches the model", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const result = run(tool, `<form><label>Token <input type="password" name="token"></label></form>`, session);
		await session.press(ENTER);
		await session.type("hunter2");
		await session.press(ENTER);
		const picker = (await session.picker()) as Component & { describe(cx: unknown): NativeNode };
		const cx = { cols: 100, feature: () => false, supports: () => false };
		expect(await session.render()).not.toContain("hunter2");
		expect(viewText(picker.describe(cx))).not.toContain("hunter2");
		await session.press("l");
		expect(await session.render()).not.toContain("hunter2");
		expect(viewText(picker.describe(cx))).not.toContain("hunter2");
		await session.press(ENTER);
		expect(formData(await result)).toEqual({ token: "hunter2" });
	});
});

describe("ask outside the Picker", () => {
	test("outside the TUI the HTML goes to native ask unchanged, and native's result comes back", async () => {
		const { tool } = loadAsk();
		const session = tuiSession("rpc");
		const result = await run(tool, STORE, session);
		expect(session.nativeCalls).toEqual([{ html: STORE }]);
		expect(textOf(result)).toBe("native ask");
		expect(session.pickers()).toBe(0);
	});

	test("a form with no named control goes to native ask, which answers it with its own error", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const html = `<form><label><input type="radio" value="a"> A</label></form>`;
		await run(tool, html, session);
		expect(session.nativeCalls).toEqual([{ html }]);
		expect(session.pickers()).toBe(0);
	});
});

describe("Picker draft", () => {
	test("F5 on the same form opens it with the earlier picks, Notes and images, and waits for Enter", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const first = run(tool, TWO, session);
		await session.press("j", ENTER); // store: Postgres
		await session.press("n");
		await session.type("see ");
		await session.pasteImage();
		await session.press(ENTER, ESC); // Note with an image on Picks, then Esc
		await expect(first).rejects.toThrow();

		// Retried with the same form, laid out differently.
		const again = run(tool, TWO.replace(/\n\s*/g, " "), session);
		expect(await session.render()).toContain("Restored your answers");
		expect(await Promise.race([again, Bun.sleep(20).then(() => "waiting")])).toBe("waiting");
		await session.press("l", ENTER);
		const answered = await again;
		expect(formData(answered)).toEqual({ store: "pg", keep: [] });
		expect(answered.details?.unpickedNotes?.[0]).toMatchObject({ option: "Picks", text: "see [Image #1]" });
		expect(answered.content.filter(block => block.type === "image")).toEqual([IMAGE]);
	});

	test("Esc before any answer keeps the row you were on, without the restore note", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const first = run(tool, TWO, session);
		await session.press("j", ESC);
		await expect(first).rejects.toThrow();

		const again = run(tool, TWO, session);
		expect(await session.render()).not.toContain("Restored your answers");
		await session.press(ENTER, ENTER, ENTER);
		expect(formData(await again)).toEqual({ store: "pg", keep: [] });
	});

	test("a changed form opens empty", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const first = run(tool, STORE, session);
		await session.press("j", " ", ESC);
		await expect(first).rejects.toThrow();

		const changed = run(tool, STORE.replace("</form>", '<label><input type="radio" name="store" value="mem"> Memory</label></form>'), session);
		expect(await session.render()).not.toContain("Restored your answers");
		await session.press(ENTER);
		expect(formData(await changed)).toEqual({ store: "sqlite" });
	});

	test("a /tree move drops the draft", async () => {
		const { tool, emit } = loadAsk();
		const session = tuiSession();
		const first = run(tool, STORE, session);
		await session.press("j", " ", ESC);
		await expect(first).rejects.toThrow();
		await emit("session_tree");

		const again = run(tool, STORE, session);
		expect(await session.render()).not.toContain("Restored your answers");
		await session.press(ENTER);
		expect(formData(await again)).toEqual({ store: "sqlite" });
	});
});

/** Every text run of a Tern view, in order. */
function viewText(view: unknown): string {
	const out: string[] = [];
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) value.forEach(visit);
		else if (value && typeof value === "object") {
			const record = value as Record<string, unknown>;
			if (typeof record.t === "string") out.push(record.t);
			for (const [key, child] of Object.entries(record)) if (key !== "t") visit(child);
		}
	};
	visit(view);
	return out.join("\n");
}

function count(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

describe("ask card", () => {
	test("both renderers show the answer, every Note, the Other answer and the Submit note once", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const result = run(tool, TWO, session);
		await session.press("n");
		await session.type("too slow");
		await session.press(ENTER, "j", "j", ENTER);
		await session.type("Redis");
		await session.press(ENTER, ENTER); // Other: Redis, next
		await session.press(" ", "n");
		await session.type("keep these");
		await session.press(ENTER, ENTER, "n");
		await session.type("ship friday");
		await session.press(ENTER, ENTER);
		const answered = await result;
		const args = { html: TWO };

		const tern = viewText(tool.describeResult?.(answered as never, { expanded: true, isPartial: false } as never, args as never) as NativeNode);
		const classic = (
			tool.renderResult?.(answered as never, { expanded: true, isPartial: false } as never, theme as never, args as never) as Component
		)
			.render(120)
			.join("\n");
		for (const shown of [tern, classic]) {
			for (const part of ["too slow", "Redis", "keep these", "ship friday"]) expect(count(shown, part)).toBe(1);
		}
	});
});
