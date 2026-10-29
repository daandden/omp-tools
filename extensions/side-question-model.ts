import type { AgentSession } from "@oh-my-pi/pi-coding-agent";
import { resolveExplicitModelRole, resolveModelOverride } from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import { getPluginSettings } from "@oh-my-pi/pi-coding-agent/extensibility/plugins/loader";
import { cfgDefaultThinkingLevel } from "@oh-my-pi/pi-coding-agent/session/settings";
import { AUTO_THINKING, automaticThinkingLevel, parseConfiguredThinkingLevel } from "@oh-my-pi/pi-tui/thinking";

export async function sideQuestionModel(main: AgentSession, cwd: string) {
	const settings = await getPluginSettings("omp-tools", cwd);
	const spec = typeof settings.sideQuestionModel === "string" ? settings.sideQuestionModel.trim() : "@smol";
	if (!spec) return undefined;
	const resolved = resolveModelOverride([spec], main.modelRegistry, main.settings);
	if (!resolved.model) return { warning: `Side question model ${JSON.stringify(spec)} could not be resolved. Using the main model.` };
	const defaultLevel = parseConfiguredThinkingLevel(cfgDefaultThinkingLevel.get(main.settings));
	return {
		model: resolved.model,
		role: resolveExplicitModelRole(spec, main.settings) ?? "default",
		thinkingLevel: resolved.thinkingLevel ?? (defaultLevel === AUTO_THINKING ? AUTO_THINKING : resolved.model.thinking?.defaultLevel ?? automaticThinkingLevel(resolved.model, defaultLevel)),
	};
}
