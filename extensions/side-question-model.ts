import type { AgentSession } from "@oh-my-pi/pi-coding-agent";
import { resolveConfiguredModelPatterns, resolveExplicitModelRole, resolveModelOverride } from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import { getPluginSettings } from "@oh-my-pi/pi-coding-agent/extensibility/plugins/loader";
import { cfgDefaultThinkingLevel } from "@oh-my-pi/pi-coding-agent/session/settings";
import { AUTO_THINKING, automaticThinkingLevel, parseConfiguredThinkingLevel } from "@oh-my-pi/pi-tui/thinking";

export async function sideQuestionModel(main: AgentSession, cwd: string, signal: AbortSignal) {
	const settings = await getPluginSettings("omp-tools", cwd);
	const spec = typeof settings.sideQuestionModel === "string" ? settings.sideQuestionModel.trim() : "@smol";
	if (!spec) return undefined;
	let resolved = resolveModelOverride([spec], main.modelRegistry, main.settings);
	if (!resolved.model) {
		// A provider's catalog can lose discovered models in a running OMP until that provider is discovered again.
		const patterns = resolveConfiguredModelPatterns(spec, main.settings);
		const providers = patterns.flatMap(pattern => (pattern.includes("/") ? [pattern.slice(0, pattern.indexOf("/"))] : []));
		await untilAborted(main.modelRegistry.refreshDiscoverableProviders(providers, "online").catch(() => undefined), signal);
		resolved = resolveModelOverride([spec], main.modelRegistry, main.settings);
		if (!resolved.model) {
			const named = patterns.map(withoutThinkingLevel).join(", ");
			const target = named && named !== spec ? ` (${named})` : "";
			return { warning: `Side question model ${JSON.stringify(spec)}${target} is not in the model list. Using the main model.` };
		}
	}
	const defaultLevel = parseConfiguredThinkingLevel(cfgDefaultThinkingLevel.get(main.settings));
	return {
		model: resolved.model,
		role: resolveExplicitModelRole(spec, main.settings) ?? "default",
		thinkingLevel: resolved.thinkingLevel ?? (defaultLevel === AUTO_THINKING ? AUTO_THINKING : resolved.model.thinking?.defaultLevel ?? automaticThinkingLevel(resolved.model, defaultLevel)),
	};
}

function withoutThinkingLevel(pattern: string) {
	const colon = pattern.lastIndexOf(":");
	return colon > 0 && parseConfiguredThinkingLevel(pattern.slice(colon + 1)) ? pattern.slice(0, colon) : pattern;
}

/** Stops waiting when `signal` aborts; the refresh itself goes on for other readers of the shared registry. */
function untilAborted(work: Promise<unknown>, signal: AbortSignal): Promise<unknown> {
	const cancelled = Promise.withResolvers<never>();
	const abort = () => cancelled.reject(new DOMException("Side question cancelled", "AbortError"));
	if (signal.aborted) abort();
	else signal.addEventListener("abort", abort, { once: true });
	return Promise.race([work, cancelled.promise]).finally(() => signal.removeEventListener("abort", abort));
}
