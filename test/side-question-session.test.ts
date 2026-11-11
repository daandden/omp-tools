import { expect, test } from "bun:test";
import { AgentRegistry, type SessionManager } from "@oh-my-pi/pi-coding-agent";
import { parseConfiguredThinkingLevel } from "@oh-my-pi/pi-tui/thinking";
import { sideQuestionsAvailable } from "../extensions/side-question";
import { callbacks, sideQuestionFixture } from "./helpers/side-question-session";

type Fixture = Awaited<ReturnType<typeof sideQuestionFixture>>;
type Entry = Parameters<SessionManager["appendMessage"]>[0];

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

/** Writes main-session turns the way OMP persists them, keeping the live messages rebuilt from the file as OMP does. */
function history(fixture: Fixture) {
	const manager = fixture.main.sessionManager;
	const model = fixture.main.model!;
	const append = (message: Entry) => {
		const id = manager.appendMessage(message);
		fixture.main.agent.replaceMessages(manager.buildSessionContext().messages);
		return id;
	};
	return {
		manager,
		user: (text: string) => append({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() } as Entry),
		assistant: (text: string, ...calls: [id: string, name: string, args: Record<string, unknown>][]) => append({
			role: "assistant",
			content: [
				...(text ? [{ type: "text", text }] : []),
				...calls.map(([id, name, args]) => ({ type: "toolCall", id, name, arguments: args })),
			],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage,
			stopReason: calls.length ? "toolUse" : "stop",
			timestamp: Date.now(),
		} as Entry),
		result: (toolCallId: string, toolName: string, text: string) => append({
			role: "toolResult",
			toolCallId,
			toolName,
			content: [{ type: "text", text }],
			isError: false,
			timestamp: Date.now(),
		} as Entry),
	};
}

/**
 * The conversation a provider request carries, one line per message, without
 * the system prompt and the date reminder OMP puts before the first user message.
 */
function transcript(request: Record<string, any> | undefined): string[] {
	return (request?.messages as Record<string, any>[] ?? [])
		.filter(message => message.role !== "system" && message.role !== "developer")
		.map(message => {
			const text = (typeof message.content === "string"
				? message.content
				: (message.content as Record<string, any>[] ?? []).map(part => part.text ?? `[${part.type}]`).join(""))
				.replace(/^<system-reminder>\nToday: [^]*?<\/system-reminder>/, "");
			if (message.role === "tool") return `tool ${message.tool_call_id}: ${text}`;
			const calls = (message.tool_calls as Record<string, any>[] ?? []).map(call => `${call.function.name}#${call.id}`);
			return [`${message.role}:`, text, calls.length ? `[${calls.join(", ")}]` : ""].filter(Boolean).join(" ");
		});
}

/** Asks one Side question in a new thread and returns its first request's conversation. */
async function firstSideRequest(fixture: Fixture): Promise<string[]> {
	const before = fixture.requests.length;
	const thread = await fixture.open();
	expect(await thread.ask("side-question-prompt", callbacks(), AbortSignal.timeout(5_000))).toBe("answered by main");
	return transcript(fixture.requests[before]);
}

/** OMP's eval runtime snapshot, persisted after a history rewrite of a branch with eval calls. */
const evalState = expect.stringMatching(/^user: <system-reminder>\nEval runtime state is host-retained/);

/**
 * Browses the tree as a user does: an eval branch, then a later turn on
 * another branch, then back to the eval branch. Revisiting moves onto the
 * snapshot OMP persisted on the first visit, so the selected entry is not the
 * file's last one.
 */
async function backToEvalBranch(fixture: Fixture) {
	const turn = history(fixture);
	turn.user("eval-branch-question");
	turn.assistant("", ["call_eval_a", "eval", { language: "python", code: "x = 1" }]);
	const evalResult = turn.result("call_eval_a", "eval", "eval-branch-result");
	turn.manager.resetLeaf();
	turn.user("abandoned-branch-question");
	const abandoned = turn.assistant("abandoned-branch-answer");
	await fixture.main.navigateTree(evalResult);
	await fixture.main.navigateTree(abandoned);
	await fixture.main.prompt("abandoned-follow-up");
	await fixture.main.waitForIdle();
	await fixture.main.navigateTree(evalResult);
	const entries = turn.manager.getEntries();
	expect(turn.manager.getLeafId()).not.toBe(entries.at(-1)?.id);
}

const evalBranch = [
	"user: eval-branch-question",
	"assistant: [eval#call_eval_a]",
	"tool call_eval_a: eval-branch-result",
	evalState,
];

test("a Side question after compaction sees the compacted history, kept turns, and the eval state persisted after it", async () => {
	const fixture = await sideQuestionFixture();
	try {
		const turn = history(fixture);
		turn.user("compacted-question");
		turn.assistant("", ["call_eval_old", "eval", { language: "python", code: "x = 1" }]);
		turn.result("call_eval_old", "eval", "compacted-eval-result");
		turn.assistant(`compacted-answer ${"detail ".repeat(40_000)}`);
		turn.user("kept-question");
		turn.assistant("kept-answer");
		await fixture.main.compact();

		expect(await firstSideRequest(fixture)).toEqual([
			expect.stringMatching(/^user: .*compacted-question.*compacted-eval-result.*compacted-answer/s),
			"user: kept-question",
			"assistant: kept-answer",
			evalState,
			"user: side-question-prompt",
		]);
	} finally { await fixture.dispose(); }
}, 30_000);

test("a Side question after a /tree jump to an eval branch and a prompt sees that branch, not the abandoned one", async () => {
	const fixture = await sideQuestionFixture();
	try {
		await backToEvalBranch(fixture);
		await fixture.main.prompt("after-the-jump");
		await fixture.main.waitForIdle();

		expect(await firstSideRequest(fixture)).toEqual([
			...evalBranch,
			"user: after-the-jump",
			"assistant: answered by main",
			"user: side-question-prompt",
		]);
	} finally { await fixture.dispose(); }
}, 30_000);

test("a Side question after a /tree jump with no new prompt follows the selected branch, not the file's last one", async () => {
	const fixture = await sideQuestionFixture();
	try {
		await backToEvalBranch(fixture);

		expect(await firstSideRequest(fixture)).toEqual([...evalBranch, "user: side-question-prompt"]);
	} finally { await fixture.dispose(); }
}, 30_000);

test("a pending main ask and bash stay open to the Side question, with no repeat and no failure", async () => {
	const fixture = await sideQuestionFixture();
	try {
		const turn = history(fixture);
		turn.user("pick-a-target");
		turn.assistant(
			"",
			["call_read", "read", { path: "deploy.md" }],
			["call_ask", "ask", { html: "<form><input type=\"radio\" name=\"target\" value=\"prod\"></form>" }],
			["call_bash", "bash", { command: "make build" }],
		);
		turn.result("call_read", "read", "deploy-notes");
		// Mid-turn, the main agent still holds the calls it waits on.
		fixture.main.agent.replaceMessages(turn.manager.buildSessionContext({ inFlightToolCallIds: new Set(["call_ask", "call_bash"]) }).messages);

		expect(await firstSideRequest(fixture)).toEqual([
			"user: pick-a-target",
			"assistant: [read#call_read, ask#call_ask, bash#call_bash]",
			"tool call_read: deploy-notes",
			"tool call_ask: The user is answering this question in the Picker now. The answer is not known here. Do not call ask again.",
			"tool call_bash: This call is still running in the main conversation. Its result is not known here. Do not call it again.",
			"user: side-question-prompt",
		]);
	} finally { await fixture.dispose(); }
}, 30_000);

test("a remote session handle in the registry makes Side questions unavailable without touching it", async () => {
	const fixture = await sideQuestionFixture();
	try {
		expect(sideQuestionsAvailable(fixture.ctx)).toBe(true);
		const reads: PropertyKey[] = [];
		const remote = new Proxy({ instanceKey: "worker-7:1", model: fixture.main.model }, {
			get(target, key) {
				reads.push(key);
				return Reflect.get(target, key);
			},
		}) as unknown as Parameters<AgentRegistry["attachSession"]>[1];
		const id = fixture.ctx.agent.id;
		expect(AgentRegistry.global().attachSession(id, remote)).toBe(true);

		expect(sideQuestionsAvailable(fixture.ctx)).toBe(false);
		await expect(fixture.open()).rejects.toThrow("Side questions need a saved main session.");
		expect(reads).toEqual([]);
		expect(fixture.requests).toEqual([]);
	} finally { await fixture.dispose(); }
}, 30_000);

test("a failed main model uses native fallback and reports recovery to the Side question", async () => {
	const fixture = await sideQuestionFixture({ fail: ["main"] });
	try {
		const events: unknown[] = [];
		const thread = await fixture.open();
		try {
			expect(await thread.ask("Answer briefly.", callbacks(events), AbortSignal.timeout(5_000))).toBe("answered by backup");
		} catch (error) {
			throw new Error(`${error}\nTransport trace: ${JSON.stringify(fixture.trace)}`, { cause: error });
		}
		expect([...new Set(fixture.requests.map(request => request.model))]).toEqual(["main", "backup"]);
		expect(events).toContainEqual(expect.objectContaining({ type: "retry_fallback_applied" }));
		expect(events).toContainEqual(expect.objectContaining({ type: "auto_retry_end", success: true }));
	} finally { await fixture.dispose(); }
}, 30_000);

test("a configured role keeps its thinking and fallback chain when default shares its model", async () => {
	const fixture = await sideQuestionFixture({ spec: "@smol:low", smol: "main", fail: ["main"], fallback: { default: [], smol: ["backup"] } });
	try {
		const events: unknown[] = [];
		const thread = await fixture.open();
		expect(await thread.ask("Answer briefly.", callbacks(events), AbortSignal.timeout(5_000))).toBe("answered by backup");
		expect(events).toContainEqual(expect.objectContaining({ type: "retry_fallback_applied", role: "smol" }));
		expect(fixture.requests[0]?.reasoning_effort).toBe("low");
		expect(fixture.main.model?.id).toBe("main");
	} finally { await fixture.dispose(); }
}, 30_000);

test("a Side question follows its role chain after the live main model failed and entered cooldown", async () => {
	const fixture = await sideQuestionFixture({ spec: "@smol", smol: "main", fail: ["main"], fallback: { default: [], smol: ["backup"] } });
	try {
		await fixture.main.prompt("Main request fails.");
		await fixture.main.waitForIdle();
		expect(fixture.main.getLastAssistantMessage()?.errorMessage).toContain("Retry budget exhausted after 1 retry");
		const thread = await fixture.open();
		expect(await thread.ask("Answer briefly.", callbacks(), AbortSignal.timeout(5_000))).toBe("answered by backup");
	} finally { await fixture.dispose(); }
}, 30_000);

test("persisted history that cannot fit the selected model uses the main model without losing its branch", async () => {
	const fixture = await sideQuestionFixture({ spec: "@smol", window: 1_024 });
	try {
		const turn = history(fixture);
		turn.user(`selected-branch ${"history ".repeat(8_000)}`);
		turn.assistant("selected-answer");
		const thread = await fixture.open();
		expect(await thread.ask("Answer briefly.", callbacks(), AbortSignal.timeout(5_000))).toBe("answered by main");
		expect(transcript(fixture.requests[0])).toEqual([
			expect.stringMatching(/^user: selected-branch (history ){8000}$/),
			"assistant: selected-answer",
			"user: Answer briefly.",
		]);
		expect(fixture.main.agent.state.messages).toHaveLength(2);
	} finally { await fixture.dispose(); }
}, 30_000);

test("Side question usage spends the shared main cost cap once and blocks the next thread", async () => {
	const fixture = await sideQuestionFixture({ maxCost: 0.0002 });
	try {
		await fixture.main.prompt("Main request.");
		await fixture.main.waitForIdle();
		const thread = await fixture.open();
		expect(await thread.ask("Side request.", callbacks(), AbortSignal.timeout(5_000))).toBe("answered by main");
		expect(fixture.main.costGate.spent).toBeCloseTo(0.00022, 10);
		const next = await fixture.open();
		const outcome = await next.ask("Must not be sent.", callbacks(), AbortSignal.timeout(5_000)).then(
			answer => ({ answer, error: undefined }),
			(error: unknown) => ({ answer: undefined, error }),
		);
		expect(fixture.requests).toHaveLength(2);
		expect(outcome.error).toBeInstanceOf(Error);
		expect((outcome.error as Error).message).toContain("Cost cap reached");
		expect(fixture.main.sessionManager.getEntries().filter(entry => entry.type === "model_usage" && entry.purpose === "side-question")).toHaveLength(1);
	} finally { await fixture.dispose(); }
}, 30_000);

test("new threads read their model setting with model defaults, role thinking, empty inheritance and one unresolved warning", async () => {
	const fixture = await sideQuestionFixture({ spec: "@smol" });
	const ask = async () => (await fixture.open()).ask("Answer briefly.", callbacks(), AbortSignal.timeout(5_000));
	try {
		expect(await ask()).toBe("answered by small");
		expect(fixture.requests.at(-1)?.reasoning_effort).toBe("low");
		fixture.settings.setModelRole("smol", `${fixture.route("small")}:high`);
		expect(await ask()).toBe("answered by small");
		expect(fixture.requests.at(-1)?.reasoning_effort).toBe("high");
		await fixture.setSpec("");
		expect(await ask()).toBe("answered by main");
		expect(fixture.requests.at(-1)?.reasoning_effort).toBe("high");
		await fixture.setSpec("missing-side-provider/no-such-side-model");
		const unresolved = await fixture.open();
		expect(await unresolved.ask("Answer briefly.", callbacks(), AbortSignal.timeout(5_000))).toBe("answered by main");
		expect(await unresolved.ask("And again.", callbacks(), AbortSignal.timeout(5_000))).toBe("answered by main");
		expect(fixture.warnings).toHaveLength(1);
		expect(fixture.main.model?.id).toBe("main");
		expect(fixture.main.configuredThinkingLevel()).toBe(parseConfiguredThinkingLevel("high"));
	} finally { await fixture.dispose(); }
}, 30_000);

test("the first Side question prompt is included in the selected model context boundary", async () => {
	const fixture = await sideQuestionFixture({ spec: "@smol", window: 32_000 });
	try {
		const thread = await fixture.open();
		expect(await thread.ask("current-side-prompt ".repeat(40_000), callbacks(), AbortSignal.timeout(5_000))).toBe("answered by main");
	} finally { await fixture.dispose(); }
}, 30_000);

test("an all-failing Side question exhausts native retry chains without cycling until cancellation", async () => {
	const fixture = await sideQuestionFixture({
		spec: "@smol:high",
		fail: ["main", "small", "backup"],
		fallback: { default: [], smol: ["backup"] },
	});
	try {
		const events: unknown[] = [];
		const thread = await fixture.open();
		const signal = AbortSignal.timeout(5_000);
		let failure: unknown;
		try {
			await thread.ask("Every configured model fails.", callbacks(events), signal);
		} catch (error) {
			failure = error;
		}
		if (signal.aborted) {
			throw new Error(`Side question kept running until cancellation. Models: ${JSON.stringify(fixture.requests.map(request => request.model))}. Recovery: ${JSON.stringify(events)}`, { cause: failure });
		}
		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toContain("Retry budget exhausted");
		expect(events).toContainEqual(expect.objectContaining({ type: "auto_retry_end", success: false, attempt: 1 }));
	} finally { await fixture.dispose(); }
}, 30_000);
