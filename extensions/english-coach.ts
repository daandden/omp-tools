import { completeSimple, type AssistantMessage } from "@oh-my-pi/pi-ai";
import { Tokenizer } from "@oh-my-pi/pi-agent-core";
import { AgentRegistry, AgentSession, discoverSlashCommands, type ExtensionAPI, type ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { resolveConfiguredModelPatterns } from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import { getPluginSettings } from "@oh-my-pi/pi-coding-agent/extensibility/plugins/loader";
import type { Component, TUI } from "@oh-my-pi/pi-tui";
import { matchesAppInterrupt } from "@oh-my-pi/pi-tui/keybinding-matchers";
import instructions from "./english-coach.md" with { type: "text" };
import { type CoachMistake, coachCorrection } from "./english-coach-diff";
import { type CoachView, EnglishCoachPanel } from "./english-coach-panel";
import { checkCoachPlaceholders, prepareCoachPrompt, type PreparedCoachPrompt } from "./english-coach-prompt";
import { forwardCoachInput, observeCoachInput } from "./english-coach-input";

const WIDGET_KEY = "omp-tools.english-coach";

function plainText(text: string): string {
	return text.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D\u20E3]/gu, "");
}

function replyView(reply: string, prompt: PreparedCoachPrompt): CoachView {
	if (reply === "No mistakes") return { kind: "clean" };
	if (reply === "Not English") return { kind: "note", text: "Not checked: no English text" };
	const [rewrite, ...lines] = reply.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
	if (plainText(reply) !== reply || !/^Better: \S/.test(rewrite ?? "") || lines.length === 0) {
		throw new Error("unreadable reply");
	}
	const parsed: CoachMistake[] = lines.map(line => {
		const mistake = /^(?:-\s+)?(.+) → (.+) \(([^)]+)\)$/.exec(line);
		if (!mistake) throw new Error("unreadable reply");
		return { original: mistake[1]!, corrected: mistake[2]!, pattern: mistake[3]! };
	});
	const better = rewrite!.slice("Better: ".length);
	checkCoachPlaceholders(better, lines, prompt);
	// Capitalization is never corrected: a case-only mistake is no mistake.
	const mistakes = parsed.filter(mistake => mistake.original.trim().toLowerCase() !== mistake.corrected.trim().toLowerCase());
	if (mistakes.length === 0) return { kind: "clean" };
	const correction = coachCorrection(prompt, better, mistakes);
	for (const part of correction.lines.flat()) part.text = plainText(part.text);
	for (const mistake of correction.mistakes) {
		mistake.original = plainText(mistake.original);
		mistake.corrected = plainText(mistake.corrected);
		mistake.pattern = plainText(mistake.pattern);
	}
	return { kind: "correction", correction };
}

export default function englishCoach(pi: ExtensionAPI) {
	let enabled = true;
	let disabled = false;
	let maxTokens = 300;
	let language = "Vietnamese";
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
		const named = settings.englishCoachLanguage === undefined ? "Vietnamese" : settings.englishCoachLanguage;
		const problem = typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0
			? "englishCoachMaxTokens must be a positive number"
			: typeof named !== "string" || !named.trim()
				? "englishCoachLanguage must name a language"
				: undefined;
		if (problem) {
			disabled = true;
			if (enabled && ctx.mode === "tui" && ctx.hasUI && ctx.agent.kind === "main") {
				show(ctx, note(`${problem}. Coaching is off for this session.`));
			}
			return;
		}
		maxTokens = limit as number;
		language = (named as string).trim();
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
	let view: CoachView = { kind: "checking" };
	let tui: TUI | undefined;
	// The component focused when the panel opened: the main editor, since a submission or session start opens it.
	let editorFocus: Component | null = null;
	let shown = false;
	const note = (text: string): CoachView => ({ kind: "note", text: plainText(text) });
	const show = (ctx: ExtensionContext, next: CoachView) => {
		view = next;
		if (shown) tui?.requestRender();
		else {
			ctx.ui.setWidget(WIDGET_KEY, host => {
				tui = host;
				editorFocus = host.getFocused();
				return new EnglishCoachPanel(host, () => view, () => clear(ctx));
			}, { placement: "aboveEditor" });
			shown = true;
		}
	};
	// As /btw's panel: the interrupt key closes it only from an empty main editor, so a Picker or selector keeps its Esc.
	const closeOnInterrupt = (ctx: ExtensionContext, data: string) => {
		if (!shown || !matchesAppInterrupt(data) || ctx.ui.getEditorText().trim() || tui?.getFocused() !== editorFocus) return undefined;
		clear(ctx);
		return { consume: true };
	};
	const reportFailure = (ctx: ExtensionContext, error: unknown) => {
		const failure = `Check failed: ${error instanceof Error ? error.message : String(error)}`;
		try {
			show(ctx, note(failure));
		} catch (widgetError) {
			const reason = widgetError instanceof Error ? widgetError.message : String(widgetError);
			ctx.ui.notify(plainText(`English coach: ${failure}. Could not show failure: ${reason}`), "warning");
		}
	};
	const clear = (ctx: ExtensionContext) => {
		pending?.abort();
		pending = undefined;
		view = { kind: "checking" };
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
			show(ctx, note("Not checked: no English text"));
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
				show(ctx, note(`@tiny has no model (${patterns.join(", ")}). Coaching is off for this session.`));
				return;
			}
		}
		if (!new Tokenizer(model).checkTokenBudget(input.englishText, maxTokens).fits) {
			show(ctx, note(`Not checked: over ${maxTokens} tokens`));
			return;
		}
		const apiKey = await ctx.modelRegistry.getApiKey(model, owner.sessionId, { signal });
		if (signal.aborted) return;
		if (!apiKey) {
			disabled = true;
			show(ctx, note(`@tiny has no credential (${model.provider}/${model.id}). Coaching is off for this session.`));
			return;
		}
		const onAttempt = (message: AssistantMessage) => {
			if (AgentRegistry.global().get(ctx.agent.id)?.session !== session) return;
			const { api, provider, model, usage, stopReason, errorMessage } = message;
			ledger.appendModelUsage({ purpose: "english-coach", api, provider, model, usage, stopReason, errorMessage }, owner);
		};
		const result = await completeSimple(model, {
			systemPrompt: [instructions.replaceAll("{{language}}", language)],
			messages: [{ role: "user", content: input.text, timestamp: Date.now() }],
		}, { apiKey, maxTokens: 2 * maxTokens + 200, disableReasoning: true, signal, onAttempt });
		if (signal.aborted) return;
		if (result.stopReason === "error" || result.stopReason === "aborted") {
			throw new Error(result.errorMessage || "model call failed");
		}
		const text = result.content.filter(part => part.type === "text").map(part => part.text).join("").trim();
		show(ctx, replyView(text, input));
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
			show(ctx, { kind: "checking" });
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
