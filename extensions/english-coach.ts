import { completeSimple, type AssistantMessage } from "@oh-my-pi/pi-ai";
import { Tokenizer } from "@oh-my-pi/pi-agent-core";
import { AgentRegistry, AgentSession, type ExtensionAPI, type ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { resolveConfiguredModelPatterns } from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import { getPluginSettings } from "@oh-my-pi/pi-coding-agent/extensibility/plugins/loader";
import type { TUI } from "@oh-my-pi/pi-tui";
import instructions from "./english-coach.md" with { type: "text" };
import { EnglishCoachPanel } from "./english-coach-panel";

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
	const configure = async (_event: unknown, ctx: ExtensionContext) => {
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
	};
	pi.on("session_start", configure);
	pi.on("session_switch", configure);
	let lines: string[] = [];
	let tui: TUI | undefined;
	let shown = false;
	const show = (ctx: ExtensionContext, next: string[]) => {
		lines = next.map(plainText);
		if (shown) tui?.requestRender();
		else {
			shown = true;
			ctx.ui.setWidget(WIDGET_KEY, host => {
				tui = host;
				return new EnglishCoachPanel(host, () => lines);
			}, { placement: "aboveEditor" });
		}
	};

	const check = async (ctx: ExtensionContext, input: string) => {
		const session = AgentRegistry.global().get(ctx.agent.id)?.session;
		if (!(session instanceof AgentSession)) return;
		const ledger = session.sessionManager;
		const owner = { sessionId: ledger.getSessionId(), parentId: ledger.getLeafId() };
		let model = ctx.models.resolve("@tiny");
		const patterns = resolveConfiguredModelPatterns("@tiny", session.settings);
		if (!model) {
			const providers = patterns.flatMap(pattern => pattern.includes("/") ? [pattern.slice(0, pattern.indexOf("/"))] : []);
			await ctx.modelRegistry.refreshDiscoverableProviders(providers, "online").catch(() => undefined);
			model = ctx.models.resolve("@tiny");
			if (!model) {
				disabled = true;
				show(ctx, [`English coach: @tiny has no model (${patterns.join(", ")}). Coaching is off for this session.`]);
				return;
			}
		}
		if (!new Tokenizer(model).checkTokenBudget(input, maxTokens).fits) {
			show(ctx, [`Not checked: over ${maxTokens} tokens`]);
			return;
		}
		const abort = new AbortController();
		const apiKey = await ctx.modelRegistry.getApiKey(model, owner.sessionId, { signal: abort.signal });
		if (!apiKey) {
			disabled = true;
			show(ctx, [`English coach: @tiny has no credential (${model.provider}/${model.id}). Coaching is off for this session.`]);
			return;
		}
		const onAttempt = (message: AssistantMessage) => {
			// OMP 18.20.3 exposes the writable ledger only through the live AgentRegistry session.
			if (AgentRegistry.global().get(ctx.agent.id)?.session !== session) return;
			const { api, provider, model, usage, stopReason, errorMessage } = message;
			ledger.appendModelUsage({ purpose: "english-coach", api, provider, model, usage, stopReason, errorMessage }, owner);
		};
		const result = await completeSimple(model, {
			systemPrompt: [instructions],
			messages: [{ role: "user", content: input, timestamp: Date.now() }],
		}, { apiKey, maxTokens: 2 * maxTokens + 200, disableReasoning: true, signal: abort.signal, onAttempt });
		if (result.stopReason === "error" || result.stopReason === "aborted") {
			throw new Error(result.errorMessage || "model call failed");
		}
		const text = result.content.filter(part => part.type === "text").map(part => part.text).join("").trim();
		show(ctx, replyLines(text));
	};

	pi.on("input", (event, ctx) => {
		if (event.source !== "interactive" || ctx.mode !== "tui" || !ctx.hasUI || ctx.agent.kind !== "main") return undefined;
		if (!enabled || disabled || !event.text.trim() || event.text.trimStart().startsWith("/")) return undefined;
		show(ctx, ["Checking..."]);
		void check(ctx, event.text).catch(error => show(ctx, [`Check failed: ${error instanceof Error ? error.message : String(error)}`]));
		return undefined;
	});
}
