// Loads the plugin's `ask` where `@oh-my-pi/pi-coding-agent` is the npm SDK,
// which has no `/tree` re-answer integration, as an unmodified OMP host has
// none. Run as its own process: the test preload stands in for a patched host.
// Prints what the session start and two `ask` calls reported, as JSON.
import { type } from "@oh-my-pi/omptype";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import flexibleAsk from "../../extensions/flexible-ask";

let tool: ToolDefinition | undefined;
const handlers = new Map<string, ((event: unknown, ctx: unknown) => unknown)[]>();
const pi = {
	arktype: type,
	registerTool: (definition: ToolDefinition) => {
		tool = definition;
	},
	on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
		handlers.set(event, [...(handlers.get(event) ?? []), handler]);
	},
};
flexibleAsk(pi as unknown as ExtensionAPI);
if (!tool) throw new Error("ask was not registered");

const nativeCalls: unknown[] = [];
let pickers = 0;
const context = (mode: "tui" | "rpc") =>
	({
		mode,
		hasUI: mode === "tui",
		cwd: process.cwd(),
		ui: {
			custom: () => {
				pickers++;
				return Promise.reject(new Error("the Picker opened"));
			},
			notify() {},
			addAutocompleteProvider() {},
		},
		abort() {},
		invokeTool: async (params: unknown) => {
			nativeCalls.push(params);
			return { content: [{ type: "text", text: "native ask" }], details: { answers: [] } };
		},
	}) as unknown as ExtensionContext;

const sessionStartErrors: string[] = [];
for (const handler of handlers.get("session_start") ?? []) {
	try {
		await handler({ type: "session_start" }, context("tui"));
	} catch (error) {
		sessionStartErrors.push(error instanceof Error ? error.message : String(error));
	}
}

const html = '<form><label><input type="radio" name="store" value="sqlite"> SQLite</label><label><input type="radio" name="store" value="pg"> Postgres</label></form>';
const callError = async (mode: "tui" | "rpc", toolCallId: string) => {
	try {
		await tool?.execute(toolCallId, { html }, undefined, undefined, context(mode));
		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
};

console.log(
	JSON.stringify({
		sessionStartErrors,
		tuiError: await callError("tui", "call-1"),
		rpcError: await callError("rpc", "call-2"),
		reanswerError: await callError("tui", "tree-reanswer"),
		nativeCalls,
		pickers,
	}),
);
