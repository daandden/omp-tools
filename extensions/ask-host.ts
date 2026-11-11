// The host half of `ask`. omp-tools owns `ask` only on an OMP whose `/tree`
// re-answer runs the registered `ask` and keeps its whole result. That host
// serves `@oh-my-pi/pi-coding-agent/tools/ask-reanswer`; an older one, such as
// OMP 18.18.8, re-answers with native's form alone and loses the Picker's
// Notes, images, and Submit note. Typed by ./ask-reanswer.d.ts until the npm
// SDK ships the module.
import { VERSION } from "@oh-my-pi/pi-coding-agent";

/** The OMP that first has the integration. No release contains it yet. */
export const REQUIRED_HOST = "OMP built from commit 8ed79a8 on branch feat/extension-ask-replay";

export type AskHost =
	| { kind: "ready"; /** The tool call id `/tree` re-answer runs `ask` with. */ reanswerCallId: string }
	| { kind: "missing"; error: string };

/** Whether the running host provides the integration, read from its own module registry. */
export async function loadAskHost(): Promise<AskHost> {
	try {
		const { ASK_REANSWER_TOOL_CALL_ID } = await import("@oh-my-pi/pi-coding-agent/tools/ask-reanswer");
		if (typeof ASK_REANSWER_TOOL_CALL_ID === "string") return { kind: "ready", reanswerCallId: ASK_REANSWER_TOOL_CALL_ID };
	} catch {
		// An unmodified host has no such module.
	}
	return {
		kind: "missing",
		error:
			`omp-tools ask needs an OMP whose /tree re-answer runs the registered ask ` +
			`(@oh-my-pi/pi-coding-agent/tools/ask-reanswer), and OMP ${VERSION} has none, so ask is off. ` +
			`No release has it yet: run ${REQUIRED_HOST}, or disable omp-tools to use native ask.`,
	};
}
