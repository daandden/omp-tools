import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import { englishCoachFixture } from "./helpers/english-coach-session";
import { writePluginSettings } from "./support";

const cleanups: (() => Promise<void>)[] = [];
beforeAll(async () => {
	await Settings.init({ inMemory: true });
	await initTheme();
});
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});
async function fixture(options: Parameters<typeof englishCoachFixture>[0] = {}) {
	const value = await englishCoachFixture(options);
	cleanups.push(value.dispose);
	return value;
}
async function until(predicate: () => boolean): Promise<void> {
	const end = Date.now() + 2000;
	while (!predicate()) {
		if (Date.now() > end) throw new Error("Timed out waiting for English coach");
		await Bun.sleep(5);
	}
}

test("a plain prompt reaches the main agent immediately and its private correction draws in both renderers", async () => {
	const answer = Promise.withResolvers<string>();
	const coach = await fixture({ reply: () => answer.promise });
	const original = "it not work";
	const image = { type: "image" as const, mimeType: "image/png", data: "image-not-for-the-coach" };
	const messages = [...coach.main.messages];
	const result = await coach.input(original, { images: [image] });
	expect(result).toEqual([undefined]);
	expect(coach.lines()).toEqual(["English coach", "Checking..."]);
	await until(() => coach.requests.length === 1);
	expect(coach.requests[0]!.model).toBe("small");
	expect(coach.requests[0]!.messages.filter((message: any) => message.role === "user")).toEqual([
		{ role: "user", content: original },
	]);
	expect(JSON.stringify(coach.requests)).not.toContain(image.data);
	expect(coach.requests[0]!.max_completion_tokens ?? coach.requests[0]!.max_tokens).toBe(800);
	expect(coach.requests[0]!.reasoning_effort).toBe("low");
	answer.resolve("Better: It doesn't work.\nit not work → It doesn't work (Missing auxiliary verb)");
	await until(() => coach.lines().some(line => line.startsWith("Better:")));
	expect(coach.lines()).toEqual([
		"English coach", "Better: It doesn't work.", "- it not work → It doesn't work (Missing auxiliary verb)",
	]);
	const native = JSON.stringify(coach.native());
	expect(native).toContain("English coach");
	expect(native).toContain("It doesn't work.");
	expect(native).toContain("omp.overlay.");
	expect(coach.writes.some(write => write.includes("omp-tools-english-coach"))).toBe(true);
	expect([...coach.placements.entries()]).toEqual([["omp-tools.english-coach", { placement: "aboveEditor" }]]);
	expect(coach.focus()).toBe(true);
	expect(coach.main.messages).toEqual(messages);
	const usage = coach.main.sessionManager.getEntries().filter(entry => entry.type === "model_usage");
	expect(usage).toMatchObject([{ purpose: "english-coach", model: "small", usage: { input: 100, output: 10 } }]);
});

test.each([
	["No mistakes", "No mistakes"],
	["Not English", "Not checked: no English text"],
	["Here is some advice.", "Check failed: unreadable reply"],
	["Better: This works.", "Check failed: unreadable reply"],
	["Better: This works. 😀\nthis work → This works (Agreement)", "Check failed: unreadable reply"],
])("the model outcome %j becomes a titled plain-text panel", async (reply, expected) => {
	const coach = await fixture({ reply: () => reply });
	await coach.input("this work");
	await until(() => !coach.lines().includes("Checking..."));
	expect(coach.lines()).toEqual(["English coach", expected]);
	expect(JSON.stringify(coach.native())).toContain(expected);
	expect(coach.focus()).toBe(true);
});

test("each actual mistake gets its own line", async () => {
	const coach = await fixture({ reply: () => "Better: A user enters the wrong password.\nuser → A user (Missing article)\ninput → enters (Word choice)" });
	await coach.input("user input wrong password");
	await until(() => !coach.lines().includes("Checking..."));
	expect(coach.lines()).toEqual([
		"English coach",
		"Better: A user enters the wrong password.",
		"- user → A user (Missing article)",
		"- input → enters (Word choice)",
	]);
});

test.each([
	{ source: "rpc" },
	{ source: "extension" },
	{ mode: "rpc" },
	{ mode: "print" },
	{ mode: "acp" },
	{ hasUI: false },
	{ agent: { id: "worker", kind: "task" } },
	{ text: "/model sonnet" },
])("noninteractive, non-main, or command input does not start coaching: %j", async options => {
	const coach = await fixture();
	const context = { ...coach.ctx, ...options } as typeof coach.ctx;
	expect(await coach.input(options.text ?? "this work", { source: options.source as "rpc" | "extension" | undefined ?? "interactive" }, context)).toEqual([undefined]);
	await Bun.sleep(25);
	expect(coach.requests).toEqual([]);
	expect(coach.lines()).toEqual([]);
});

test("the project's englishCoach override is reloaded on a session switch", async () => {
	const coach = await fixture({ settings: { englishCoach: false } });
	await coach.input("this work");
	await Bun.sleep(25);
	expect(coach.requests).toEqual([]);
	expect(coach.lines()).toEqual([]);
	writePluginSettings(coach.ctx.cwd, { englishCoach: true });
	await coach.emit("session_switch");
	await coach.input("this work");
	await until(() => coach.lines().includes("No mistakes"));
	expect(coach.requests).toHaveLength(1);
	writePluginSettings(coach.ctx.cwd, { englishCoach: false });
	await coach.emit("session_switch");
	await coach.input("this work");
	await Bun.sleep(25);
	expect(coach.requests).toHaveLength(1);
});

test("a missing tiny selector is refreshed once, warned once, and never uses the main model", async () => {
	const coach = await fixture();
	const provider = `coach-missing-${crypto.randomUUID()}`;
	let discoveries = 0;
	coach.main.modelRegistry.registerProvider(provider, {
		api: "openai-completions", apiKey: "fixture-key",
		fetchDynamicModels: async () => { discoveries++; return []; },
	});
	coach.settings.setModelRole("tiny", `${provider}/absent`);
	await coach.input("this work");
	await until(() => coach.lines().some(line => line.includes("has no model")));
	expect(coach.lines()[0]).toBe("English coach");
	expect(coach.lines().slice(1).join(" ")).toBe(`English coach: @tiny has no model (${provider}/absent). Coaching is off for this session.`);
	expect(discoveries).toBe(1);
	const renders = coach.renders();
	await coach.input("another sentence");
	await Bun.sleep(25);
	expect(discoveries).toBe(1);
	expect(coach.renders()).toBe(renders);
	expect(coach.requests).toEqual([]);
	expect(coach.focus()).toBe(true);
});

test("a provider refresh can find the tiny model without using the main model", async () => {
	const coach = await fixture();
	const small = coach.ctx.models.resolve("@tiny")!;
	const provider = `coach-discovery-${crypto.randomUUID()}`;
	let discoveries = 0;
	coach.main.modelRegistry.registerProvider(provider, {
		api: "openai-completions", apiKey: "fixture-key", baseUrl: small.baseUrl,
		fetchDynamicModels: async () => { discoveries++; return [{ ...small, id: "discovered", contextWindow: 128000, maxTokens: 4096 }]; },
	});
	coach.settings.setModelRole("tiny", `${provider}/discovered`);
	expect(coach.ctx.models.resolve("@tiny")).toBeUndefined();
	await coach.input("this work");
	await until(() => coach.lines().includes("No mistakes"));
	expect(coach.requests.map(body => body.model)).toEqual(["discovered"]);
	expect(discoveries).toBe(1);
});

test("credentials lost after tiny resolution warn once and never send a request", async () => {
	const coach = await fixture();
	const model = coach.ctx.models.resolve("@tiny")!;
	const credential = spyOn(coach.main.modelRegistry, "getApiKey").mockResolvedValue(undefined);
	try {
		await coach.input("this work");
		await until(() => coach.lines().some(line => line.includes("no credential")));
		expect(coach.lines()[0]).toBe("English coach");
		expect(coach.lines().slice(1).join(" ")).toBe(`English coach: @tiny has no credential (${model.provider}/${model.id}). Coaching is off for this session.`);
		await coach.input("another sentence");
		await Bun.sleep(25);
		expect(credential).toHaveBeenCalledTimes(1);
		expect(credential.mock.calls[0]![2]?.signal).toBeInstanceOf(AbortSignal);
		expect(coach.requests).toEqual([]);
	} finally {
		credential.mockRestore();
	}
});

test("a 301-token prompt is not sent, while a 300-token prompt is checked", async () => {
	const coach = await fixture();
	await coach.input(`${"a ".repeat(300)}a`);
	await until(() => coach.lines().includes("Not checked: over 300 tokens"));
	expect(coach.requests).toEqual([]);
	await coach.input(`${"a ".repeat(299)}a`);
	await until(() => coach.lines().includes("No mistakes"));
	expect(coach.requests).toHaveLength(1);
});

test("reasoning is disabled when the selected model permits it", async () => {
	const coach = await fixture();
	const small = coach.ctx.models.resolve("@tiny")!;
	const provider = `coach-optional-reasoning-${crypto.randomUUID()}`;
	coach.main.modelRegistry.registerProvider(provider, {
		api: "openai-completions", apiKey: "fixture-key", baseUrl: small.baseUrl,
		models: [{
			...small, id: "optional-reasoning", contextWindow: 128000, maxTokens: 4096,
			thinking: { ...small.thinking!, requiresEffort: false },
			compat: { supportsReasoningEffort: true, reasoningDisableMode: "none-effort" },
		}],
	});
	coach.settings.setModelRole("tiny", `${provider}/optional-reasoning`);
	await coach.input("This works.");
	await until(() => coach.lines().includes("No mistakes"));
	expect(coach.requests).toHaveLength(1);
	expect(coach.requests[0]!.reasoning_effort).toBe("none");
});

test("a provider error shows a plain-text failure and records its attempted usage", async () => {
	const coach = await fixture({ fail: ["small"] });
	await coach.input("this work");
	await until(() => coach.lines().some(line => line.startsWith("Check failed:")));
	expect(coach.lines()[0]).toBe("English coach");
	expect(coach.lines()[1]).toContain("fixture provider unavailable");
	expect(coach.main.sessionManager.getEntries().filter(entry => entry.type === "model_usage")).toMatchObject([
		{ purpose: "english-coach", model: "small", stopReason: "error" },
	]);
});

test("every completeSimple attempt is charged to the private English coach ledger", async () => {
	let attempts = 0;
	const coach = await fixture({ finishReason: () => ++attempts === 1 ? "repetition" : "stop" });
	await coach.input("This works.");
	await until(() => coach.lines().includes("No mistakes"));
	expect(coach.requests.map(body => body.model)).toEqual(["small", "small"]);
	expect(coach.main.sessionManager.getEntries().filter(entry => entry.type === "model_usage")).toMatchObject([
		{ purpose: "english-coach", model: "small", stopReason: "error", usage: { input: 100, output: 10 } },
		{ purpose: "english-coach", model: "small", stopReason: "stop", usage: { input: 100, output: 10 } },
	]);
	expect(coach.main.messages).toEqual([]);
});

test("usage is dropped when its initiating session changes while the provider is answering", async () => {
	const answer = Promise.withResolvers<string>();
	const coach = await fixture({ reply: () => answer.promise });
	await coach.input("This works.");
	await until(() => coach.requests.length === 1);
	const ledger = coach.main.sessionManager;
	ledger.newSession();
	const before = coach.renders();
	answer.resolve("No mistakes");
	await until(() => coach.renders() > before);
	expect(ledger.getEntries().filter(entry => entry.type === "model_usage")).toEqual([]);
});

test("credential service errors stay in the panel, without emoji or an input rejection", async () => {
	const coach = await fixture();
	const credential = spyOn(coach.main.modelRegistry, "getApiKey").mockRejectedValue(new Error("credential service unavailable ⚠️"));
	try {
		expect(await coach.input("This works.")).toEqual([undefined]);
		await until(() => coach.lines().some(line => line.startsWith("Check failed:")));
		expect(coach.lines()).toEqual(["English coach", "Check failed: credential service unavailable "]);
		expect(coach.requests).toEqual([]);
	} finally {
		credential.mockRestore();
	}
});

test("a one-character rewrite is a valid correction", async () => {
	const coach = await fixture({ reply: () => "Better: I\ni → I (Capitalization)" });
	await coach.input("i");
	await until(() => !coach.lines().includes("Checking..."));
	expect(coach.lines()).toEqual(["English coach", "Better: I", "- i → I (Capitalization)"]);
});

test("a project's token limit skips longer prompts and caps replies for prompts at or below the limit", async () => {
	const coach = await fixture({ settings: { englishCoachMaxTokens: 4 } });
	await coach.input("a a a a a");
	await until(() => !coach.lines().includes("Checking..."));
	expect(coach.lines()).toEqual(["English coach", "Not checked: over 4 tokens"]);
	expect(coach.requests).toEqual([]);
	await coach.input("a a a a");
	await until(() => coach.lines().includes("No mistakes"));
	expect(coach.requests).toHaveLength(1);
	expect(coach.requests[0]!.max_completion_tokens ?? coach.requests[0]!.max_tokens).toBe(208);
	await coach.input("a a a");
	await until(() => coach.lines().includes("No mistakes"));
	expect(coach.requests).toHaveLength(2);
});

test("a session switch reloads the token limit from the new project's plugin overrides", async () => {
	const coach = await fixture({ settings: { englishCoachMaxTokens: 4 } });
	await coach.input("a a a a");
	await until(() => coach.lines().includes("No mistakes"));
	expect(coach.requests[0]!.max_completion_tokens ?? coach.requests[0]!.max_tokens).toBe(208);
	const other = await fixture({ settings: { englishCoachMaxTokens: 6 } });
	const context = { ...coach.ctx, cwd: other.ctx.cwd };
	await coach.emit("session_switch", {}, context);
	await coach.input("a a a a a a a", {}, context);
	await until(() => !coach.lines().includes("Checking..."));
	expect(coach.lines()).toEqual(["English coach", "Not checked: over 6 tokens"]);
	expect(coach.requests).toHaveLength(1);
	await coach.input("a a a a a a", {}, context);
	await until(() => coach.lines().includes("No mistakes"));
	expect(coach.requests).toHaveLength(2);
	expect(coach.requests[1]!.max_completion_tokens ?? coach.requests[1]!.max_tokens).toBe(212);
});

test.each([0, -1, "4", null, true])("an invalid token limit %j warns once and disables coaching for the session", async limit => {
	const coach = await fixture({ settings: { englishCoachMaxTokens: limit } });
	await coach.input("This works.");
	await until(() => !coach.lines().includes("Checking..."));
	expect(coach.lines()[0]).toBe("English coach");
	expect(coach.lines().slice(1).join(" ")).toBe(
		"English coach: englishCoachMaxTokens must be a positive number. Coaching is off for this session.",
	);
	const renders = coach.renders();
	const widgets = [...coach.widgets.values()];
	await coach.input("Another sentence.");
	await Bun.sleep(25);
	expect(coach.requests).toEqual([]);
	expect(coach.renders()).toBe(renders);
	expect([...coach.widgets.values()]).toEqual(widgets);
});

describe("English coach submission cancellation", () => {
	test("a newer prompt aborts the pending request and keeps only its own outcome", async () => {
		const first = Promise.withResolvers<string>();
		const second = Promise.withResolvers<string>();
		const coach = await fixture({
			reply: body => body.messages.at(-1).content === "first prompt" ? first.promise : second.promise,
		});
		const credential = spyOn(coach.main.modelRegistry, "getApiKey");
		try {
			await coach.input("first prompt");
			await until(() => coach.requests.length === 1);
			const signal = credential.mock.calls[0]![2]!.signal!;
			expect(signal.aborted).toBe(false);
			expect(await coach.input("second prompt")).toEqual([undefined]);
			expect(signal.aborted).toBe(true);
			expect(coach.lines()).toEqual(["English coach", "Checking..."]);
			await until(() => coach.requests.length === 2);
			second.resolve("No mistakes");
			await until(() => coach.lines().includes("No mistakes"));
			first.resolve("Better: First prompt.\nfirst → First (Capitalization)");
			await Bun.sleep(30);
			expect(coach.lines()).toEqual(["English coach", "No mistakes"]);
		} finally {
			first.resolve("No mistakes");
			second.resolve("No mistakes");
			credential.mockRestore();
		}
	});

	test.each(["/model sonnet", "/btw", ""])("an unchecked submission %j aborts the request and removes its panel", async text => {
		const answer = Promise.withResolvers<string>();
		const coach = await fixture({ reply: () => answer.promise });
		const credential = spyOn(coach.main.modelRegistry, "getApiKey");
		try {
			await coach.input("pending prompt");
			await until(() => coach.requests.length === 1);
			const signal = credential.mock.calls[0]![2]!.signal!;
			expect(await coach.input(text)).toEqual([undefined]);
			expect(signal.aborted).toBe(true);
			expect(coach.lines()).toEqual([]);
			answer.resolve("No mistakes");
			await Bun.sleep(30);
			expect(coach.requests).toHaveLength(1);
			expect(coach.lines()).toEqual([]);
		} finally {
			answer.resolve("No mistakes");
			credential.mockRestore();
		}
	});

	test("an unchecked command ends a completed correction, and the next prompt opens a new panel", async () => {
		const coach = await fixture();
		await coach.input("This works.");
		await until(() => coach.lines().includes("No mistakes"));
		await coach.input("/model sonnet");
		expect(coach.lines()).toEqual([]);
		await coach.input("This also works.");
		expect(coach.lines()).toEqual(["English coach", "Checking..."]);
		await until(() => coach.lines().includes("No mistakes"));
		expect(coach.requests).toHaveLength(2);
	});

	test.each(["session_before_switch", "session_switch", "session_before_branch", "session_tree", "session_shutdown"])(
		"%s aborts the pending request and removes its panel without a late outcome",
		async event => {
			const answer = Promise.withResolvers<string>();
			const coach = await fixture({ reply: () => answer.promise });
			const credential = spyOn(coach.main.modelRegistry, "getApiKey");
			try {
				await coach.input("pending prompt");
				await until(() => coach.requests.length === 1);
				const signal = credential.mock.calls[0]![2]!.signal!;
				await coach.emit(event);
				expect(signal.aborted).toBe(true);
				expect(coach.lines()).toEqual([]);
				answer.resolve("No mistakes");
				await Bun.sleep(30);
				expect(coach.lines()).toEqual([]);
			} finally {
				answer.resolve("No mistakes");
				credential.mockRestore();
			}
		},
	);

	test("a session switch removes a completed outcome and permits a fresh panel", async () => {
		const coach = await fixture();
		await coach.input("This works.");
		await until(() => coach.lines().includes("No mistakes"));
		await coach.emit("session_switch");
		expect(coach.lines()).toEqual([]);
		await coach.input("This also works.");
		expect(coach.lines()).toEqual(["English coach", "Checking..."]);
		await until(() => coach.lines().includes("No mistakes"));
		expect(coach.requests).toHaveLength(2);
	});

	test("a synchronous panel failure is reported without rejecting input dispatch", async () => {
		const coach = await fixture();
		const widget = spyOn(coach.ctx.ui, "setWidget").mockImplementationOnce(() => {
			throw new Error("panel unavailable");
		});
		try {
			expect(await coach.input("This works.")).toEqual([undefined]);
			expect(coach.lines()).toEqual(["English coach", "Check failed: panel unavailable"]);
			expect(coach.requests).toEqual([]);
		} finally {
			widget.mockRestore();
		}
	});

	test("failure to remove an old panel is reported without rejecting input dispatch", async () => {
		const coach = await fixture();
		await coach.input("This works.");
		await until(() => coach.lines().includes("No mistakes"));
		const widget = spyOn(coach.ctx.ui, "setWidget").mockImplementationOnce(() => {
			throw new Error("panel cleanup failed");
		});
		try {
			expect(await coach.input("/model sonnet")).toEqual([undefined]);
			expect(coach.lines()).toEqual(["English coach", "Check failed: panel cleanup failed"]);
			expect(coach.requests).toHaveLength(1);
		} finally {
			widget.mockRestore();
		}
	});

	test("a cancelled credential lookup cannot warn or disable the next check", async () => {
		const lookup = Promise.withResolvers<string | undefined>();
		const coach = await fixture();
		const credential = spyOn(coach.main.modelRegistry, "getApiKey").mockImplementationOnce(() => lookup.promise);
		try {
			await coach.input("first prompt");
			expect(credential).toHaveBeenCalledTimes(1);
			const signal = credential.mock.calls[0]![2]!.signal!;
			await coach.input("second prompt");
			expect(signal.aborted).toBe(true);
			await until(() => coach.lines().includes("No mistakes"));
			lookup.resolve(undefined);
			await Bun.sleep(30);
			expect(coach.lines()).toEqual(["English coach", "No mistakes"]);
			await coach.input("third prompt");
			await until(() => coach.requests.length === 2 && coach.lines().includes("No mistakes"));
		} finally {
			lookup.resolve(undefined);
			credential.mockRestore();
		}
	});

	test("a cancelled credential error cannot replace the newest outcome", async () => {
		const lookup = Promise.withResolvers<string | undefined>();
		const coach = await fixture();
		const credential = spyOn(coach.main.modelRegistry, "getApiKey").mockImplementationOnce(() => lookup.promise);
		try {
			await coach.input("first prompt");
			await coach.input("second prompt");
			await until(() => coach.lines().includes("No mistakes"));
			lookup.reject(new Error("old credential error"));
			await Bun.sleep(30);
			expect(coach.lines()).toEqual(["English coach", "No mistakes"]);
			expect(coach.requests).toHaveLength(1);
		} finally {
			lookup.resolve(undefined);
			credential.mockRestore();
		}
	});

	test("a cancelled provider refresh cannot warn or disable the next check", async () => {
		const refresh = Promise.withResolvers<void>();
		const coach = await fixture();
		const tiny = coach.settings.getModelRole("tiny");
		coach.settings.setModelRole("tiny", "missing-coach-provider/absent");
		const discovery = spyOn(coach.main.modelRegistry, "refreshDiscoverableProviders").mockImplementationOnce(() => refresh.promise);
		try {
			await coach.input("first prompt");
			expect(discovery).toHaveBeenCalledTimes(1);
			coach.settings.setModelRole("tiny", tiny);
			await coach.input("second prompt");
			await until(() => coach.lines().includes("No mistakes"));
			refresh.resolve();
			await Bun.sleep(30);
			expect(coach.lines()).toEqual(["English coach", "No mistakes"]);
			expect(coach.requests).toHaveLength(1);
		} finally {
			refresh.resolve();
			discovery.mockRestore();
		}
	});
});

describe("bounded English coach panel", () => {
	test("a long classic correction keeps its first lines within forty percent of the terminal", async () => {
		const coach = await fixture({
			reply: () => `Better: A corrected prompt.\n${Array.from({ length: 24 }, (_, index) => `word${index} → correction${index} (Word choice)`).join("\n")}`,
		});
		await coach.input("please fix my wording");
		await until(() => !coach.lines().includes("Checking..."));
		expect(coach.lines()).toHaveLength(16);
		expect(coach.lines().slice(0, 3)).toEqual([
			"English coach", "Better: A corrected prompt.", "- word0 → correction0 (Word choice)",
		]);
		expect(coach.lines().at(-1)).toBe("… 11 more lines");
		expect(coach.focus()).toBe(true);
	});

	test("classic wraps a long rewrite before counting the hidden lines and reflows on resize", async () => {
		const rewrite = `Better: ${Array(20).fill("Please fix this sentence.").join(" ")}`;
		const coach = await fixture({ reply: () => `${rewrite}\nsentence → sentence (Word choice)` });
		await coach.input("please fix this sentence");
		await until(() => !coach.lines().includes("Checking..."));
		const panel = [...coach.widgets.values()][0]!;
		const narrow = panel.render(30);
		expect(narrow).toHaveLength(16);
		expect(narrow.slice(0, 3)).toEqual([
			"English coach", "Better: Please fix this", "sentence. Please fix this",
		]);
		expect(narrow.at(-1)).toBe("… 9 more lines");
		expect(narrow.every(line => Bun.stringWidth(line) <= 30)).toBe(true);
		expect(panel.render(1000)).toEqual(["English coach", rewrite, "- sentence → sentence (Word choice)"]);
	});

	test("Tern keeps the complete wrapped correction in a capped scroll box", async () => {
		const rewrite = `Better: ${Array(20).fill("Please fix this sentence.").join(" ")}`;
		const coach = await fixture({
			reply: () => `${rewrite}\n${Array.from({ length: 24 }, (_, index) => `word${index} → correction${index} (Word choice)`).join("\n")}`,
		});
		await coach.input("please fix my wording");
		await until(() => !coach.lines().includes("Checking..."));
		expect(coach.native()[0]).toMatchObject({
			k: "col",
			p: { role: "omp.overlay.btw", min: { w: 1 }, max: { w: 1 } },
			c: [
				{ k: "text" },
				{
					k: "list",
					p: { max: { lines: 10 } },
					c: [{
						k: "col",
						c: expect.arrayContaining([
							expect.objectContaining({ p: expect.objectContaining({ text: rewrite, wrap: "word" }) }),
							expect.objectContaining({ p: expect.objectContaining({ text: "- word23 → correction23 (Word choice)", wrap: "word" }) }),
						]),
					}],
				},
			],
		});
		expect(JSON.stringify(coach.native())).not.toContain("more lines");
		expect(coach.focus()).toBe(true);
	});
});
