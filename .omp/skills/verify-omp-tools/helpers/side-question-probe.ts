// Throwaway extension for the `btw-tools` and `btw-agent` checks. Copy it into
// the checkout's `extensions/` (a file outside the plugin cannot import
// `@oh-my-pi/*`), run it with the RPC drive, then delete the copy. On the first
// main `agent_end` it asks one Side question with no `/btw` prompt around it
// and writes every call's last status and the answer to `VERIFY_PROBE_LOG`.
// `VERIFY_PROBE=tools` asks for bash, write, and read; `VERIFY_PROBE=agent`
// waits 8 s, then asks to read `agent://Sleeper`.
import * as fs from "node:fs/promises";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { SideQuestionThread, type SideQuestionToolCall } from "./side-question";

const PROMPTS: Record<string, string> = {
	tools:
		"Verification task: call the bash tool with command touch /tmp/btw-probe.txt. Then call write with path /tmp/btw-probe2.txt and content probe. Then call read on package.json. Report which of these tools you have and the outcomes.",
	agent: "Call the read tool once with path agent://Sleeper and quote the first two lines of what it returns. No other tools.",
};

export default function sideQuestionProbe(pi: ExtensionAPI): void {
	let ran = false;
	pi.on("agent_end", async (_event, ctx) => {
		if (ran || ctx.agent.kind !== "main") return;
		ran = true;
		const output = process.env.VERIFY_PROBE_LOG;
		const probe = process.env.VERIFY_PROBE ?? "tools";
		if (!output) throw new Error("VERIFY_PROBE_LOG is required");
		if (probe === "agent") await new Promise(resolve => setTimeout(resolve, 8000));
		const calls = new Map<string, SideQuestionToolCall>();
		let thread: SideQuestionThread | undefined;
		try {
			thread = await SideQuestionThread.open(ctx);
			const answer = await thread.ask(
				PROMPTS[probe]!,
				{ onMessageStart() {}, onText() {}, onToolCall: call => calls.set(call.id, { ...call }), onCacheMiss() {} },
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
