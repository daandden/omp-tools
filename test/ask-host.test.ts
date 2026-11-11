import { describe, expect, test } from "bun:test";
import { type } from "@oh-my-pi/omptype";
import type { ExtensionAPI, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import flexibleAsk from "../extensions/flexible-ask";

interface UnpatchedHostReport {
	sessionStartErrors: string[];
	tuiError: string | undefined;
	rpcError: string | undefined;
	reanswerError: string | undefined;
	nativeCalls: unknown[];
	pickers: number;
}

describe("the host's /tree re-answer integration", () => {
	test("without it, session start reports the required OMP revision and every ask fails with it, never falling back to native", async () => {
		const run = Bun.spawn(["bun", "test/helpers/unpatched-host-ask.ts"], { cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe" });
		const [stdout, stderr, exitCode] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
		expect({ exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({ exitCode: 0, stderr: "" });
		const report = JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as UnpatchedHostReport;

		expect(report.sessionStartErrors).toHaveLength(1);
		const [error] = report.sessionStartErrors;
		expect(error).toContain("8ed79a8");
		expect(error).toContain("feat/extension-ask-replay");
		expect([report.tuiError, report.rpcError, report.reanswerError]).toEqual([error, error, error]);
		expect(report.nativeCalls).toEqual([]);
		expect(report.pickers).toBe(0);
	});

	test("with it, session start reports nothing", async () => {
		const starts: ((event: unknown, ctx: unknown) => unknown)[] = [];
		const pi = {
			arktype: type,
			registerTool: (_definition: ToolDefinition) => {},
			on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
				if (event === "session_start") starts.push(handler);
			},
		};
		flexibleAsk(pi as unknown as ExtensionAPI);
		const ctx = { mode: "rpc", hasUI: false, cwd: process.cwd() };
		for (const start of starts) await start({ type: "session_start" }, ctx);
	});
});
