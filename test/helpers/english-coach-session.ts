import { resolveModelOverride } from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import type { ExtensionAPI, ExtensionContext, InputEvent } from "@oh-my-pi/pi-coding-agent";
import type { Component, DescribeContext, NativeNode, TUI } from "@oh-my-pi/pi-tui";
import manifest from "../../package.json";
import { writePluginSettings } from "../support";
import { sideQuestionFixture } from "./side-question-session";

type Handler = (event: any, ctx: ExtensionContext) => unknown;

/** The classic panel's first line at `width`: the title, what the check found, and the close key at the right edge. */
export function title(status?: string, width = 100): string {
	const left = `English coach${status ? ` · ${status}` : ""}`;
	return `${left}${" ".repeat(width - Bun.stringWidth(left) - 3)}esc`;
}

/** The classic first line above a note. */
export const TITLE = title();
/** The classic panel while a check runs. */
export const CHECKING = title("checking…");
/** The classic panel for a prompt with no mistakes. */
export const CLEAN = title("no mistakes");

/** A widget's classic lines at `width`, without colour. */
export function plainLines(widget: Component, width = 100): string[] {
	return widget.render(width).map(line => Bun.stripANSI(line));
}

/** Each text node's spans (a plain text as one unstyled span), in tree order; a wrapping row is one line, like spans are. */
function nodeSpans(node: NativeNode): { t: string; s?: string }[][] {
	const props = node.p as { text?: string; spans?: { t: string; s?: string }[]; wrap?: unknown } | undefined;
	if (node.k === "text") return [props?.spans ?? [{ t: props?.text ?? "" }]];
	const children = (node.c ?? []).flatMap(child => (typeof child === "object" && child !== null && "k" in child ? nodeSpans(child as NativeNode) : []));
	if (node.k !== "row" || props?.wrap !== true) return children;
	// Pieces keep their edge spaces as no-break spaces; they read as spaces.
	const line: { t: string; s?: string }[] = [];
	for (const span of children.flat()) {
		const t = span.t.replaceAll("\u00a0", " ");
		const last = line.at(-1);
		if (last && last.s === span.s) last.t += t;
		else line.push({ ...span, t });
	}
	return [line];
}

/** Each hoverable change in a native tree: its text and its tooltip. */
export function nodeHovers(node: NativeNode): { text: string; title: string }[] {
	const props = node.p as { spans?: { t: string }[]; title?: string; hovercard?: unknown } | undefined;
	const own = node.k === "text" && props?.hovercard !== undefined
		? [{ text: (props.spans ?? []).map(span => span.t).join("").replaceAll("\u00a0", " ").trim(), title: props.title ?? "" }]
		: [];
	return [...own, ...(node.c ?? []).flatMap(child => (typeof child === "object" && child !== null && "k" in child ? nodeHovers(child as NativeNode) : []))];
}

/** Each text node's visible text, spans joined, in tree order. */
function nodeTexts(node: NativeNode): string[] {
	return nodeSpans(node).map(spans => spans.map(span => span.t).join(""));
}

export async function until(predicate: () => boolean): Promise<void> {
	const end = Date.now() + 2000;
	while (!predicate()) {
		if (Date.now() > end) throw new Error("Timed out waiting for English coach");
		await Bun.sleep(5);
	}
}

export async function englishCoachFixture(options: {
	reply?: (body: Record<string, any>) => string | Promise<string>;
	fail?: string[];
	finishReason?: (body: Record<string, any>) => string;
	settings?: Record<string, unknown>;
	promptCommands?: string[];
	entryPoints?: ("english-coach" | "btw")[];
} = {}) {
	const base = await sideQuestionFixture({ reply: options.reply ?? (() => "No mistakes"), fail: options.fail, finishReason: options.finishReason });
	const handlers = new Map<string, Handler[]>();
	const widgets = new Map<string, Component>();
	const placements = new Map<string, unknown>();
	const writes: string[] = [];
	const editor = {};
	let focused: unknown = editor;
	let editorText = "";
	let renders = 0;
	const keyHandlers: ((data: string) => { consume?: boolean } | undefined)[] = [];
	const tui = {
		terminal: { rows: 40, columns: 100, write: (data: string) => writes.push(data) },
		requestRender() { renders++; },
		setFocus(component: unknown) { focused = component; },
		getFocused: () => focused,
	} as unknown as TUI;
	const ctx = {
		...base.ctx,
		mode: "tui",
		hasUI: true,
		model: base.main.model,
		modelRegistry: base.main.modelRegistry,
		models: {
			resolve: (spec: string) => resolveModelOverride([spec], base.main.modelRegistry, base.settings).model,
		},
		ui: {
			...base.ctx.ui,
			onTerminalInput(handler: (data: string) => { consume?: boolean } | undefined) {
				keyHandlers.push(handler);
				return () => keyHandlers.splice(keyHandlers.indexOf(handler), 1);
			},
			getEditorText: () => editorText,
			setWidget(key: string, factory: ((tui: TUI) => Component) | undefined, placement?: unknown) {
				if (!factory) widgets.delete(key);
				else {
					widgets.set(key, factory(tui));
					placements.set(key, placement);
				}
			},
		},
	} as unknown as ExtensionContext;
	const emit = async (name: string, event: Record<string, unknown> = {}, context = ctx) => {
		const results: unknown[] = [];
		const dispatch = Object.create(context) as ExtensionContext;
		Object.defineProperty(dispatch, "models", { value: { ...context.models } });
		for (const handler of handlers.get(name) ?? []) {
			const result = await handler({ type: name, ...event }, Object.create(dispatch));
			results.push(result);
			if ((result as { handled?: boolean } | undefined)?.handled) break;
		}
		return results;
	};
	try {
		writePluginSettings(base.ctx.cwd, options.settings ?? {});
		for (const name of options.promptCommands ?? []) {
			await Bun.write(`${base.ctx.cwd}/.omp/commands/${name}.md`, "Expanded template must never reach the coach.\n$ARGUMENTS");
		}
		for (const name of options.entryPoints ?? ["english-coach"]) {
			const entry = manifest.omp.extensions.find(file => file.endsWith(`/${name}.ts`));
			if (!entry) throw new Error(`${name} entry point is not registered in omp.extensions`);
			const initialize = (await import(new URL(`../../${entry}`, import.meta.url).href)).default;
			await initialize({
				on(name: string, handler: Handler) {
					handlers.set(name, [...(handlers.get(name) ?? []), handler]);
				},
			} as unknown as ExtensionAPI);
		}
		await emit("session_start");
	} catch (error) {
		await base.dispose();
		throw error;
	}
	return {
		...base,
		ctx, emit, widgets, placements, writes,
		input: (text: string, event: Partial<InputEvent> = {}, context = ctx) => emit("input", { source: "interactive", text, ...event }, context),
		lines: () => [...widgets.values()].flatMap(widget => plainLines(widget)),
		native: () => [...widgets.values()].map(widget => widget.describe?.({ feature: () => true } as unknown as DescribeContext)),
		nativeSpans: () => [...widgets.values()].flatMap(widget => {
			const native = widget.describe?.({ feature: () => true } as unknown as DescribeContext);
			return native ? nodeSpans(native) : [];
		}),
		nativeText: () => [...widgets.values()].flatMap(widget => {
			const native = widget.describe?.({ feature: () => true } as unknown as DescribeContext);
			return native ? nodeTexts(native) : [];
		}),
		nativeHovers: () => [...widgets.values()].flatMap(widget => {
			const native = widget.describe?.({ feature: () => true } as unknown as DescribeContext);
			return native ? nodeHovers(native) : [];
		}),
		/** Sends terminal input through the registered handlers in order; true when one consumed it. */
		key: (data: string) => keyHandlers.some(handler => handler(data)?.consume === true),
		/** Puts text in the main editor, as typing would. */
		type: (text: string) => { editorText = text; },
		/** Moves focus off the main editor, as an open Picker or selector does. */
		focusElsewhere: () => { focused = {}; },
		focus: () => focused === editor,
		renders: () => renders,
		dispose: async () => {
			await emit("session_shutdown");
			await base.dispose();
		},
	};
}
