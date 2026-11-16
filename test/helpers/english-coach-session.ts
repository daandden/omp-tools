import { resolveModelOverride } from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import type { ExtensionAPI, ExtensionContext, InputEvent } from "@oh-my-pi/pi-coding-agent";
import type { Component, DescribeContext, TUI } from "@oh-my-pi/pi-tui";
import manifest from "../../package.json";
import { writePluginSettings } from "../support";
import { sideQuestionFixture } from "./side-question-session";

type Handler = (event: any, ctx: ExtensionContext) => unknown;

export async function englishCoachFixture(options: {
	reply?: (body: Record<string, any>) => string | Promise<string>;
	fail?: string[];
	finishReason?: (body: Record<string, any>) => string;
	settings?: Record<string, unknown>;
	promptCommands?: string[];
} = {}) {
	const base = await sideQuestionFixture({ reply: options.reply ?? (() => "No mistakes"), fail: options.fail, finishReason: options.finishReason });
	const handlers = new Map<string, Handler[]>();
	const widgets = new Map<string, Component>();
	const placements = new Map<string, unknown>();
	const writes: string[] = [];
	const editor = {};
	let focused: unknown = editor;
	let renders = 0;
	const tui = {
		terminal: { rows: 40, columns: 100, write: (data: string) => writes.push(data) },
		requestRender() { renders++; },
		setFocus(component: unknown) { focused = component; },
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
		for (const handler of handlers.get(name) ?? []) {
			const result = await handler({ type: name, ...event }, context);
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
		const entry = manifest.omp.extensions.find(file => file.endsWith("/english-coach.ts"));
		if (!entry) throw new Error("English coach entry point is not registered in omp.extensions");
		const initialize = (await import(new URL(`../../${entry}`, import.meta.url).href)).default;
		await initialize({
			on(name: string, handler: Handler) {
				handlers.set(name, [...(handlers.get(name) ?? []), handler]);
			},
		} as unknown as ExtensionAPI);
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
		focus: () => focused === editor,
		renders: () => renders,
		dispose: async () => {
			await emit("session_shutdown");
			await base.dispose();
		},
	};
}
