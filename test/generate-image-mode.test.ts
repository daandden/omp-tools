import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
	argumentNames,
	codexToken,
	encodePng,
	fakeContext,
	loadSession,
	loadTool,
	outputPathsOf,
	writePluginSettings,
} from "./support";

const OPENAI_GENERATIONS = "https://api.openai.com/v1/images/generations";
const CODEX_GENERATIONS = "https://chatgpt.com/backend-api/codex/images/generations";
const API_KEY = "sk-test-openai";
const PNG = encodePng(4, 3, (x, y) => [x * 60, y * 80, 120, 255]);

interface CapturedRequest {
	url: string;
	authorization: string | null;
	body: Record<string, unknown>;
}

let requests: CapturedRequest[];
let respond: (request: CapturedRequest) => Response | Promise<Response>;
let savedFiles: string[];
let fetchSpy: ReturnType<typeof spyOn> | undefined;

function imageResponse(): Response {
	return Response.json({ data: [{ b64_json: Buffer.from(PNG).toString("base64") }], size: "1024x1024", quality: "low" });
}

function context() {
	return fakeContext({ credentials: { openai: API_KEY, "openai-codex": codexToken() } });
}

async function call(defaultMode: string, params: Record<string, unknown>) {
	const tool = await loadTool({ defaultImageGenerationMode: defaultMode });
	const result = await tool.execute("c", params, undefined, undefined, context());
	savedFiles.push(...outputPathsOf(result));
	return result;
}

beforeEach(() => {
	requests = [];
	savedFiles = [];
	respond = () => imageResponse();
	fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = {
			url: String(input),
			authorization: new Headers(init?.headers).get("authorization"),
			body: JSON.parse(String(init?.body)) as Record<string, unknown>,
		};
		requests.push(request);
		return respond(request);
	}) as typeof fetch);
});

afterEach(() => {
	fetchSpy?.mockRestore();
	for (const file of savedFiles) fs.rmSync(file, { force: true });
});

describe("per-call mode", () => {
	test("both defaults register one tool with both modes' arguments and mode", async () => {
		for (const mode of ["openai", "codex"]) {
			const names = argumentNames(await loadTool({ defaultImageGenerationMode: mode }));

			expect(names).toContain("mode");
			expect(names).toContain("transparent_background");
			for (const name of ["size", "output_format", "n", "mask", "markup", "images", "svg"]) expect(names).toContain(name);
		}
	});

	test("every registration declares shared concurrency to OMP", async () => {
		for (const settings of [
			{ defaultImageGenerationMode: "openai" },
			{ defaultImageGenerationMode: "codex" },
			{ imageGenerationMode: "codex" },
			{ defaultImageGenerationMode: "dall-e" },
		]) {
			expect(await loadTool(settings)).toHaveProperty("concurrency", "shared");
		}
	});

	test("with the default codex, mode openai sends an SVG request to the OpenAI Images API with the openai key", async () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4"/></svg>';
		respond = () => Response.json({ data: [{ b64_json: Buffer.from(svg).toString("base64") }], output_format: "svg" });

		const result = await call("codex", { prompt: "a fox logo", mode: "openai", output_format: "svg" });

		expect(requests.map(request => request.url)).toEqual([OPENAI_GENERATIONS]);
		expect(requests[0]?.authorization).toBe(`Bearer ${API_KEY}`);
		expect(requests[0]?.body.output_format).toBe("svg");
		expect(requests[0]?.body).not.toHaveProperty("mode");
		expect(result.details).toMatchObject({ mode: "openai", outputs: [{ mimeType: "image/svg+xml" }] });
	});

	test("with the default openai, mode codex reaches the Codex Images endpoint with Codex OAuth", async () => {
		const result = await call("openai", { prompt: "a fox", mode: "codex", transparent_background: true });

		expect(requests.map(request => request.url)).toEqual([CODEX_GENERATIONS]);
		expect(requests[0]?.authorization).toBe(`Bearer ${codexToken()}`);
		expect(requests[0]?.body.background).toBe("transparent");
		expect(result.details).toMatchObject({ mode: "codex" });
	});

	test.each([
		["openai", OPENAI_GENERATIONS, `Bearer ${API_KEY}`],
		["codex", CODEX_GENERATIONS, `Bearer ${codexToken()}`],
	])("a call without mode uses the default %s", async (mode, url, authorization) => {
		const result = await call(mode, { prompt: "a fox" });

		expect(requests.map(request => request.url)).toEqual([url]);
		expect(requests[0]?.authorization).toBe(authorization);
		expect(result.details).toMatchObject({ mode });
	});
});

describe("arguments against the chosen mode", () => {
	async function rejection(defaultMode: string, params: Record<string, unknown>, options = {}): Promise<string> {
		const tool = await loadTool({ defaultImageGenerationMode: defaultMode });
		const error = await tool.execute("c", params, undefined, undefined, fakeContext({ credentials: { openai: API_KEY, "openai-codex": codexToken() }, ...options })).then(
			() => undefined,
			(caught: unknown) => caught,
		);
		if (!(error instanceof Error)) throw new Error("expected the call to fail");
		expect(requests).toHaveLength(0);
		return error.message;
	}

	test.each([
		["openai", { mode: "codex", size: "1024x1024", quality: "low" }, ["size", "quality"], "Codex mode"],
		["codex", { size: "1024x1024" }, ["size"], "Codex mode"],
		["codex", { mode: "openai", transparent_background: true }, ["transparent_background"], "OpenAI mode"],
		["openai", { transparent_background: true }, ["transparent_background"], "OpenAI mode"],
	])("default %s with %j fails before any request, naming the arguments and the mode", async (defaultMode, params, names, label) => {
		const message = await rejection(defaultMode, { prompt: "a fox", ...params });

		for (const name of names) expect(message).toContain(name);
		expect(message).toContain(label);
	});

	describe("Reference image limits", () => {
		let dir: string;
		let file: string;
		beforeEach(async () => {
			dir = fs.mkdtempSync(path.join(os.tmpdir(), "generate-image-mode-"));
			file = path.join(dir, "a.png");
			await Bun.write(file, PNG);
		});
		afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

		test("six paths fail in Codex mode naming 5 and pass in OpenAI mode; seventeen fail in OpenAI mode naming 16", async () => {
			const codexMessage = await rejection("openai", { prompt: "x", mode: "codex", referenced_image_paths: Array(6).fill(file) });
			expect(codexMessage).toContain("referenced_image_paths");
			expect(codexMessage).toContain("5");
			const openaiMessage = await rejection("codex", { prompt: "x", mode: "openai", referenced_image_paths: Array(17).fill(file) });
			expect(openaiMessage).toContain("referenced_image_paths");
			expect(openaiMessage).toContain("16");

			await call("codex", { prompt: "x", mode: "openai", referenced_image_paths: Array(6).fill(file) });
			expect(requests.map(request => request.url)).toEqual(["https://api.openai.com/v1/images/edits"]);
			expect(requests[0]?.body.images).toHaveLength(6);
		});

		test("num_last_images_to_include keeps 1 to 5 in Codex mode and 1 to 16 in OpenAI mode", async () => {
			const image = { type: "image", data: Buffer.from(PNG).toString("base64"), mimeType: "image/png" };
			const branch = Array.from({ length: 6 }, (_, index) => ({ type: "message", id: `m${index}`, message: { role: "user", content: [image] } }));
			const codexMessage = await rejection("openai", { prompt: "x", mode: "codex", num_last_images_to_include: 6 }, { branch });
			expect(codexMessage).toContain("num_last_images_to_include");
			expect(codexMessage).toContain("5");
			const openaiMessage = await rejection("codex", { prompt: "x", mode: "openai", num_last_images_to_include: 17 }, { branch });
			expect(openaiMessage).toContain("16");

			const tool = await loadTool({ defaultImageGenerationMode: "codex" });
			const result = await tool.execute("c", { prompt: "x", mode: "openai", num_last_images_to_include: 6 }, undefined, undefined, fakeContext({ credentials: { openai: API_KEY }, branch }));
			savedFiles.push(...outputPathsOf(result));
			expect(requests[0]?.body.images).toHaveLength(6);
		});
	});

	test("an invalid mode fails naming openai and codex, without a request", async () => {
		for (const mode of ["dall-e", "", null]) {
			const message = await rejection("openai", { prompt: "a fox", mode });

			expect(message).toContain("mode");
			expect(message).toContain('"openai"');
			expect(message).toContain('"codex"');
		}
	});

	test("an unknown argument fails listing the accepted arguments, without a request", async () => {
		const message = await rejection("codex", { prompt: "a fox", mode: "openai", style: "vivid" });

		expect(message).toContain("Unknown argument(s): style.");
		for (const name of ["mode", "prompt", "transparent_background", "size", "output_format", "mask"]) expect(message).toContain(name);
	});
});

describe("cards name the mode each call used", () => {
	type View = { tool: { meta?: string[] } } | undefined;
	const meta = (view: unknown) => (view as View)?.tool.meta ?? [];
	const done = { expanded: false, isPartial: false };

	test("the call card names the call's mode, or the default when mode is omitted", async () => {
		const tool = await loadTool({ defaultImageGenerationMode: "codex" });

		expect(meta(tool.describeCall?.({ prompt: "a logo", mode: "openai", output_format: "svg" }, done))).toEqual(["OpenAI mode", "svg"]);
		expect(meta(tool.describeCall?.({ prompt: "a fox" }, done))).toEqual(["Codex mode"]);
	});

	test("a result card names the mode from the result, previews and errors included", async () => {
		const tool = await loadTool({ defaultImageGenerationMode: "openai" });
		const args = { prompt: "a fox", mode: "codex" };
		const result = await tool.execute("c", args, undefined, undefined, context());
		savedFiles.push(...outputPathsOf(result));

		expect(meta(tool.describeResult?.(result, done, args))[0]).toBe("Codex mode");
		const preview = { content: [], details: { stage: "preview", mode: "codex", previews: 1 } };
		expect(meta(tool.describeResult?.(preview as never, { expanded: false, isPartial: true }, args))).toEqual(["Codex mode"]);
		// OMP stores a thrown error as a result with empty details.
		for (const details of [undefined, {}]) {
			const error = () => ({ content: [{ type: "text" as const, text: "failed" }], details: structuredClone(details), isError: true });
			expect(meta(tool.describeResult?.(error() as never, done, args))).toEqual(["Codex mode"]);
			expect(meta(tool.describeResult?.(error() as never, done, { prompt: "a fox" }))).toEqual(["OpenAI mode"]);
		}
	});

	test("a result tagged with a mode other than the default renders with that mode's facts and warnings", async () => {
		const tool = await loadTool({ defaultImageGenerationMode: "openai" });
		const saved = path.join(os.tmpdir(), "omp-image-tagged.webp");
		const result = {
			content: [{ type: "text" as const, text: `Saved to ${saved}` }],
			details: { mode: "codex", outputs: [{ path: saved, mimeType: "image/webp", size: "1254x1254" }], quotaWarning: "Codex usage limit is 85% used." },
		};

		const view = tool.describeResult?.(result as never, done, { prompt: "a fox" });

		expect(meta(view)).toEqual(["Codex mode", "1254x1254"]);
		expect(JSON.stringify(view)).toContain("Codex usage limit is 85% used.");
	});

	test.each(["openai", "codex"])("a Codex result saved before modes renders as Codex mode with the default %s", async mode => {
		const tool = await loadTool({ defaultImageGenerationMode: mode });
		const legacy = { path: path.join(os.tmpdir(), "omp-image-legacy.webp"), size: "1254x1254", quality: "low", quotaWarning: "Image generation limit 85% used." };

		const view = tool.describeResult?.({ content: [], details: legacy } as never, done, { prompt: "a fox" });

		expect(meta(view)).toEqual(["Codex mode", "1254x1254", "quality low"]);
		expect(JSON.stringify(view)).toContain(legacy.quotaWarning);
	});

	test.each([
		["legacy-only", { imageGenerationMode: "codex" }],
		["invalid default", { defaultImageGenerationMode: "dall-e" }],
	])("%s settings keep saved image cards and links available", async (_label, settings) => {
		const tool = await loadTool(settings);
		const saved = path.join(os.tmpdir(), "omp-image-saved.webp");
		const args = { prompt: "a fox", mode: "codex", transparent_background: true };
		const legacy = { path: saved, size: "1254x1254" };
		const tagged = { mode: "codex", outputs: [{ path: saved, mimeType: "image/webp", size: "1254x1254" }] };

		for (const details of [legacy, tagged]) {
			const view = tool.describeResult?.({ content: [], details } as never, done, { prompt: "a fox" });

			expect(JSON.stringify(view) ?? "").toContain(`"href":"${pathToFileURL(saved).href}"`);
			expect(meta(view)).toEqual(["Codex mode", "1254x1254"]);
		}
		expect(meta(tool.describeCall?.(args, done))).toEqual(["Codex mode", "transparent"]);
		const preview = { content: [], details: { stage: "preview", mode: "openai", previews: 1 } };
		const previewView = tool.describeResult?.(preview as never, { ...done, isPartial: true }, { prompt: "a fox", background: "transparent" });
		expect(meta(previewView)).toEqual(["OpenAI mode", "transparent"]);
		expect(JSON.stringify(previewView)).toContain("Preview 1, in progress");
		const error = { content: [{ type: "text" as const, text: "Past call failed." }], details: {}, isError: true };
		const errorView = tool.describeResult?.(error as never, done, args);
		expect(meta(errorView)).toEqual(["Codex mode", "transparent"]);
		expect(errorView).toHaveProperty("tone", "error");
		expect(JSON.stringify(errorView)).toContain("Past call failed.");
		expect(requests).toHaveLength(0);
	});
});

describe("approval prompt", () => {
	async function approvalLines(defaultMode: string, args: Record<string, unknown>): Promise<string[]> {
		const tool = (await loadTool({ defaultImageGenerationMode: defaultMode })) as { formatApprovalDetails?: (args: unknown) => string | string[] | undefined };
		const details = tool.formatApprovalDetails?.(args) ?? [];
		return typeof details === "string" ? [details] : details;
	}

	test("a direct call with mode shows that mode and the call's arguments", async () => {
		const lines = await approvalLines("codex", { prompt: "a fox logo", mode: "openai", output_format: "svg" });

		expect(lines[0]).toContain("OpenAI mode");
		expect(lines[0]).not.toContain("Codex mode");
		const text = lines.join("\n");
		expect(text).toContain('"prompt": "a fox logo"');
		expect(text).toContain('"output_format": "svg"');
		expect(text).toContain('"mode": "openai"');
		expect(requests).toHaveLength(0);
	});

	test.each([
		["codex", "Codex mode"],
		["openai", "OpenAI mode"],
	])("a direct call without mode shows the default %s as the mode it will use", async (defaultMode, label) => {
		const lines = await approvalLines(defaultMode, { prompt: "a fox" });

		expect(lines[0]).toContain(label);
		expect(lines[0]).toContain("Default image generation mode");
		expect(lines.join("\n")).toContain('"prompt": "a fox"');
	});

	test("a call with an invalid mode shows its arguments and no mode it will use", async () => {
		const lines = await approvalLines("openai", { prompt: "a fox", mode: "dall-e" });

		expect(lines.join("\n")).toContain('"mode": "dall-e"');
		expect(lines.join("\n")).not.toContain("OpenAI mode");
	});
});

describe("errors another mode could avoid", () => {
	async function errorText(defaultMode: string, params: Record<string, unknown>, options: Parameters<typeof fakeContext>[0]) {
		const tool = await loadTool({ defaultImageGenerationMode: defaultMode });
		const error = await tool.execute("c", params, undefined, undefined, fakeContext(options)).then(
			() => undefined,
			(caught: unknown) => caught,
		);
		if (!(error instanceof Error)) throw new Error("expected the call to fail");
		expect(requests).toHaveLength(0);
		return error.message;
	}

	test("a missing OpenAI key keeps its remedy and offers Codex mode or a new default, without a retry", async () => {
		const message = await errorText("codex", { prompt: "x", mode: "openai" }, { credentials: { "openai-codex": codexToken() } });

		expect(message).toContain("OPENAI_API_KEY");
		expect(message).toContain("ask for Codex mode");
		expect(message).toContain("defaultImageGenerationMode");
		expect(message).toContain("unless the user asks");
	});

	test("a missing Codex login keeps /login and offers OpenAI mode or a new default, without a retry", async () => {
		const message = await errorText("openai", { prompt: "x", mode: "codex" }, { credentials: { openai: API_KEY } });

		expect(message).toContain("/login");
		expect(message).toContain("ask for OpenAI mode");
		expect(message).toContain("defaultImageGenerationMode");
		expect(message).toContain("unless the user asks");
	});

	test("a custom openai base URL keeps the first-party guard and offers Codex mode or a new default, without a retry", async () => {
		const message = await errorText("openai", { prompt: "x" }, { credentials: { openai: API_KEY }, openaiBaseUrl: "https://proxy.example.com/v1" });

		expect(message).toContain("https://proxy.example.com/v1");
		expect(message).toContain("https://api.openai.com/v1");
		expect(message).toContain("ask for Codex mode");
		expect(message).toContain("defaultImageGenerationMode");
		expect(message).toContain("unless the user asks");
	});
});

describe("no fallback", () => {
	async function failedCall(defaultMode: string, params: Record<string, unknown>): Promise<Error> {
		const tool = await loadTool({ defaultImageGenerationMode: defaultMode });
		const error = await tool.execute("c", params, undefined, undefined, context()).then(
			() => undefined,
			(caught: unknown) => caught,
		);
		if (!(error instanceof Error)) throw new Error("expected the call to fail");
		return error;
	}

	test("an OpenAI moderation refusal sends exactly one request, to the OpenAI endpoint, with the default codex", async () => {
		respond = () => Response.json({ error: { message: "Rejected by the safety system.", code: "moderation_blocked" } }, { status: 400 });

		const error = await failedCall("codex", { prompt: "x", mode: "openai" });

		expect(error.message).toContain("moderation_blocked");
		expect(requests.map(request => request.url)).toEqual([OPENAI_GENERATIONS]);
	});

	test("a spent Codex allowance sends exactly one request, to the Codex endpoint, with the default openai", async () => {
		respond = () =>
			Response.json(
				{ error: { type: "usage_limit_reached", message: "image limit reached", plan_type: "plus" } },
				{ status: 429, headers: { "x-codex-active-limit": "image_gen", "x-codex-primary-reset-after-seconds": "60" } },
			);

		const error = await failedCall("openai", { prompt: "x", mode: "codex" });

		expect(error.message).toContain("Codex usage limit reached");
		expect(requests.map(request => request.url)).toEqual([CODEX_GENERATIONS]);
	});
});

describe("session switch", () => {
	test("a new session picks up a changed default while a running call keeps its explicit mode", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "generate-image-project-"));
		try {
			const session = await loadSession({ defaultImageGenerationMode: "codex" }, dir);
			let release: () => void = () => {};
			respond = () => new Promise(resolve => (release = () => resolve(imageResponse())));
			const running = session.tool().execute("c", { prompt: "first", mode: "openai" }, undefined, undefined, context());
			await Bun.sleep(0);

			writePluginSettings(dir, { defaultImageGenerationMode: "openai" });
			await session.emit("session_switch", { cwd: dir });
			respond = () => imageResponse();
			release();
			const first = await running;
			savedFiles.push(...outputPathsOf(first));
			const next = await session.tool().execute("c", { prompt: "next" }, undefined, undefined, context());
			savedFiles.push(...outputPathsOf(next));
			const explicit = await session.tool().execute("c", { prompt: "codex", mode: "codex" }, undefined, undefined, context());
			savedFiles.push(...outputPathsOf(explicit));

			expect(first.details).toMatchObject({ mode: "openai" });
			expect(next.details).toMatchObject({ mode: "openai" });
			expect(explicit.details).toMatchObject({ mode: "codex" });
			expect(requests.map(request => request.url)).toEqual([OPENAI_GENERATIONS, OPENAI_GENERATIONS, CODEX_GENERATIONS]);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
