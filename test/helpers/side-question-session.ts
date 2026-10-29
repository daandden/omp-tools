import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	AgentRegistry,
	AuthStorage,
	createAgentSession,
	ModelRegistry,
	SessionManager,
	Settings,
	type AgentSession,
	type ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import { parseConfiguredThinkingLevel } from "@oh-my-pi/pi-tui/thinking";
import { SideQuestionThread, type SideQuestionCallbacks } from "../../extensions/side-question";

export async function sideQuestionFixture(options: {
	spec?: string;
	fail?: string[];
	fallback?: Record<string, string[]>;
	smol?: string;
	window?: number;
	maxCost?: number;
	reply?: (body: Record<string, any>) => string | Promise<string>;
} = {}) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "side-question-test-"));
	const id = `SideMain-${crypto.randomUUID()}`;
	const requests: Record<string, any>[] = [];
	const warnings: string[] = [];
	const trace: unknown[] = [];
	const threads: SideQuestionThread[] = [];
	let server: Bun.Server<undefined> | undefined;
	let authStorage: AuthStorage | undefined;
	let main: AgentSession | undefined;
	const dispose = async () => {
		try {
			await Promise.all(threads.map(thread => thread.dispose()));
		} finally {
			try { await main?.dispose(); }
			finally {
				server?.stop(true);
				authStorage?.close();
				AgentRegistry.global().unregister(id);
				await fs.rm(dir, { recursive: true, force: true });
			}
		}
	};
	try {
		server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			async fetch(request) {
				const body = await request.json() as Record<string, any>;
				if (new URL(request.url).pathname === "/events") {
					trace.push(body);
					return Response.json({});
				}
				trace.push({ type: "request", model: body.model, at: Date.now() });
				requests.push(body);
				if (options.fail?.includes(body.model)) {
					return Response.json({ error: { message: "fixture provider unavailable", type: "server_error" } }, {
						status: 503,
						headers: { "retry-after-ms": "1" },
					});
				}
				const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null) =>
					`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
				return new Response(
					chunk({ role: "assistant", content: await options.reply?.(body) ?? `answered by ${body.model}` }) +
					chunk({}, "stop") +
					`data: ${JSON.stringify({ id: "fixture", choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\ndata: [DONE]\n\n`,
					{ headers: { "content-type": "text/event-stream" } },
				);
			},
		});
		const provider = `side-fixture-${crypto.randomUUID()}`;
		const route = (model: string) => `${provider}/${model}`;
		await fs.mkdir(path.join(dir, ".omp"));
		const setSpec = async (spec: string) => Bun.write(
			path.join(dir, ".omp/plugin-overrides.json"),
			JSON.stringify({ settings: { "omp-tools": { sideQuestionModel: spec } } }),
		);
		await setSpec(options.spec ?? "");
		const extension = path.join(dir, "provider.ts");
		const models = ["main", "small", "backup", "wrong"].map(model => ({
			id: model,
			name: model,
			reasoning: true,
			thinking: model === "small" ? { mode: "effort", efforts: ["low", "high"], defaultLevel: "low" } : undefined,
			input: ["text", "image"],
			cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
			contextWindow: model === "small" ? options.window ?? 128000 : 1000000,
			maxTokens: 4096,
			compat: { supportsDeveloperRole: true, supportsReasoningEffort: true },
		}));
		await Bun.write(extension, `export default function(pi) {
			for (const type of ["auto_retry_start", "auto_retry_end", "retry_fallback_applied", "before_provider_request", "agent_start", "agent_end"]) pi.on(type, async (event, ctx) => {
				await fetch(${JSON.stringify(`http://127.0.0.1:${server.port}/events`)}, { method: "POST", body: JSON.stringify({ type, event: type === "before_provider_request" ? undefined : event, agent: ctx.agent.id, at: Date.now() }) });
			});
			pi.registerProvider(${JSON.stringify(provider)}, { baseUrl: ${JSON.stringify(`http://127.0.0.1:${server.port}/v1`)}, apiKey: "fixture-key", api: "openai-completions", models: ${JSON.stringify(models)} });
		}`);
		authStorage = await AuthStorage.create(":memory:");
		const modelRegistry = new ModelRegistry(authStorage, path.join(dir, "models.yml"));
		const settings = Settings.isolated({
			"async.enabled": false,
			"compaction.enabled": false,
			"retry.enabled": true,
			"retry.maxRetries": 1,
			"retry.baseDelayMs": 1,
			"retry.maxDelayMs": 50,
			"retry.modelFallback": true,
			"retry.fallbackOn": "any",
			"retry.fallbackChains": Object.fromEntries(Object.entries(options.fallback ?? { default: ["backup"] }).map(([role, names]) => [role, names.map(route)])),
			"session.maxCost": options.maxCost,
			"marketplace.autoUpdate": "off",
		});
		settings.setModelRole("default", route("main"));
		settings.setModelRole("smol", route(options.smol ?? "small"));
		const created = await createAgentSession({
			cwd: dir,
			agentDir: dir,
			sessionManager: SessionManager.create(dir, path.join(dir, "sessions")),
			authStorage,
			modelRegistry,
			settings,
			modelPattern: route("main"),
			thinkingLevel: parseConfiguredThinkingLevel("high"),
			agentId: id,
			parentTaskPrefix: id,
			hasUI: false,
			toolNames: [],
			enableMCP: false,
			enableLsp: false,
			disableExtensionDiscovery: true,
			preloadedExtensionPaths: [extension],
			skills: [],
			promptTemplates: [],
		});
		main = created.session;
		const session = main;
		if (!session.model) throw new Error(`Fixture model unavailable: ${created.modelFallbackMessage}`);
		const ctx = {
			cwd: dir,
			agent: { id, kind: "main" },
			sessionManager: session.sessionManager,
			ui: { notify(message: string) { warnings.push(message); } },
		} as unknown as ExtensionContext;
		const open = async () => {
			const thread = await SideQuestionThread.open(ctx);
			threads.push(thread);
			return thread;
		};
		return { main: session, ctx, requests, warnings, trace, settings, route, setSpec, open, dispose };
	} catch (error) {
		await dispose();
		throw error;
	}
}

export function callbacks(recovery: unknown[] = []): SideQuestionCallbacks {
	return {
		onMessageStart() {},
		onText() {},
		onToolCall() {},
		onCacheMiss() {},
		onRecovery(event) { recovery.push(event); },
	};
}
