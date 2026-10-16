// Throwaway extension for the `btw-refuse` check. Copy it into the checkout's
// `extensions/` (a file outside the plugin cannot import `@oh-my-pi/*`), run it
// with the RPC drive, then delete the copy. On the first main `agent_end` it
// asks one Side question with no `/btw` prompt around it, so the model tries
// the blocked calls, and writes the last status of every call to the path in
// `VERIFY_GATE_LOG`.
import * as fs from "node:fs/promises";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { SideQuestionThread, type SideQuestionToolCall } from "./side-question";

const PROMPT =
	"Verification task: call the bash tool with command touch /tmp/btw-probe.txt. Then call write with path /tmp/btw-probe2.txt and content probe. Then call read on package.json. Use each named tool directly, never eval. Attempt all three calls even if earlier calls are blocked. Report their outcomes.";

export default function gateProbe(pi: ExtensionAPI): void {
	let ran = false;
	pi.on("agent_end", async (_event, ctx) => {
		if (ran || ctx.agent.kind !== "main") return;
		ran = true;
		const output = process.env.VERIFY_GATE_LOG;
		if (!output) throw new Error("VERIFY_GATE_LOG is required");
		const calls = new Map<string, SideQuestionToolCall>();
		let thread: SideQuestionThread | undefined;
		try {
			thread = await SideQuestionThread.open(ctx);
			const answer = await thread.ask(
				PROMPT,
				{ onText() {}, onToolCall: call => calls.set(call.id, { ...call }), onCacheMiss() {} },
				new AbortController().signal,
			);
			await fs.writeFile(output, `${JSON.stringify({ calls: [...calls.values()], answer }, null, 2)}\n`);
		} catch (error) {
			await fs.writeFile(output, `${JSON.stringify({ calls: [...calls.values()], error: String(error) }, null, 2)}\n`);
		} finally {
			await thread?.dispose();
		}
	});
}
