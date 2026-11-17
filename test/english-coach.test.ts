import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent";
import * as host from "@oh-my-pi/pi-coding-agent";
import { initTheme, theme } from "@oh-my-pi/pi-tui/theme";
import { CHECKING, CLEAN, englishCoachFixture, plainLines, title, TITLE, until } from "./helpers/english-coach-session";
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

test("a plain prompt reaches the main agent immediately and its private correction draws in both renderers", async () => {
	const answer = Promise.withResolvers<string>();
	const coach = await fixture({ reply: () => answer.promise });
	const original = "it not work";
	const image = { type: "image" as const, mimeType: "image/png", data: "image-not-for-the-coach" };
	const messages = [...coach.main.messages];
	const result = await coach.input(original, { images: [image] });
	expect(result).toEqual([undefined]);
	expect(coach.lines()).toEqual([CHECKING]);
	await until(() => coach.requests.length === 1);
	expect(coach.requests[0]!.model).toBe("small");
	expect(coach.requests[0]!.messages.filter((message: any) => message.role === "user")).toEqual([
		{ role: "user", content: original },
	]);
	expect(JSON.stringify(coach.requests)).not.toContain(image.data);
	expect(coach.requests[0]!.max_completion_tokens ?? coach.requests[0]!.max_tokens).toBe(800);
	expect(coach.requests[0]!.reasoning_effort).toBe("low");
	answer.resolve("Better: It doesn't work.\nit not work → It doesn't work (Missing auxiliary verb)");
	await until(() => coach.lines()[0] === title("1 fix"));
	expect(coach.lines()).toEqual([
		title("1 fix"), "it not doesn't work.", "- it not work → It doesn't work (Missing auxiliary verb)",
	]);
	expect(coach.nativeText()).toEqual(["English coach · 1 fix", "it not doesn't work."]);
	expect(coach.nativeHovers()).toEqual([
		{ text: "not doesn't", title: "not → doesn't: Missing auxiliary verb" },
	]);
	expect(coach.nativeSpans()[1]).toEqual([
		{ t: "it " }, { t: "not", s: "del" }, { t: " " }, { t: "doesn't", s: "ins" }, { t: " work" }, { t: ".", s: "ins" },
	]);
	expect([...coach.placements.entries()]).toEqual([["omp-tools.english-coach", { placement: "aboveEditor" }]]);
	expect(coach.focus()).toBe(true);
	expect(coach.main.messages).toEqual(messages);
	const usage = coach.main.sessionManager.getEntries().filter(entry => entry.type === "model_usage");
	expect(usage).toMatchObject([{ purpose: "english-coach", model: "small", usage: { input: 100, output: 10 } }]);
});

test.each([
	["No mistakes", [CLEAN], "English coach · no mistakes"],
	["Not English", [TITLE, "Not checked: no English text"], "Not checked: no English text"],
	["Here is some advice.", [TITLE, "Check failed: unreadable reply"], "Check failed: unreadable reply"],
	["Better: This works.", [TITLE, "Check failed: unreadable reply"], "Check failed: unreadable reply"],
	["Better: This works. 😀\nthis work → This works (Agreement)", [TITLE, "Check failed: unreadable reply"], "Check failed: unreadable reply"],
])("the model outcome %j becomes a titled plain-text panel", async (reply, expected, native) => {
	const coach = await fixture({ reply: () => reply });
	await coach.input("this work");
	await until(() => !coach.lines().includes(CHECKING));
	expect(coach.lines()).toEqual(expected);
	expect(coach.nativeText()).toContain(native);
	expect(coach.focus()).toBe(true);
});

test("each change explains its own mistake: listed in classic, on hover in Tern", async () => {
	const coach = await fixture({ reply: () => "Better: A user enters the wrong password.\nuser → A user (Missing article)\ninput → enters (Word choice)" });
	await coach.input("user input wrong password");
	await until(() => !coach.lines().includes(CHECKING));
	expect(coach.lines()).toEqual([
		title("2 fixes"),
		"A user input enters the wrong password.",
		"- user → A user (Missing article)",
		"- input → enters (Word choice)",
	]);
	expect(coach.nativeText()).toEqual(["English coach · 2 fixes", "A user input enters the wrong password."]);
	expect(coach.nativeHovers()).toEqual([
		{ text: "A", title: "+ A: Missing article" },
		{ text: "input enters the", title: "input → enters the: Word choice" },
	]);
});

test("a mistake no change carries is listed under the prompt in Tern", async () => {
	const coach = await fixture({ reply: () => "Better: It works.\nit work → It works (Agreement)\nfoo → bar (Spelling)" });
	await coach.input("it work");
	await until(() => !coach.lines().includes(CHECKING));
	expect(coach.nativeText()).toEqual(["English coach · 2 fixes", "it work works.", "foo → bar (Spelling)"]);
	expect(coach.nativeHovers().map(hover => hover.title)).toEqual(["work → works.: Agreement"]);
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
	await until(() => coach.lines().includes(CLEAN));
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
	expect(coach.lines()[0]).toBe(TITLE);
	expect(coach.lines().slice(1).join(" ")).toBe(`@tiny has no model (${provider}/absent). Coaching is off for this session.`);
	expect(discoveries).toBe(1);
	const renders = coach.renders();
	await coach.input("another sentence");
	await Bun.sleep(25);
	expect(discoveries).toBe(1);
	expect(coach.renders()).toBe(renders);
	expect(coach.requests).toEqual([]);
	expect(coach.lines()).toEqual([]);
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
	await until(() => coach.lines().includes(CLEAN));
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
		expect(coach.lines()[0]).toBe(TITLE);
		expect(coach.lines().slice(1).join(" ")).toBe(`@tiny has no credential (${model.provider}/${model.id}). Coaching is off for this session.`);
		await coach.input("another sentence");
		expect(coach.lines()).toEqual([]);
		await Bun.sleep(25);
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
	await until(() => coach.lines().includes(CLEAN));
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
	await until(() => coach.lines().includes(CLEAN));
	expect(coach.requests).toHaveLength(1);
	expect(coach.requests[0]!.reasoning_effort).toBe("none");
});

test("a provider error shows a plain-text failure and records its attempted usage", async () => {
	const coach = await fixture({ fail: ["small"] });
	await coach.input("this work");
	await until(() => coach.lines().some(line => line.startsWith("Check failed:")));
	expect(coach.lines()[0]).toBe(TITLE);
	expect(coach.lines()[1]).toContain("fixture provider unavailable");
	expect(coach.main.sessionManager.getEntries().filter(entry => entry.type === "model_usage")).toMatchObject([
		{ purpose: "english-coach", model: "small", stopReason: "error" },
	]);
});

test("every completeSimple attempt is charged to the private English coach ledger", async () => {
	let attempts = 0;
	const coach = await fixture({ finishReason: () => ++attempts === 1 ? "repetition" : "stop" });
	await coach.input("This works.");
	await until(() => coach.lines().includes(CLEAN));
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
		expect(coach.lines()).toEqual([TITLE, "Check failed: credential service unavailable "]);
		expect(coach.requests).toEqual([]);
	} finally {
		credential.mockRestore();
	}
});

test("a one-character rewrite is a valid correction", async () => {
	const coach = await fixture({ reply: () => "Better: a\nan → a (Article)" });
	await coach.input("an");
	await until(() => !coach.lines().includes(CHECKING));
	expect(coach.lines()).toEqual([title("1 fix"), "an a", "- an → a (Article)"]);
	expect(coach.nativeSpans()[1]).toEqual([{ t: "an", s: "del" }, { t: " " }, { t: "a", s: "ins" }]);
});

test("capitalization is never corrected: case-only mistakes are no mistakes, and case changes beside a real fix stay as typed", async () => {
	const clean = await fixture({ reply: () => "Better: I use Git Diff.\ni → I (Capitalization)\ngit diff → Git Diff (Capitalization)" });
	await clean.input("i use git diff.");
	await until(() => !clean.lines().includes(CHECKING));
	expect(clean.lines()).toEqual([CLEAN]);
	const mixed = await fixture({ reply: () => "Better: It fails in Git Diff.\nit fail → It fails (Agreement)" });
	await mixed.input("it fail in git diff");
	await until(() => !mixed.lines().includes(CHECKING));
	expect(mixed.nativeText()).toEqual(["English coach · 1 fix", "it fail fails in git diff."]);
	expect(mixed.nativeHovers()).toEqual([{ text: "fail fails", title: "fail → fails: Agreement" }]);
});

test("a project's token limit skips longer prompts and caps replies for prompts at or below the limit", async () => {
	const coach = await fixture({ settings: { englishCoachMaxTokens: 4 } });
	await coach.input("a a a a a");
	await until(() => !coach.lines().includes(CHECKING));
	expect(coach.lines()).toEqual([TITLE, "Not checked: over 4 tokens"]);
	expect(coach.requests).toEqual([]);
	await coach.input("a a a a");
	await until(() => coach.lines().includes(CLEAN));
	expect(coach.requests).toHaveLength(1);
	expect(coach.requests[0]!.max_completion_tokens ?? coach.requests[0]!.max_tokens).toBe(208);
	await coach.input("a a a");
	await until(() => coach.lines().includes(CLEAN));
	expect(coach.requests).toHaveLength(2);
});

test("a session switch reloads the token limit from the new project's plugin overrides", async () => {
	const coach = await fixture({ settings: { englishCoachMaxTokens: 4 } });
	await coach.input("a a a a");
	await until(() => coach.lines().includes(CLEAN));
	expect(coach.requests[0]!.max_completion_tokens ?? coach.requests[0]!.max_tokens).toBe(208);
	const other = await fixture({ settings: { englishCoachMaxTokens: 6 } });
	const context = { ...coach.ctx, cwd: other.ctx.cwd };
	await coach.emit("session_switch", {}, context);
	await coach.input("a a a a a a a", {}, context);
	await until(() => !coach.lines().includes(CHECKING));
	expect(coach.lines()).toEqual([TITLE, "Not checked: over 6 tokens"]);
	expect(coach.requests).toHaveLength(1);
	await coach.input("a a a a a a", {}, context);
	await until(() => coach.lines().includes(CLEAN));
	expect(coach.requests).toHaveLength(2);
	expect(coach.requests[1]!.max_completion_tokens ?? coach.requests[1]!.max_tokens).toBe(212);
});

test.each([0, -1, "4", null, true])("an invalid token limit %j warns once and disables coaching for the session", async limit => {
	const coach = await fixture({ settings: { englishCoachMaxTokens: limit } });
	expect(coach.lines()).toEqual([
		TITLE,
		"englishCoachMaxTokens must be a positive number. Coaching is off for this session.",
	]);
	expect(coach.requests).toEqual([]);
	await coach.input("This works.");
	expect(coach.lines()).toEqual([]);
	const renders = coach.renders();
	await coach.input("Another sentence.");
	await Bun.sleep(25);
	expect(coach.requests).toEqual([]);
	expect(coach.renders()).toBe(renders);
	expect(coach.lines()).toEqual([]);
});

test.each([
	[undefined, "Vietnamese"],
	["Japanese", "Japanese"],
])("pattern names are asked for in the englishCoachLanguage %j", async (setting, language) => {
	const coach = await fixture({ settings: setting === undefined ? {} : { englishCoachLanguage: setting } });
	await coach.input("this work");
	await until(() => coach.lines().includes(CLEAN));
	const system = JSON.stringify(coach.requests[0]!.messages.filter((message: any) => message.role !== "user"));
	expect(system).toContain(`Write each pattern name in ${language}`);
	expect(system).not.toContain("{{language}}");
});

test.each(["", "  ", 3])("an invalid englishCoachLanguage %j warns once and disables coaching for the session", async setting => {
	const coach = await fixture({ settings: { englishCoachLanguage: setting } });
	expect(coach.lines()).toEqual([TITLE, "englishCoachLanguage must name a language. Coaching is off for this session."]);
	await coach.input("This works.");
	await Bun.sleep(25);
	expect(coach.requests).toEqual([]);
});

describe("English coach submission cancellation", () => {
	test("a newer prompt aborts the pending request and keeps only its own outcome", async () => {
		const first = Promise.withResolvers<string>();
		const second = Promise.withResolvers<string>();
		const coach = await fixture({
			reply: body => body.messages.at(-1).content === "first prompt" ? first.promise : second.promise,
		});
		try {
			await coach.input("first prompt");
			await until(() => coach.requests.length === 1);
			expect(coach.abortedRequests).toEqual([]);
			expect(await coach.input("second prompt")).toEqual([undefined]);
			expect(coach.lines()).toEqual([CHECKING]);
			await until(() => coach.requests.length === 2 && coach.abortedRequests.length === 1);
			expect(coach.abortedRequests[0]!.messages.at(-1).content).toBe("first prompt");
			second.resolve("No mistakes");
			await until(() => coach.lines().includes(CLEAN));
			first.resolve("Better: First prompt.\nfirst → First (Capitalization)");
			await Bun.sleep(30);
			expect(coach.lines()).toEqual([CLEAN]);
		} finally {
			first.resolve("No mistakes");
			second.resolve("No mistakes");
		}
	});

	test.each(["/model sonnet", "/btw", ""])("an unchecked submission %j aborts the request and removes its panel", async text => {
		const answer = Promise.withResolvers<string>();
		const coach = await fixture({ reply: () => answer.promise });
		try {
			await coach.input("pending prompt");
			await until(() => coach.requests.length === 1);
			expect(await coach.input(text)).toEqual([undefined]);
			await until(() => coach.abortedRequests.length === 1);
			expect(coach.lines()).toEqual([]);
			answer.resolve("No mistakes");
			await Bun.sleep(30);
			expect(coach.requests).toHaveLength(1);
			expect(coach.lines()).toEqual([]);
		} finally {
			answer.resolve("No mistakes");
		}
	});

	test("an unchecked command ends a completed correction, and the next prompt opens a new panel", async () => {
		const coach = await fixture();
		await coach.input("This works.");
		await until(() => coach.lines().includes(CLEAN));
		await coach.input("/model sonnet");
		expect(coach.lines()).toEqual([]);
		await coach.input("This also works.");
		expect(coach.lines()).toEqual([CHECKING]);
		await until(() => coach.lines().includes(CLEAN));
		expect(coach.requests).toHaveLength(2);
	});

	test.each(["session_before_switch", "session_switch", "session_before_branch", "session_tree", "session_shutdown"])(
		"%s aborts the pending request and removes its panel without a late outcome",
		async event => {
			const answer = Promise.withResolvers<string>();
			const coach = await fixture({ reply: () => answer.promise });
			try {
				await coach.input("pending prompt");
				await until(() => coach.requests.length === 1);
				await coach.emit(event);
				await until(() => coach.abortedRequests.length === 1);
				expect(coach.lines()).toEqual([]);
				answer.resolve("No mistakes");
				await Bun.sleep(30);
				expect(coach.lines()).toEqual([]);
			} finally {
				answer.resolve("No mistakes");
			}
		},
	);

	test("a session switch removes a completed outcome and permits a fresh panel", async () => {
		const coach = await fixture();
		await coach.input("This works.");
		await until(() => coach.lines().includes(CLEAN));
		await coach.emit("session_switch");
		expect(coach.lines()).toEqual([]);
		await coach.input("This also works.");
		expect(coach.lines()).toEqual([CHECKING]);
		await until(() => coach.lines().includes(CLEAN));
		expect(coach.requests).toHaveLength(2);
	});

	test("a synchronous panel failure is reported without rejecting input dispatch", async () => {
		const coach = await fixture();
		const widget = spyOn(coach.ctx.ui, "setWidget").mockImplementationOnce(() => {
			throw new Error("panel unavailable");
		});
		try {
			expect(await coach.input("This works.")).toEqual([undefined]);
			expect(coach.lines()).toEqual([TITLE, "Check failed: panel unavailable"]);
			expect(coach.requests).toEqual([]);
		} finally {
			widget.mockRestore();
		}
	});

	test("a failure panel error reports both failures as a warning without rejecting input", async () => {
		const coach = await fixture();
		const widget = spyOn(coach.ctx.ui, "setWidget")
			.mockImplementationOnce(() => { throw new Error("checking panel unavailable"); })
			.mockImplementationOnce(() => { throw new Error("failure panel unavailable"); });
		const notification = spyOn(coach.ctx.ui, "notify");
		try {
			expect(await coach.input("This works.")).toEqual([undefined]);
			expect(notification).toHaveBeenCalledWith(
				"English coach: Check failed: checking panel unavailable. Could not show failure: failure panel unavailable",
				"warning",
			);
			expect(coach.lines()).toEqual([]);
			expect(coach.requests).toEqual([]);
		} finally {
			widget.mockRestore();
			notification.mockRestore();
		}
	});

	test("failure to remove an old panel is reported without rejecting input dispatch", async () => {
		const coach = await fixture();
		await coach.input("This works.");
		await until(() => coach.lines().includes(CLEAN));
		const widget = spyOn(coach.ctx.ui, "setWidget").mockImplementationOnce(() => {
			throw new Error("panel cleanup failed");
		});
		try {
			expect(await coach.input("/model sonnet")).toEqual([undefined]);
			expect(coach.lines()).toEqual([TITLE, "Check failed: panel cleanup failed"]);
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
			await coach.input("second prompt");
			await until(() => coach.lines().includes(CLEAN));
			lookup.resolve(undefined);
			await Bun.sleep(30);
			expect(coach.lines()).toEqual([CLEAN]);
			await coach.input("third prompt");
			await until(() => coach.requests.length === 2 && coach.lines().includes(CLEAN));
			expect(coach.lines()).toEqual([CLEAN]);
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
			await until(() => coach.lines().includes(CLEAN));
			lookup.reject(new Error("old credential error"));
			await Bun.sleep(30);
			expect(coach.lines()).toEqual([CLEAN]);
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
			await until(() => coach.lines().includes(CLEAN));
			refresh.resolve();
			await Bun.sleep(30);
			expect(coach.lines()).toEqual([CLEAN]);
			expect(coach.requests).toHaveLength(1);
		} finally {
			refresh.resolve();
			discovery.mockRestore();
		}
	});
});

describe("bounded English coach panel", () => {
	const input = Array.from({ length: 24 }, (_, index) => `fix word${index}`).join("\n");
	const reply = `Better: ${Array.from({ length: 24 }, (_, index) => `fix correction${index}`).join(" ")}\n${
		Array.from({ length: 24 }, (_, index) => `word${index} → correction${index} (Word choice)`).join("\n")
	}`;

	test("a long classic correction keeps its first lines within forty percent of the terminal", async () => {
		const coach = await fixture({ reply: () => reply });
		await coach.input(input);
		await until(() => !coach.lines().includes(CHECKING));
		expect(coach.lines()).toHaveLength(16);
		expect(coach.lines().slice(0, 3)).toEqual([title("24 fixes"), "fix word0 correction0", "fix word1 correction1"]);
		expect(coach.lines().at(-1)).toBe("… 34 more lines");
		expect(coach.focus()).toBe(true);
	});

	test("classic wraps a long rewrite before counting the hidden lines and reflows on resize", async () => {
		const prompt = Array(20).fill("please fix this sentence.").join(" ");
		const coach = await fixture({ reply: () => `Better: ${prompt.replaceAll("please", "kindly")}\nplease → kindly (Word choice)` });
		await coach.input(prompt);
		await until(() => !coach.lines().includes(CHECKING));
		const panel = [...coach.widgets.values()][0]!;
		const narrow = plainLines(panel, 30);
		expect(narrow).toHaveLength(16);
		expect(narrow.slice(0, 3)).toEqual([title("1 fix", 30), "please kindly fix this", "sentence. please kindly fix"]);
		expect(narrow.at(-1)).toBe("… 13 more lines");
		expect(narrow.every(line => Bun.stringWidth(line) <= 30)).toBe(true);
		expect(plainLines(panel, 1000)).toEqual([
			title("1 fix", 1000), Array(20).fill("please kindly fix this sentence.").join(" "), "- please → kindly (Word choice)",
		]);
	});

	test("Tern retains the full correction text when classic truncates it", async () => {
		const coach = await fixture({ reply: () => reply });
		await coach.input(input);
		await until(() => !coach.lines().includes(CHECKING));
		const native = coach.nativeText();
		expect(native).toContain("fix word0 correction0");
		expect(native).toContain("fix word23 correction23");
		expect(coach.nativeHovers().at(-1)?.title).toBe("word23 → correction23: Word choice");
		expect(native.some(line => line.includes("more lines"))).toBe(false);
		expect(coach.focus()).toBe(true);
	});
});

describe("closing the English coach panel", () => {
	test("Esc from an empty main editor closes the panel and cancels a running check", async () => {
		const answer = Promise.withResolvers<string>();
		const coach = await fixture({ reply: () => answer.promise });
		await coach.input("it not work");
		await until(() => coach.requests.length === 1);
		expect(coach.key("\x1b")).toBe(true);
		expect(coach.widgets.size).toBe(0);
		answer.resolve("Better: It doesn't work.\nit not work → It doesn't work (Missing auxiliary verb)");
		await Bun.sleep(20);
		expect(coach.widgets.size).toBe(0);
		expect(coach.key("\x1b")).toBe(false);
	});

	test("Esc keeps the panel while the editor has text or another component has focus", async () => {
		const coach = await fixture();
		await coach.input("this work");
		await until(() => coach.lines().includes(CLEAN));
		coach.type("draft");
		expect(coach.key("\x1b")).toBe(false);
		coach.type("");
		coach.focusElsewhere();
		expect(coach.key("\x1b")).toBe(false);
		expect(coach.lines()).toEqual([CLEAN]);
	});

	test("clicking the Tern esc hint closes the panel", async () => {
		const coach = await fixture();
		await coach.input("this work");
		await until(() => coach.lines().includes(CLEAN));
		[...coach.widgets.values()][0]!.handleNativeEvent!({ type: "action", key: "close", act: "close", mods: [] });
		expect(coach.widgets.size).toBe(0);
	});
});

test("Tern paints the panel with the active omp theme, scoped to omp-tools panels", async () => {
	const coach = await fixture({ reply: () => "Better: It doesn't work.\nit not work → It doesn't work (Missing auxiliary verb)" });
	await coach.input("it not work");
	await until(() => coach.lines()[0] === title("1 fix"));
	coach.nativeText();
	const sheet = coach.writes.findLast(data => data.startsWith("\x1b_tsp;s;"))!;
	const { name, css } = JSON.parse(sheet.slice("\x1b_tsp;s;".length, -2)) as { name: string; css: string };
	expect(name).toBe("omp-tools-english-coach");
	expect(css).toContain(":has([data-role^='omp-tools.'])");
	expect(css).toContain(`background: ${theme.getBgHex("selectedBg")};`);
	expect(css).toContain(`--sf-c-ins: ${theme.getColorHex("toolDiffAdded")};`);
	expect(css).toContain(`--sf-c-del: ${theme.getColorHex("toolDiffRemoved")};`);
	expect(css).toContain(`--sf-c-accent: ${theme.getColorHex("accent")};`);
});

describe("protected code and links", () => {
	test("a reply that drops protected text fails once and records its usage", async () => {
		const coach = await fixture({
			reply: () => "Better: It fails.\n- it fail → It fails (Agreement)",
		});
		expect(await coach.input("it fail in src/private.ts")).toEqual([undefined]);
		await until(() => !coach.lines().includes(CHECKING));
		expect(coach.lines()).toEqual([TITLE, "Check failed: unreadable reply"]);
		expect(coach.requests).toHaveLength(1);
		expect(coach.main.sessionManager.getEntries().filter(entry => entry.type === "model_usage")).toMatchObject([
			{ purpose: "english-coach", model: "small", usage: { input: 100, output: 10 } },
		]);
	});

	test.each([
		["repeated", "Better: It fails in [[COACH_1]] and [[COACH_1]].\n- it fail → It fails (Agreement)"],
		["invented rewrite", "Better: It fails in [[COACH_1]] and [[COACH_99]].\n- it fail → It fails (Agreement)"],
		["invented mistake", "Better: It fails in [[COACH_1]].\n- it fail [[COACH_99]] → It fails (Agreement)"],
	])("a %s placeholder fails without showing a partial correction", async (_kind, reply) => {
		const coach = await fixture({ reply: () => reply });
		await coach.input("it fail in src/private.ts");
		await until(() => !coach.lines().includes(CHECKING));
		expect(coach.lines()).toEqual([TITLE, "Check failed: unreadable reply"]);
		expect(coach.requests).toHaveLength(1);
	});

	test("reordered protected text fails rather than changing the prompt's meaning", async () => {
		const coach = await fixture({
			reply: () => "Better: It fails from [[COACH_2]] to [[COACH_1]].\n- it fail → It fails (Agreement)",
		});
		await coach.input("it fail from src/first.ts to src/second.ts");
		await until(() => !coach.lines().includes(CHECKING));
		expect(coach.lines()).toEqual([TITLE, "Check failed: unreadable reply"]);
		expect(coach.requests).toHaveLength(1);
	});

	test("code, paths, and URLs stay out of the request and return verbatim in corrections", async () => {
		const coach = await fixture({
			reply: body => {
				const input = body.messages.find((message: any) => message.role === "user").content as string;
				return `Better: ${input.replace("it fail", "It fails")}\n${input} → ${input.replace("it fail", "It fails")} (Agreement)`;
			},
		});
		const input = "it fail with `secretCall()` in src/private.ts at https://private.example/token";
		expect(await coach.input(input)).toEqual([undefined]);
		await until(() => !coach.lines().includes(CHECKING));
		expect(coach.requests).toHaveLength(1);
		const request = JSON.stringify(coach.requests[0]);
		for (const secret of ["secretCall", "src/private.ts", "private.example", "/token"]) {
			expect(request).not.toContain(secret);
		}
		const fixed = "It fails with `secretCall()` in src/private.ts at https://private.example/token";
		const corrected = "it fail fails with `secretCall()` in src/private.ts at https://private.example/token";
		const panel = [...coach.widgets.values()][0]!;
		expect(plainLines(panel, 1000)).toEqual([title("1 fix", 1000), corrected, `- ${input} → ${fixed} (Agreement)`]);
		const narrow = plainLines(panel, 30);
		expect(narrow.every(line => Bun.stringWidth(line) <= 30)).toBe(true);
		expect(narrow.length).toBeLessThanOrEqual(16);
		expect(coach.nativeText()).toContain(corrected);
		expect(coach.nativeSpans()[1]!.filter(span => span.s === "dim").map(span => span.t)).toEqual([
			"`secretCall()`", "src/private.ts", "https://private.example/token",
		]);
	});

	test("a short sentence above a large fenced paste is checked and shows one counted marker line", async () => {
		const coach = await fixture({
			settings: { englishCoachMaxTokens: 4 },
			reply: body => {
				const input = body.messages.find((message: any) => message.role === "user").content as string;
				return `Better: ${input.replace("it fail", "It fails").replace(/\s+/g, " ")}\nit fail → It fails (Agreement)`;
			},
		});
		await coach.input(`it fail\n\`\`\`typescript\n${"const privateSecret = 123;\n".repeat(1000)}\`\`\``);
		await until(() => !coach.lines().includes(CHECKING));
		expect(coach.requests).toHaveLength(1);
		expect(JSON.stringify(coach.requests)).not.toContain("privateSecret");
		expect(JSON.stringify(coach.requests)).not.toContain("typescript");
		expect(coach.lines()).toEqual([title("1 fix"), "it fail fails", "[code block, 1000 lines]", "- it fail → It fails (Agreement)"]);
		expect(coach.nativeText()).toEqual(["English coach · 1 fix", "it fail fails", "[code block, 1000 lines]"]);
		expect(coach.nativeHovers().map(hover => hover.title)).toEqual(["fail → fails: Agreement"]);
	});

	test.each([
		"`onlyCode()`",
		"src/private.ts https://private.example/token",
		"```ts\nonlyCode();\n```",
		"`onlyCode()` /Users/private/file.ts C:\\private\\file.ts",
	])("protected-only input %j skips the model and names the reason", async input => {
		const coach = await fixture();
		await coach.input(input);
		await until(() => !coach.lines().includes(CHECKING));
		expect(coach.requests).toEqual([]);
		expect(coach.lines()).toEqual([TITLE, "Not checked: no English text"]);
	});

	test("protected-only input cancels an unfinished check without showing its late correction", async () => {
		const answer = Promise.withResolvers<string>();
		const coach = await fixture({ reply: () => answer.promise });
		try {
			await coach.input("pending prompt");
			await until(() => coach.requests.length === 1);
			expect(await coach.input("```ts\nprivateSecret();\n```")).toEqual([undefined]);
			await until(() => coach.abortedRequests.length === 1);
			expect(coach.lines()).toEqual([TITLE, "Not checked: no English text"]);
			answer.resolve("Better: Pending prompt.\npending → Pending (Capitalization)");
			await Bun.sleep(30);
			expect(coach.requests).toHaveLength(1);
			expect(coach.lines()).toEqual([TITLE, "Not checked: no English text"]);
		} finally {
			answer.resolve("No mistakes");
		}
	});

	test("expanded pasted prose counts in full rather than as a compact paste chip", async () => {
		const coach = await fixture();
		await coach.input("This is the complete expanded prose from a large paste.\n".repeat(500));
		await until(() => !coach.lines().includes(CHECKING));
		expect(coach.requests).toEqual([]);
		expect(coach.lines()).toEqual([TITLE, "Not checked: over 300 tokens"]);
	});

	test("protected text and its placeholder tokens do not consume the English budget", async () => {
		const coach = await fixture({ settings: { englishCoachMaxTokens: 4 } });
		await coach.input(`it fail ${"`privateCode()` ".repeat(30)}${"src/private.ts ".repeat(30)}https://private.example/${"secret".repeat(1000)}`);
		await until(() => !coach.lines().includes(CHECKING));
		expect(coach.requests).toHaveLength(1);
		expect(JSON.stringify(coach.requests)).not.toContain("secret");
		expect(coach.lines()).toEqual([CLEAN]);
	});

	test.each([
		["``privateCode(\n`nested`)\n``", "privateCode"],
		["C:\\private\\file.ts \\\\server\\secret\\file.ts relative\\secret\\file.ts", "secret"],
		["www.private.example/secret", "private"],
	])("protected form %j stays out of the request and returns exactly", async (protectedText, secret) => {
		const coach = await fixture({
			reply: body => {
				const input = body.messages.find((message: any) => message.role === "user").content as string;
				return `Better: ${input.replace("it fail", "It fails")}\nit fail → It fails (Agreement)`;
			},
		});
		await coach.input(`it fail ${protectedText}`);
		await until(() => !coach.lines().includes(CHECKING));
		expect(JSON.stringify(coach.requests)).not.toContain(secret);
		expect(coach.lines()).toEqual([title("1 fix"), ...`it fail fails ${protectedText}`.split("\n"), "- it fail → It fails (Agreement)"]);
	});

	test.each([
		["~~~js\r\nprivateSecret();\r\nnext();\r\n~~~", 2],
		["````js\nprivateSecret();\n```\n````", 2],
		["```js\nprivateSecret();", 1],
		["```js\n```", 0],
		["```js\n\n```", 1],
	])("fenced form %j restores its line count without exposing the block", async (block, count) => {
		const coach = await fixture({
			reply: body => {
				const input = body.messages.find((message: any) => message.role === "user").content as string;
				return `Better: ${input.replace("it fail", "It fails").replace(/\s+/g, " ")}\nit fail → It fails (Agreement)`;
			},
		});
		await coach.input(`it fail\n${block}`);
		await until(() => !coach.lines().includes(CHECKING));
		expect(coach.requests).toHaveLength(1);
		expect(JSON.stringify(coach.requests)).not.toContain("privateSecret");
		expect(coach.lines()).toEqual([title("1 fix"), "it fail fails", `[code block, ${count} lines]`, "- it fail → It fails (Agreement)"]);
	});

	test("literal placeholder-like text and code containing it restore without replacing either twice", async () => {
		const coach = await fixture({
			reply: body => {
				const input = body.messages.find((message: any) => message.role === "user").content as string;
				return `Better: ${input.replace("it fail", "It fails")}\nit fail → It fails (Agreement)`;
			},
		});
		await coach.input("it fail [[COACH_1]] with `[[COACH__2]]`");
		await until(() => !coach.lines().includes(CHECKING));
		expect(coach.lines()).toEqual([
			title("1 fix"), "it fail fails [[COACH_1]] with `[[COACH__2]]`", "- it fail → It fails (Agreement)",
		]);
	});
});

describe("English coach command allow list", () => {
	test.each([
		"/skill:review it fail",
		"/skill:team:review\tit fail",
		"/btw\nit fail",
	])("only the argument of %j reaches the coach model", async input => {
		const coach = await fixture({
			settings: { englishCoachMaxTokens: 2 },
			reply: () => "Better: It fails.\nit fail → It fails (Agreement)",
		});
		expect(await coach.input(input)).toEqual([undefined]);
		await until(() => coach.lines()[0] === title("1 fix"));
		expect(coach.requests).toHaveLength(1);
		expect(coach.requests[0]!.messages.filter((message: any) => message.role === "user")).toEqual([
			{ role: "user", content: "it fail" },
		]);
		expect(coach.lines()).toEqual([title("1 fix"), "it fail fails.", "- it fail → It fails (Agreement)"]);
	});

	test.each(["coach-file", "team:coach-file"])("a discovered prompt-file command /%s sends only its unexpanded argument", async name => {
		const coach = await fixture({ promptCommands: [name] });
		expect(await coach.input(`/${name} it fail`)).toEqual([undefined]);
		await until(() => coach.lines().includes(CLEAN));
		expect(coach.requests).toHaveLength(1);
		expect(coach.requests[0]!.messages.filter((message: any) => message.role === "user")).toEqual([
			{ role: "user", content: "it fail" },
		]);
		expect(JSON.stringify(coach.requests)).not.toContain("Expanded template");
	});

	test.each([
		"/",
		"/ fix this",
		"/model sonnet",
		"/resume 3f2a",
		"/unknown-coach-command fix this",
		"/coach-file-extra fix this",
		"/skill: fix this",
		"/skills:review fix this",
		"/btw",
		"/btw \t\n",
		"/skill:review",
		"/skill:review \t",
		"/coach-file",
		"/coach-file \n",
	])("unchecked command %j removes the previous outcome without a request", async input => {
		const coach = await fixture({ promptCommands: ["coach-file"] });
		await coach.input("This works.");
		await until(() => coach.lines().includes(CLEAN));
		expect(await coach.input(input)).toEqual([undefined]);
		await Bun.sleep(25);
		expect(coach.lines()).toEqual([]);
		expect(coach.requests).toHaveLength(1);
	});

	test("prompt-file names are discovered once per session and replaced for a new cwd", async () => {
		const other = await fixture({ promptCommands: ["other-coach-file"] });
		const coach = await fixture({ promptCommands: ["coach-file"] });
		const discovery = spyOn(host, "discoverSlashCommands");
		try {
			await coach.emit("session_switch");
			expect(discovery).toHaveBeenCalledTimes(1);
			expect(discovery.mock.calls[0]).toEqual([{ cwd: coach.ctx.cwd }]);
			await coach.input("/coach-file it fail");
			await until(() => coach.lines().includes(CLEAN));
			await coach.input("This works.");
			await until(() => coach.requests.length === 2 && coach.lines().includes(CLEAN));
			await Bun.write(`${coach.ctx.cwd}/.omp/commands/late-coach-file.md`, "$ARGUMENTS");
			await coach.input("/late-coach-file it fail");
			expect(coach.lines()).toEqual([]);
			expect(discovery).toHaveBeenCalledTimes(1);
			expect(coach.requests).toHaveLength(2);

			const context = { ...coach.ctx, cwd: other.ctx.cwd };
			await coach.emit("session_switch", {}, context);
			expect(discovery).toHaveBeenCalledTimes(2);
			expect(discovery.mock.calls[1]).toEqual([{ cwd: other.ctx.cwd }]);
			await coach.input("/coach-file it fail", {}, context);
			expect(coach.lines()).toEqual([]);
			await coach.input("/other-coach-file it fail", {}, context);
			await until(() => coach.requests.length === 3 && coach.lines().includes(CLEAN));
			expect(discovery).toHaveBeenCalledTimes(2);
			expect(coach.requests.at(-1)!.messages.filter((message: any) => message.role === "user")).toEqual([
				{ role: "user", content: "it fail" },
			]);
		} finally {
			discovery.mockRestore();
		}
	});

	test("allowed command arguments keep code and links out of the request and the English budget", async () => {
		const coach = await fixture({ settings: { englishCoachMaxTokens: 4 } });
		await coach.input(`/skill:review it fail \`privateCode()\` src/private.ts https://private.example/${"secret".repeat(1000)}`);
		await until(() => coach.lines().includes(CLEAN));
		expect(coach.requests).toHaveLength(1);
		const request = JSON.stringify(coach.requests);
		for (const excluded of ["skill:review", "privateCode", "src/private.ts", "private.example", "secret"]) {
			expect(request).not.toContain(excluded);
		}
	});

	test("an allowed command with only code names the no-English reason", async () => {
		const coach = await fixture();
		await coach.input("/btw `privateCode()`");
		expect(coach.lines()).toEqual([TITLE, "Not checked: no English text"]);
		expect(coach.requests).toEqual([]);
	});
});
