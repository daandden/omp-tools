import { resolveModelOverride } from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import type { ExtensionAPI, ExtensionContext, InputEvent } from "@oh-my-pi/pi-coding-agent";
import type { Component, DescribeContext, NativeNode, TUI } from "@oh-my-pi/pi-tui";
import manifest from "../../package.json";
import { writePluginSettings } from "../support";
import { sideQuestionFixture } from "./side-question-session";

type Handler = (event: any, ctx: ExtensionContext) => unknown;

/** The classic panel's first line. */
export const TITLE = "English coach · esc to close";

/** Each text node's visible text, spans joined, in tree order. */
function nodeTexts(node: NativeNode): string[] {
	const props = node.p as { text?: string; spans?: { t: string }[] } | undefined;
	const own = node.k === "text" ? [props?.text ?? props?.spans?.map(span => span.t).join("") ?? ""] : [];
	return [...own, ...(node.c ?? []).flatMap(child => (typeof child === "object" && child !== null && "k" in child ? nodeTexts(child as NativeNode) : []))];
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
		lines: () => [...widgets.values()].flatMap(widget => widget.render(100)),
		native: () => [...widgets.values()].map(widget => widget.describe?.({ feature: () => true } as unknown as DescribeContext)),
		nativeText: () => [...widgets.values()].flatMap(widget => {
			const native = widget.describe?.({ feature: () => true } as unknown as DescribeContext);
			return native ? nodeTexts(native) : [];
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
