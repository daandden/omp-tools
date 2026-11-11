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

	test("a text, number or textarea field fails with an error naming it, opening nothing and not falling back to native", async () => {
		const { tool } = loadAsk();
		const session = tuiSession();
		const html = `<form>${STORE}<label>Days <input type="number" name="ttl_days" value="30"></label></form>`;
		await expect(run(tool, html, session)).rejects.toThrow('name="ttl_days"');
		expect(session.pickers()).toBe(0);
		expect(session.nativeCalls).toEqual([]);
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
