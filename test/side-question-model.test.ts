import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AuthStorage, ModelRegistry, Settings, type AgentSession } from "@oh-my-pi/pi-coding-agent";
import { resolveModelOverride } from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import { sideQuestionModel } from "../extensions/side-question-model";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

// Codex's bundled catalog has gpt-6.1-sol but not gpt-6.1-terra; Terra comes only from discovery.
async function staleCodexSession() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "side-question-model-test-"));
	await Bun.write(
		path.join(dir, ".omp/plugin-overrides.json"),
		JSON.stringify({ settings: { "omp-tools": { sideQuestionModel: "@smol" } } }),
	);
	const discovery = { denied: true, calls: 0, held: undefined as Promise<void> | undefined };
	const fetch = Object.assign(
		async () => {
			discovery.calls++;
			await discovery.held;
			if (discovery.denied) return Response.json({ error: { code: "token_revoked" } }, { status: 401 });
			return Response.json({
				models: ["gpt-6.1-sol", "gpt-6.1-terra"].map(slug => ({
					slug,
					visibility: "list",
					supported_in_api: true,
					input_modalities: ["text"],
				})),
			});
		},
		{ preconnect() {} },
	);
	const auth = await AuthStorage.create(":memory:");
	auth.keys.setRuntime("openai-codex", "synthetic-key");
	const settings = Settings.isolated({});
	settings.setModelRole("smol", "openai-codex/gpt-6.1-terra:high");
	const modelRegistry = new ModelRegistry(auth, path.join(dir, "models.yml"), {
		settings,
		ignoreLocalModelConfig: true,
		cacheDbPath: path.join(dir, "models.db"),
		fetch,
	});
	await modelRegistry.refreshDiscoverableProviders(["openai-codex"], "online");
	cleanups.push(async () => {
		auth.close();
		await fs.rm(dir, { recursive: true, force: true });
	});
	const ids = (selector: string) => resolveModelOverride([selector], modelRegistry, settings).model?.id;
	expect(ids("@smol")).toBeUndefined();
	expect(ids("openai-codex/gpt-6.1-sol")).toBe("gpt-6.1-sol");
	const main = { modelRegistry, settings } as unknown as AgentSession;
	return { main, dir, discovery };
}

test("a Side question model lost from a stale catalog is found again by refreshing its provider", async () => {
	const { main, dir, discovery } = await staleCodexSession();
	discovery.denied = false;
	const selected = await sideQuestionModel(main, dir, new AbortController().signal);
	expect(selected?.model && `${selected.model.provider}/${selected.model.id}`).toBe("openai-codex/gpt-6.1-terra");
	expect(selected).toMatchObject({ role: "smol", thinkingLevel: "high" });
});

test("a Side question model still missing after the refresh warns with the model its role names, on every thread", async () => {
	const { main, dir, discovery } = await staleCodexSession();
	const before = discovery.calls;
	const warning = { warning: 'Side question model "@smol" (openai-codex/gpt-6.1-terra) is not in the model list. Using the main model.' };
	expect(await sideQuestionModel(main, dir, new AbortController().signal)).toEqual(warning);
	expect(await sideQuestionModel(main, dir, new AbortController().signal)).toEqual(warning);
	expect(discovery.calls - before).toBe(2);
});

test("cancelling while the provider is rediscovered stops waiting at once and leaves the discovery to finish for later threads", async () => {
	const { main, dir, discovery } = await staleCodexSession();
	const release = Promise.withResolvers<void>();
	discovery.held = release.promise;
	discovery.denied = false;
	const abort = new AbortController();
	const cancelled = sideQuestionModel(main, dir, abort.signal).then(
		() => "settled",
		(error: Error) => error.name,
	);
	while (discovery.calls === 1) await Bun.sleep(1);
	abort.abort();
	expect(await Promise.race([cancelled, Bun.sleep(1_000).then(() => "still waiting")])).toBe("AbortError");
	release.resolve();
	discovery.held = undefined;
	while (!resolveModelOverride(["@smol"], main.modelRegistry, main.settings).model) await Bun.sleep(1);
	const selected = await sideQuestionModel(main, dir, new AbortController().signal);
	expect(selected?.model && `${selected.model.provider}/${selected.model.id}`).toBe("openai-codex/gpt-6.1-terra");
	expect(discovery.calls).toBe(2);
});
