import { expect, test } from "bun:test";
import { parseConfiguredThinkingLevel } from "@oh-my-pi/pi-tui/thinking";
import { callbacks, sideQuestionFixture } from "./helpers/side-question-session";

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

test("seeded live history that cannot fit the selected model uses the main model without losing its branch", async () => {
	const fixture = await sideQuestionFixture({ spec: "@smol", window: 1_024 });
	try {
		fixture.main.agent.replaceMessages([{ role: "user", content: `live-selected-branch ${"history ".repeat(8_000)}`, timestamp: 1 }]);
		const thread = await fixture.open();
		expect(await thread.ask("Answer briefly.", callbacks(), AbortSignal.timeout(5_000))).toBe("answered by main");
		expect(JSON.stringify(fixture.requests[0]?.messages)).toContain("live-selected-branch");
		expect(fixture.main.agent.state.messages).toHaveLength(1);
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
		expect(fixture.warnings[0]).toContain("could not be resolved");
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
