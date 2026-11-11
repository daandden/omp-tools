// `/tree` re-answer through the real host: a session of the OMP checkout named
// by OMP_TOOLS_HOST (commit 8ed79a8 on feat/extension-ask-replay, or a later
// one with the integration) loads the plugin from source as OMP loads plugins,
// a deterministic in-process provider calls `ask` once, and the host's own
// tree selector re-answers that call in the Picker. Every module comes from the
// host checkout, so host and plugin share one SDK instance. Skipped without
// OMP_TOOLS_HOST, since no OMP release has the integration yet.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentSession, ExtensionUIContext, SessionEntry } from "@oh-my-pi/pi-coding-agent";
import type { Component, TUI } from "@oh-my-pi/pi-tui";

const HOST = process.env.OMP_TOOLS_HOST;
const SOURCE = HOST ? path.join(HOST, "packages/coding-agent/src") : "";
const ESC = "\x1b";
const ENTER = "\r";
const IMAGE = { type: "image" as const, mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==" };
const FORM = `<form>
  <p>Which store?</p>
  <label><input type="radio" name="store" value="sqlite"> SQLite</label>
  <label><input type="radio" name="store" value="pg"> Postgres</label>
  <label>Title <input name="title"></label>
</form>`;
const OLD_QUESTIONS = [{ id: "store", question: "Which store?", options: [{ label: "SQLite" }, { label: "Postgres" }] }];

/** A module of the host checkout, typed by the npm SDK's declarations of the same module. */
async function hostModule<T>(specifier: string): Promise<T> {
	return (await import(specifier.startsWith(".") ? path.join(SOURCE, specifier) : Bun.resolveSync(specifier, SOURCE))) as T;
}

type Sdk = typeof import("@oh-my-pi/pi-coding-agent");
type Ai = typeof import("@oh-my-pi/pi-ai");

let sdk: Sdk;
let ai: Ai;
let selector: typeof import("@oh-my-pi/pi-coding-agent/modes/controllers/selector-controller");
let runtime: typeof import("@oh-my-pi/pi-coding-agent/modes/runtime-init");
let EventStream: typeof import("@oh-my-pi/pi-ai/utils/event-stream").AssistantMessageEventStream;
let tmp: string;

beforeAll(async () => {
	if (!HOST) return;
	sdk = await hostModule<Sdk>("./index.ts");
	ai = await hostModule<Ai>("@oh-my-pi/pi-ai");
	selector = await hostModule("./modes/controllers/selector-controller.ts");
	runtime = await hostModule("./modes/runtime-init.ts");
	EventStream = (await hostModule<typeof import("@oh-my-pi/pi-ai/utils/event-stream")>("@oh-my-pi/pi-ai/utils/event-stream"))
		.AssistantMessageEventStream;
	const theme = await hostModule<typeof import("@oh-my-pi/pi-tui/theme")>("@oh-my-pi/pi-tui/theme");
	await sdk.Settings.init({ inMemory: true });
	await theme.initTheme();
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omp-tools-tree-reanswer-"));
	// A host checkout's first load transpiles its sources.
}, 120_000);

afterAll(() => {
	if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

function assistant(content: unknown[], stopReason: "stop" | "toolUse") {
	return {
		role: "assistant" as const,
		content,
		api: "omp-tools-tree-reanswer",
		provider: "omp-tools-local",
		model: "local",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason,
		timestamp: Date.now(),
	};
}

/** The TUI the host gives `ui.custom`: the Picker it mounts, the focused component, and keys sent to it. */
function pickerScreen() {
	let picker: Component | undefined;
	let focused: (Component & { attachImage?(image: unknown): unknown; pasteText?(text: string): void }) | undefined;
	let opened = 0;
	let fail: Error | undefined;
	const tui = {
		terminal: { rows: 40, columns: 100, write() {} },
		getShowHardwareCursor: () => false,
		requestRender() {},
		setFocus(component: Component) {
			focused = component;
		},
	} as unknown as TUI;
	const ui = {
		custom: (factory: (tui: TUI, theme: unknown, keybindings: unknown, done: (value: unknown) => void) => Component) => {
			opened++;
			if (fail) return Promise.reject(fail);
			return new Promise(resolve => {
				picker = factory(tui, undefined, undefined, resolve);
				focused = picker;
			});
		},
		notify() {},
		setStatus() {},
		setWidget() {},
		addAutocompleteProvider() {},
		askDialog: async () => undefined,
		formDialog: async () => {
			throw new Error("native form dialog opened");
		},
	} as unknown as ExtensionUIContext;
	const shown = async () => {
		for (let tries = 0; !picker && tries < 2000; tries++) await Bun.sleep(1);
		if (!picker) throw new Error("no Picker opened");
		return picker;
	};
	return {
		ui,
		opened: () => opened,
		failNextWith(error: Error) {
			fail = error;
		},
		shown,
		next() {
			picker = undefined;
			focused = undefined;
		},
		press: async (...keys: string[]) => {
			const target = await shown();
			for (const key of keys) target.handleInput?.(key);
		},
		type: async (text: string) => {
			const target = await shown();
			for (const char of text) target.handleInput?.(char);
		},
		pasteImage: async () => {
			await shown();
			const marker = focused?.attachImage?.(IMAGE);
			if (typeof marker === "string") focused?.pasteText?.(marker);
		},
		render: async () => (await shown()).render(100).join("\n"),
	};
}

async function hostSession() {
	const api = `omp-tools-tree-reanswer-${crypto.randomUUID()}`;
	let requests = 0;
	ai.registerCustomApi(api, () => {
		requests++;
		const stream = new EventStream();
		const first = requests === 1;
		queueMicrotask(() => {
			if (first) {
				const toolCall = { type: "toolCall" as const, id: "call-ask-1", name: "ask", arguments: { html: FORM } };
				const message = assistant([toolCall], "toolUse");
				stream.push({ type: "toolcall_start", contentIndex: 0, partial: message } as never);
				stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message } as never);
				stream.push({ type: "done", reason: "toolUse", message } as never);
			} else {
				stream.push({ type: "done", reason: "stop", message: assistant([{ type: "text", text: "done" }], "stop") } as never);
			}
		});
		return stream;
	});
	const dir = fs.mkdtempSync(path.join(tmp, "session-"));
	const authStorage = await sdk.AuthStorage.create(":memory:");
	const modelRegistry = new sdk.ModelRegistry(authStorage, path.join(dir, "models.yml"));
	const catalog = await hostModule<{ buildModel(spec: unknown): unknown }>("@oh-my-pi/pi-catalog/build");
	const model = catalog.buildModel({
		id: "local",
		name: "Local",
		api,
		provider: "ollama",
		baseUrl: "http://127.0.0.1:9",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 1024,
	});
	const screen = pickerScreen();
	const { session } = await sdk.createAgentSession({
		cwd: dir,
		agentDir: dir,
		sessionManager: sdk.SessionManager.inMemory(dir),
		authStorage,
		modelRegistry,
		settings: sdk.Settings.isolated({ "compaction.enabled": false, "tools.xdev": false, "ask.timeout": 0, "ask.notify": "off" }),
		model: model as never,
		disableExtensionDiscovery: true,
		additionalExtensionPaths: [path.join(import.meta.dir, "../extensions/flexible-ask.ts")],
		skills: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		enableMCP: false,
		enableLsp: false,
		skipPythonPreflight: true,
		toolNames: ["ask"],
		hasUI: true,
	} as never);
	const runtimeErrors: unknown[] = [];
	await runtime.initializeExtensions(session as never, {
		mode: "tui",
		uiContext: screen.ui as never,
		reportSendError: (_action, error) => runtimeErrors.push(error),
		reportRuntimeError: error => runtimeErrors.push(error),
	});
	return {
		session,
		screen,
		runtimeErrors,
		requests: () => requests,
		async dispose() {
			await session.dispose();
			authStorage.close();
		},
	};
}

type Harness = Awaited<ReturnType<typeof hostSession>>;

/** The interactive-mode surface `/tree` touches, backed by the real session. */
function treeContext(harness: Harness) {
	const children: unknown[] = [];
	const statuses: string[] = [];
	const errors: string[] = [];
	const ctx = {
		editor: { getText: () => "", setText() {}, setDraft() {}, onEscape: undefined },
		editorContainer: {
			children,
			clear: () => {
				children.length = 0;
			},
			addChild: (child: unknown) => {
				children.push(child);
			},
		},
		sessionManager: harness.session.sessionManager,
		session: harness.session,
		settings: harness.session.settings,
		ui: { setFocus() {}, getFocused: () => undefined, requestRender() {}, terminal: { rows: 24 } },
		renderInitialMessages: async () => {},
		reloadTodos: async () => {},
		truncateTranscriptFromMessage: () => false,
		showStatus: (message: string) => statuses.push(message),
		showError: (message: string) => errors.push(message),
		getToolUIContext: () => harness.screen.ui,
	};
	return { ctx, children, statuses, errors };
}

/** Picks `entryId` in the host's `/tree` selector; resolves once the selection is handled. */
function pickInTree(harness: Harness, entryId: string) {
	const tree = treeContext(harness);
	new selector.SelectorController(tree.ctx as never).showTreeSelector();
	const mounted = tree.children.at(-1) as { getTreeList(): { onSelect?(id: string, options: { summarize: boolean }): unknown } };
	harness.screen.next();
	const done = Promise.resolve(mounted.getTreeList().onSelect?.(entryId, { summarize: false }));
	return { ...tree, done };
}

function askResults(session: AgentSession) {
	return session.sessionManager
		.getEntries()
		.filter((entry: SessionEntry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "ask");
}

function toolResult(entry: SessionEntry | undefined) {
	if (entry?.type !== "message" || entry.message.role !== "toolResult") throw new Error("not a tool result");
	return entry.message;
}

function history(session: AgentSession) {
	return { entries: session.sessionManager.getEntries().map(entry => entry.id), leaf: session.sessionManager.getLeafId() };
}

function textOf(content: { type: string; text?: string }[]): string {
	return content.flatMap(block => (block.type === "text" && block.text ? [block.text] : [])).join("\n");
}

/** Answers the first `ask`: SQLite, title "first". */
async function answerFirstAsk(harness: Harness) {
	const sent = harness.session.sendUserMessage("which store?");
	await harness.screen.press(ENTER, ENTER);
	await harness.screen.type("first");
	await harness.screen.press(ENTER, ENTER, ENTER);
	await sent;
	await harness.session.waitForIdle();
	const [original] = askResults(harness.session);
	if (!original) throw new Error("the first ask left no result");
	return original;
}

async function waitForRequests(harness: Harness, count: number) {
	for (let tries = 0; harness.requests() < count; tries++) {
		if (tries > 1000) throw new Error(`expected ${count} provider requests, saw ${harness.requests()}`);
		await Bun.sleep(5);
	}
	await harness.session.waitForIdle();
}

describe.skipIf(!HOST)("/tree re-answer in the Picker on the patched host", () => {
	test("a mixed form re-answered in the Picker persists native data, an unpicked Note, the Submit note and an image once", async () => {
		const harness = await hostSession();
		try {
			const original = await answerFirstAsk(harness);
			expect(harness.requests()).toBe(2);

			const tree = pickInTree(harness, original.id);
			await harness.screen.press("n");
			await harness.screen.type("too slow ");
			await harness.screen.pasteImage();
			await harness.screen.press(ENTER); // the Note on SQLite, with an image
			await harness.screen.press("j", ENTER); // pick Postgres
			await harness.screen.press(ENTER);
			await harness.screen.type("Ship drafts");
			await harness.screen.press(ENTER, ENTER); // the title, then the Submit tab
			await harness.screen.press("n");
			await harness.screen.type("ship it");
			await harness.screen.press(ENTER);
			// No model request between the tree pick and the form.
			expect(harness.requests()).toBe(2);
			await harness.screen.press(ENTER);
			await tree.done;

			expect(tree.errors).toEqual([]);
			expect(tree.statuses).toContain("Navigated to selected point");
			const results = askResults(harness.session);
			expect(results).toHaveLength(2);
			const reanswer = toolResult(results.find(entry => entry.id !== original.id));
			expect(reanswer.toolCallId).toBe("call-ask-1");
			expect(reanswer.isError).toBe(false);
			const text = textOf(reanswer.content as { type: string; text?: string }[]);
			expect(JSON.parse(text.slice(text.indexOf("{"), text.indexOf("\n}") + 2))).toEqual({ store: "pg", title: "Ship drafts" });
			expect(reanswer.content.filter(block => block.type === "image")).toEqual([IMAGE]);
			const details = reanswer.details as { unpickedNotes?: { option: string; text: string }[]; submitNote?: string };
			expect(details.unpickedNotes).toEqual([expect.objectContaining({ option: "SQLite", text: "too slow [Image #1]" })]);
			expect(details.submitNote).toBe("ship it");
			const images = harness.session.sessionManager
				.getEntries()
				.flatMap(entry => (entry.type === "message" && "content" in entry.message && Array.isArray(entry.message.content) ? entry.message.content : []))
				.filter(block => typeof block === "object" && block.type === "image");
			expect(images).toHaveLength(1);

			// The agent resumes from the new answer without asking again.
			await waitForRequests(harness, 3);
			expect(askResults(harness.session)).toHaveLength(2);
			expect(harness.screen.opened()).toBe(2);
			expect(harness.runtimeErrors).toEqual([]);
		} finally {
			await harness.dispose();
		}
	});

	test("Esc leaves history as it was and keeps a draft the next re-answer restores", async () => {
		const harness = await hostSession();
		try {
			const original = await answerFirstAsk(harness);
			const before = history(harness.session);

			const cancelled = pickInTree(harness, original.id);
			await harness.screen.press("j", ENTER); // pick Postgres
			await harness.screen.press(ENTER);
			await harness.screen.type("kept");
			await harness.screen.press(ENTER, ESC);
			await cancelled.done;
			expect(cancelled.statuses).toContain("Re-answer cancelled");
			expect(cancelled.errors).toEqual([]);
			expect(history(harness.session)).toEqual(before);
			expect(harness.requests()).toBe(2);

			const again = pickInTree(harness, original.id);
			expect(await harness.screen.render()).toContain("Restored your answers");
			await harness.screen.press("l", ENTER);
			await again.done;
			const reanswer = toolResult(askResults(harness.session).find(entry => entry.id !== original.id));
			const text = textOf(reanswer.content as { type: string; text?: string }[]);
			expect(JSON.parse(text.slice(text.indexOf("{"), text.indexOf("\n}") + 2))).toEqual({ store: "pg", title: "kept" });
			await waitForRequests(harness, 3);
		} finally {
			await harness.dispose();
		}
	});

	test("a Picker failure is reported and leaves history as it was, with no native form", async () => {
		const harness = await hostSession();
		try {
			const original = await answerFirstAsk(harness);
			const before = history(harness.session);
			harness.screen.failNextWith(new Error("Picker could not mount"));

			const tree = pickInTree(harness, original.id);
			await tree.done;

			expect(tree.errors).toEqual([expect.stringContaining("Picker could not mount")]);
			expect(history(harness.session)).toEqual(before);
			expect(harness.requests()).toBe(2);
		} finally {
			await harness.dispose();
		}
	});

	test("an old questions[] ask stays as saved: the tree moves to it without a form", async () => {
		const harness = await hostSession();
		try {
			const manager = harness.session.sessionManager;
			manager.appendMessage({ role: "user", content: "which store?", timestamp: Date.now() });
			manager.appendMessage(assistant([{ type: "toolCall", id: "call-old-1", name: "ask", arguments: { questions: OLD_QUESTIONS } }], "toolUse") as never);
			const oldId = manager.appendMessage({
				role: "toolResult",
				toolCallId: "call-old-1",
				toolName: "ask",
				content: [{ type: "text", text: "User selected: SQLite" }],
				details: { results: [{ id: "store", question: "Which store?", options: ["SQLite", "Postgres"], multi: false, selectedOptions: ["SQLite"] }] },
				isError: false,
				timestamp: Date.now(),
			} as never);
			manager.appendMessage(assistant([{ type: "text", text: "noted" }], "stop") as never);
			const saved = JSON.stringify(manager.getEntries());

			const tree = pickInTree(harness, oldId);
			await tree.done;

			expect(tree.errors).toEqual([]);
			expect(harness.screen.opened()).toBe(0);
			expect(manager.getLeafId()).toBe(oldId);
			expect(JSON.stringify(manager.getEntries())).toBe(saved);
			expect(harness.requests()).toBe(0);
		} finally {
			await harness.dispose();
		}
	});
});
