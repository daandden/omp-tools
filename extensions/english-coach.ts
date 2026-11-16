import { completeSimple, type AssistantMessage } from "@oh-my-pi/pi-ai";
import { Tokenizer } from "@oh-my-pi/pi-agent-core";
import { AgentRegistry, AgentSession, discoverSlashCommands, type ExtensionAPI, type ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { resolveConfiguredModelPatterns } from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import { getPluginSettings } from "@oh-my-pi/pi-coding-agent/extensibility/plugins/loader";
import type { Component, TUI } from "@oh-my-pi/pi-tui";
import instructions from "./english-coach.md" with { type: "text" };
import { EnglishCoachPanel } from "./english-coach-panel";
import { prepareCoachPrompt, restoreCoachReply, type PreparedCoachPrompt } from "./english-coach-prompt";
import { forwardCoachInput, observeCoachInput } from "./english-coach-input";
import { isInterruptKey } from "./side-question-view";

const WIDGET_KEY = "omp-tools.english-coach";

function plainText(text: string): string {
	return text.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D\u20E3]/gu, "");
}

function replyLines(reply: string): string[] {
	if (reply === "No mistakes") return ["No mistakes"];
	if (reply === "Not English") return ["Not checked: no English text"];
	const [rewrite, ...mistakes] = reply.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
	if (plainText(reply) !== reply || !/^Better: \S/.test(rewrite ?? "") || mistakes.length === 0) {
		throw new Error("unreadable reply");
	}
	const items = mistakes.map(line => line.replace(/^-\s+/, ""));
	if (items.some(line => !/^.+ → .+ \([^)]+\)$/.test(line))) throw new Error("unreadable reply");
	return [rewrite!, ...items.map(line => `- ${line}`)];
}

export default function englishCoach(pi: ExtensionAPI) {
	let enabled = true;
	let disabled = false;
	let maxTokens = 300;
	let pending: AbortController | undefined;
	let promptCommandNames: ReadonlySet<string> = new Set();
	let stopForwarding: (() => void) | undefined;
	let stopKeys: (() => void) | undefined;
	const configure = async (_event: unknown, ctx: ExtensionContext) => {
		clear(ctx);
		stopForwarding?.();
		stopForwarding = observeCoachInput(ctx, observe);
		stopKeys?.();
		stopKeys = ctx.mode === "tui" && ctx.hasUI && ctx.agent.kind === "main"
			? ctx.ui.onTerminalInput(data => closeOnInterrupt(ctx, data))
			: undefined;
		promptCommandNames = new Set();
		const settings = await getPluginSettings("omp-tools", ctx.cwd);
		enabled = settings.englishCoach !== false;
		disabled = false;
		const limit = settings.englishCoachMaxTokens === undefined ? 300 : settings.englishCoachMaxTokens;
		if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
			disabled = true;
			if (enabled && ctx.mode === "tui" && ctx.hasUI && ctx.agent.kind === "main") {
				show(ctx, ["English coach: englishCoachMaxTokens must be a positive number. Coaching is off for this session."]);
			}
			return;
		}
		maxTokens = limit;
		if (enabled && ctx.mode === "tui" && ctx.hasUI && ctx.agent.kind === "main") {
			try {
				// OMP 18.20.3 marks discovered prompt files with _source; bundled templates have none.
				const commands = await discoverSlashCommands({ cwd: ctx.cwd });
				promptCommandNames = new Set(commands.filter(command => command._source !== undefined).map(command => command.name));
			} catch (error) {
				disabled = true;
				reportFailure(ctx, error);
			}
		}
	};
	pi.on("session_start", configure);
	pi.on("session_switch", configure);
	let lines: string[] = [];
	let tui: TUI | undefined;
	// The component focused when the panel opened: the main editor, since a submission or session start opens it.
	let editorFocus: Component | null = null;
	let shown = false;
	const show = (ctx: ExtensionContext, next: string[]) => {
		lines = next.map(plainText);
		if (shown) tui?.requestRender();
		else {
			ctx.ui.setWidget(WIDGET_KEY, host => {
				tui = host;
				editorFocus = host.getFocused();
				return new EnglishCoachPanel(host, () => lines, () => clear(ctx));
			}, { placement: "aboveEditor" });
			shown = true;
		}
	};
	// As /btw's panel: the interrupt key closes it only from an empty main editor, so a Picker or selector keeps its Esc.
	const closeOnInterrupt = (ctx: ExtensionContext, data: string) => {
		if (!shown || !isInterruptKey(data) || ctx.ui.getEditorText().trim() || tui?.getFocused() !== editorFocus) return undefined;
		clear(ctx);
		return { consume: true };
	};
	const reportFailure = (ctx: ExtensionContext, error: unknown) => {
		const failure = `Check failed: ${error instanceof Error ? error.message : String(error)}`;
		try {
			show(ctx, [failure]);
		} catch (widgetError) {
			const reason = widgetError instanceof Error ? widgetError.message : String(widgetError);
			ctx.ui.notify(plainText(`English coach: ${failure}. Could not show failure: ${reason}`), "warning");
		}
	};
	const clear = (ctx: ExtensionContext) => {
		pending?.abort();
		pending = undefined;
		lines = [];
		tui = undefined;
		if (shown) {
			shown = false;
			ctx.ui.setWidget(WIDGET_KEY, undefined);
		}
	};
	const end = (_event: unknown, ctx: ExtensionContext) => clear(ctx);
	pi.on("session_before_switch", end);
	pi.on("session_before_branch", end);
	pi.on("session_tree", end);
	pi.on("session_shutdown", (event, ctx) => {
		stopForwarding?.();
		stopForwarding = undefined;
		stopKeys?.();
		stopKeys = undefined;
		end(event, ctx);
	});

	const check = async (ctx: ExtensionContext, input: PreparedCoachPrompt, signal: AbortSignal) => {
		if (!/[\p{L}\p{N}]/u.test(input.englishText)) {
			show(ctx, ["Not checked: no English text"]);
			return;
		}
		const session = AgentRegistry.global().get(ctx.agent.id)?.session;
		if (!(session instanceof AgentSession)) return;
		const ledger = session.sessionManager;
		const owner = { sessionId: ledger.getSessionId(), parentId: ledger.getLeafId() };
		let model = ctx.models.resolve("@tiny");
		const patterns = resolveConfiguredModelPatterns("@tiny", session.settings);
		if (!model) {
			const providers = patterns.flatMap(pattern => pattern.includes("/") ? [pattern.slice(0, pattern.indexOf("/"))] : []);
			await ctx.modelRegistry.refreshDiscoverableProviders(providers, "online").catch(() => undefined);
			if (signal.aborted) return;
			model = ctx.models.resolve("@tiny");
			if (!model) {
				disabled = true;
				show(ctx, [`English coach: @tiny has no model (${patterns.join(", ")}). Coaching is off for this session.`]);
				return;
			}
		}
		if (!new Tokenizer(model).checkTokenBudget(input.englishText, maxTokens).fits) {
			show(ctx, [`Not checked: over ${maxTokens} tokens`]);
			return;
		}
		const apiKey = await ctx.modelRegistry.getApiKey(model, owner.sessionId, { signal });
		if (signal.aborted) return;
		if (!apiKey) {
			disabled = true;
			show(ctx, [`English coach: @tiny has no credential (${model.provider}/${model.id}). Coaching is off for this session.`]);
			return;
		}
		const onAttempt = (message: AssistantMessage) => {
			if (AgentRegistry.global().get(ctx.agent.id)?.session !== session) return;
			const { api, provider, model, usage, stopReason, errorMessage } = message;
			ledger.appendModelUsage({ purpose: "english-coach", api, provider, model, usage, stopReason, errorMessage }, owner);
		};
		const result = await completeSimple(model, {
			systemPrompt: [instructions],
			messages: [{ role: "user", content: input.text, timestamp: Date.now() }],
		}, { apiKey, maxTokens: 2 * maxTokens + 200, disableReasoning: true, signal, onAttempt });
		if (signal.aborted) return;
		if (result.stopReason === "error" || result.stopReason === "aborted") {
			throw new Error(result.errorMessage || "model call failed");
		}
		const text = result.content.filter(part => part.type === "text").map(part => part.text).join("").trim();
		show(ctx, restoreCoachReply(replyLines(text), input));
	};

	const observe: Parameters<typeof observeCoachInput>[1] = (event, ctx) => {
		try {
			if (event.source !== "interactive" || ctx.mode !== "tui" || !ctx.hasUI || ctx.agent.kind !== "main") return undefined;
			if (!enabled || disabled) {
				clear(ctx);
				return undefined;
			}
			const input = prepareCoachPrompt(event.text, promptCommandNames);
			if (!input) {
				clear(ctx);
				return undefined;
			}
			pending?.abort();
			const abort = new AbortController();
			pending = abort;
			show(ctx, ["Checking..."]);
			void check(ctx, input, abort.signal).catch(error => {
				if (!abort.signal.aborted) reportFailure(ctx, error);
			});
		} catch (error) {
			reportFailure(ctx, error);
		}
		return undefined;
	};
	pi.on("input", forwardCoachInput);
}
