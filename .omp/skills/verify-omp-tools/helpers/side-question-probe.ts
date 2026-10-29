// Throwaway extension for the `btw-tools`, `btw-agent`, and `btw-usage` checks.
// Copy it into the checkout's `extensions/` (a file outside the plugin cannot
// import `@oh-my-pi/*`), run it with the RPC drive, then delete the copy. On the
// first main `agent_end` it asks a Side question with no `/btw` prompt around
// it and writes to `VERIFY_PROBE_LOG`: every call's last status, the answer,
// the tools the mirror offers, and the main session's Side question usage
// entries (`side-question`, one per request, and `side-question:<purpose>` for
// the mirror's own off-transcript calls; they outlive the deleted thread file).
// `VERIFY_PROBE=tools` asks for bash, write, and read; `VERIFY_PROBE=agent`
// waits 8 s, then asks to read `agent://Sleeper`; `VERIFY_PROBE=usage` asks
// two threads different questions, one after the other.
import * as fs from "node:fs/promises";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { SideQuestionThread, type SideQuestionToolCall } from "./side-question";

const PROMPTS: Record<string, string[]> = {
	tools: [
		"Verification task: call the bash tool with command touch /tmp/btw-probe.txt. Then call write with path /tmp/btw-probe2.txt and content probe. Then call read on package.json. Report which of these tools you have and the outcomes.",
	],
	agent: ["Call the read tool once with path agent://Sleeper and quote the first two lines of what it returns. No other tools."],
	usage: [
		"Without using any tools, answer in one short line: which file did the main conversation's first prompt name?",
		"Without using any tools, answer in one short line: what is the last heading in that reference material?",
	],
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
		const threads: { tools: string[]; answer?: string; error?: string }[] = [];
		for (const question of PROMPTS[probe]!) {
			let thread: SideQuestionThread | undefined;
			try {
				thread = await SideQuestionThread.open(ctx);
				const tools = thread.toolNames;
				const answer = await thread.ask(
					question,
					{ onMessageStart() {}, onText() {}, onToolCall: call => calls.set(call.id, { ...call }), onCacheMiss() {}, onRecovery() {} },
					new AbortController().signal,
				);
				threads.push({ tools, answer });
			} catch (error) {
				threads.push({ tools: thread?.toolNames ?? [], error: String(error) });
			} finally {
				await thread?.dispose();
			}
		}
		const usage = ctx.sessionManager.getEntries().flatMap(entry =>
			entry.type === "model_usage" && entry.purpose.startsWith("side-question")
				? [{ purpose: entry.purpose, model: entry.model, stopReason: entry.stopReason, usage: entry.usage }]
				: [],
		);
		await fs.writeFile(output, `${JSON.stringify({ calls: [...calls.values()], threads, usage }, null, 2)}\n`);
	});
}
