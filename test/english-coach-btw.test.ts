import { afterEach, beforeAll, expect, test } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import { englishCoachFixture } from "./helpers/english-coach-session";

const cleanups: (() => Promise<void>)[] = [];
beforeAll(async () => {
	await Settings.init({ inMemory: true });
	await initTheme();
});
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});
async function until(predicate: () => boolean): Promise<void> {
	const end = Date.now() + 2000;
	while (!predicate()) {
		if (Date.now() > end) throw new Error("Timed out waiting for the coach and Side question");
		await Bun.sleep(5);
	}
}

const orders = [["btw", "english-coach"], ["english-coach", "btw"]] as const;
test.each(orders)("/btw is coached once and answered with %j loaded first", async (first, second) => {
	const coach = await englishCoachFixture({
		entryPoints: [first, second],
		settings: { sideQuestionModel: "@default" },
		reply: body => body.model === "small"
			? "Better: Why doesn't this work?\nwhy this not work → Why doesn't this work (Missing auxiliary verb)"
			: "The login handler needs a null check.",
	});
	cleanups.push(coach.dispose);
	const result = await coach.input("/btw why this not work");
	expect(result.at(-1)).toEqual({ handled: true });
	await until(() => coach.widgets.get("omp-tools.english-coach")?.render(100).some(line => line.startsWith("Better:")) === true);
	await until(() => coach.widgets.get("omp-tools.btw")?.render(100).join(" ").includes("The login handler needs a null check.") === true);
	expect(coach.requests.filter(body => body.model === "small")).toHaveLength(1);
	expect(coach.requests.filter(body => body.model === "main")).toHaveLength(1);
	expect(coach.requests.find(body => body.model === "small")!.messages.filter((message: any) => message.role === "user")).toEqual([
		{ role: "user", content: "why this not work" },
	]);
	expect(coach.widgets.get("omp-tools.english-coach")!.render(100)).toEqual([
		"English coach", "Better: Why doesn't this work?", "- why this not work → Why doesn't this work (Missing auxiliary verb)",
	]);
	expect([...coach.placements.values()]).toEqual([{ placement: "aboveEditor" }, { placement: "aboveEditor" }]);
	expect(coach.focus()).toBe(true);
	expect(coach.main.messages).toEqual([]);
	expect(coach.main.sessionManager.getEntries().filter(entry => entry.type === "model_usage").map(entry => entry.purpose).sort()).toEqual([
		"english-coach", "side-question",
	]);
});

test.each(orders)("identical /btw submissions each get a check with %j loaded first", async (first, second) => {
	let answers = 0;
	const coach = await englishCoachFixture({
		entryPoints: [first, second],
		settings: { sideQuestionModel: "@default" },
		reply: body => body.model === "small" ? "No mistakes" : `Side answer ${++answers}.`,
	});
	cleanups.push(coach.dispose);
	for (const count of [1, 2]) {
		await coach.input("/btw Why does this fail?");
		await until(() => coach.widgets.get("omp-tools.btw")?.render(100).join(" ").includes(`Side answer ${count}.`) === true);
		await until(() => coach.main.sessionManager.getEntries().filter(entry => entry.type === "model_usage" && entry.purpose === "english-coach").length === count);
		expect(coach.requests.filter(body => body.model === "small")).toHaveLength(count);
		expect(coach.requests.filter(body => body.model === "main")).toHaveLength(count);
		expect(coach.widgets.get("omp-tools.english-coach")!.render(100)).toEqual(["English coach", "No mistakes"]);
	}
});

test.each(orders)("unavailable Side questions fall through and are coached once with %j loaded first", async (first, second) => {
	const coach = await englishCoachFixture({
		entryPoints: [first, second],
		settings: { sideQuestionModel: "@default" },
		reply: body => body.model === "small" ? "No mistakes" : "The Side question is available again.",
	});
	cleanups.push(coach.dispose);
	const unavailable = {
		...coach.ctx,
		sessionManager: { getSessionFile: () => undefined } as unknown as typeof coach.ctx.sessionManager,
	};
	expect(await coach.input("/btw Why does this fail?", {}, unavailable)).toEqual([undefined, undefined]);
	await until(() => coach.lines().includes("No mistakes"));
	expect(coach.requests.map(body => body.model)).toEqual(["small"]);
	expect(coach.requests[0]!.messages.filter((message: any) => message.role === "user")).toEqual([
		{ role: "user", content: "Why does this fail?" },
	]);
	expect(coach.widgets.has("omp-tools.btw")).toBe(false);
	expect(await coach.input("/btw")).toEqual([undefined, undefined]);
	expect(coach.widgets.size).toBe(0);
	expect(coach.requests).toHaveLength(1);
	expect((await coach.input("/btw Why does this fail?")).at(-1)).toEqual({ handled: true });
	await until(() => coach.widgets.get("omp-tools.btw")?.render(100).join(" ").includes("The Side question is available again.") === true);
	await until(() => coach.widgets.get("omp-tools.english-coach")?.render(100).includes("No mistakes") === true);
	expect(coach.requests.filter(body => body.model === "small")).toHaveLength(2);
	expect(coach.requests.filter(body => body.model === "main")).toHaveLength(1);
});

test.each(orders)("disabling the coach leaves /btw answers unchanged with %j loaded first", async (first, second) => {
	const coach = await englishCoachFixture({
		entryPoints: [first, second],
		settings: { englishCoach: false, sideQuestionModel: "@default" },
		reply: () => "The Side question still works.",
	});
	cleanups.push(coach.dispose);
	expect((await coach.input("/btw Why does this fail?")).at(-1)).toEqual({ handled: true });
	await until(() => coach.lines().join(" ").includes("The Side question still works."));
	expect(coach.requests.map(body => body.model)).toEqual(["main"]);
	expect(coach.widgets.has("omp-tools.english-coach")).toBe(false);
});
