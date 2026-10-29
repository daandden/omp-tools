import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { setImmediate } from "node:timers/promises";
import {
	argumentNames,
	codexToken,
	encodePng,
	fakeContext,
	type FakeContextOptions,
	imagesOf,
	isLosslessWebp,
	jpegWithOrientation,
	loadSession,
	loadTool,
	outputPathsOf,
	rgbaPixels,
	savedImageFiles,
	textOf,
	writePluginSettings,
} from "./support";

const GENERATIONS_URL = "https://api.openai.com/v1/images/generations";
const API_KEY = "sk-test-openai";

interface CapturedRequest {
	url: string;
	headers: Headers;
	body: Record<string, unknown>;
}

let requests: CapturedRequest[];
let respond: (request: CapturedRequest, signal: AbortSignal | undefined) => Response | Promise<Response>;
let savedFiles: string[];
let fetchSpy: ReturnType<typeof spyOn> | undefined;

const TRANSLUCENT_PNG = encodePng(6, 4, (x, y) => [x * 40, y * 60, 90, x === 0 ? 0 : 100 + y * 40]);

/** RGBA with the color under alpha 0 zeroed: Bun's lossless WebP encoder keeps visible pixels and alpha, not that color. */
async function visiblePixels(image: Uint8Array) {
	const pixels = await rgbaPixels(image);
	for (let i = 0; i < pixels.rgba.length; i += 4) {
		if (pixels.rgba[i + 3] === 0) pixels.rgba.fill(0, i, i + 3);
	}
	return pixels;
}

/** The saved files a tool card links to, in card order. */
function cardLinks(view: unknown): string[] {
	const links: string[] = [];
	const walk = (value: unknown) => {
		if (Array.isArray(value)) value.forEach(walk);
		else if (value && typeof value === "object") {
			const href = (value as { href?: unknown }).href;
			if (typeof href === "string" && href.startsWith("file:")) links.push(Bun.fileURLToPath(href));
			Object.values(value).forEach(walk);
		}
	};
	walk(view);
	return links;
}

function imagesResponse(overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
	return Response.json(
		{
			created: 1,
			background: "opaque",
			data: [{ b64_json: Buffer.from(TRANSLUCENT_PNG).toString("base64") }],
			output_format: "png",
			quality: "medium",
			size: "1024x1024",
			usage: { input_tokens: 12, output_tokens: 1056, total_tokens: 1068 },
			...overrides,
		},
		{ headers: { "x-request-id": "req_abc", ...headers } },
	);
}

function openaiContext(options: FakeContextOptions = {}) {
	return fakeContext({ credentials: { openai: API_KEY, "openai-codex": codexToken() }, ...options });
}

async function openaiTool() {
	return loadTool({ imageGenerationMode: "openai" });
}

async function run(params: Record<string, unknown>, options: FakeContextOptions = {}) {
	const result = await (await openaiTool()).execute("call-1", params, undefined, undefined, openaiContext(options));
	savedFiles.push(...outputPathsOf(result));
	return result;
}

async function failure(call: Promise<unknown>): Promise<Error> {
	const error = await call.then(
		() => undefined,
		(caught: unknown) => caught,
	);
	if (!(error instanceof Error)) throw new Error("expected the call to fail");
	return error;
}

beforeEach(() => {
	requests = [];
	savedFiles = [];
	respond = () => imagesResponse();
	fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = {
			url: String(input),
			headers: new Headers(init?.headers),
			body: JSON.parse(String(init?.body)) as Record<string, unknown>,
		};
		requests.push(request);
		return respond(request, init?.signal ?? undefined);
	}) as typeof fetch);
});

afterEach(() => {
	fetchSpy?.mockRestore();
	for (const file of savedFiles) fs.rmSync(file, { force: true });
});

describe("mode selection", () => {
	test("an unset imageGenerationMode registers OpenAI mode", async () => {
		const tool = await loadTool({ imageGenerationMode: null });

		expect(argumentNames(tool)).toContain("model");
		expect(argumentNames(tool)).not.toContain("transparent_background");
		const result = await tool.execute("c", { prompt: "a fox" }, undefined, undefined, openaiContext());
		savedFiles.push(...outputPathsOf(result));

		expect(requests.map(request => request.url)).toEqual([GENERATIONS_URL]);
	});

	test("imageGenerationMode codex keeps the four Codex arguments and the Codex endpoint", async () => {
		const tool = await loadTool({ imageGenerationMode: "codex" });

		expect(argumentNames(tool)).toEqual([
			"num_last_images_to_include",
			"prompt",
			"referenced_image_paths",
			"transparent_background",
		]);
		respond = () =>
			Response.json({ data: [{ b64_json: Buffer.from(TRANSLUCENT_PNG).toString("base64") }], size: "1x1" });
		const result = await tool.execute("c", { prompt: "a fox" }, undefined, undefined, openaiContext());
		savedFiles.push(...outputPathsOf(result));

		expect(requests[0]?.url).toBe("https://chatgpt.com/backend-api/codex/images/generations");
	});

	test("an invalid imageGenerationMode fails every call with a configuration error and sends nothing", async () => {
		for (const value of ["dall-e", ""]) {
			const tool = await loadTool({ imageGenerationMode: value });

			const error = await failure(tool.execute("c", { prompt: "a fox" }, undefined, undefined, openaiContext()));

			expect(error.message).toContain("imageGenerationMode");
			expect(error.message).toContain(JSON.stringify(value));
			expect(error.message).toContain("openai");
			expect(error.message).toContain("codex");
		}
		expect(requests).toHaveLength(0);
	});

	test("a new session binds a changed mode while a running call keeps its own", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "generate-image-project-"));
		try {
			const session = await loadSession({ imageGenerationMode: "openai" }, dir);
			const before = session.tool();
			let release: () => void = () => {};
			respond = () => new Promise(resolve => (release = () => resolve(imagesResponse())));
			const running = before.execute("c", { prompt: "first" }, undefined, undefined, openaiContext());
			await Bun.sleep(0);

			writePluginSettings(dir, { imageGenerationMode: "codex" });
			respond = () => imagesResponse();
			savedFiles.push(...outputPathsOf(await before.execute("c", { prompt: "same session" }, undefined, undefined, openaiContext())));
			await session.emit("session_switch", { cwd: dir });
			release();
			savedFiles.push(...outputPathsOf(await running));

			expect(argumentNames(session.tool())).toContain("transparent_background");
			respond = () =>
				Response.json({ data: [{ b64_json: Buffer.from(TRANSLUCENT_PNG).toString("base64") }], size: "1x1" });
			savedFiles.push(...outputPathsOf(await session.tool().execute("c", { prompt: "next" }, undefined, undefined, openaiContext())));

			expect(requests.map(request => request.url)).toEqual([
				GENERATIONS_URL,
				GENERATIONS_URL,
				"https://chatgpt.com/backend-api/codex/images/generations",
			]);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("generation", () => {
	test("posts the prompt unchanged to Sunburst with the openai key and returns a lossless WebP", async () => {
		const prompt = "  A red fox.\nKeep the snow   untouched. ";

		const result = await run({ prompt });

		expect(requests).toHaveLength(1);
		const [request] = requests;
		expect(request?.url).toBe(GENERATIONS_URL);
		expect(request?.headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
		expect(request?.headers.get("content-type")).toBe("application/json");
		expect(request?.headers.has("chatgpt-account-id")).toBe(false);
		expect(request?.body).toEqual({ model: "gpt-image-2.5-sunburst", prompt, output_format: "png" });

		const [image, ...more] = imagesOf(result);
		expect(more).toHaveLength(0);
		expect(image?.mimeType).toBe("image/webp");
		expect(isLosslessWebp(image?.bytes ?? new Uint8Array())).toBe(true);
		expect(await visiblePixels(image?.bytes ?? new Uint8Array())).toEqual(await visiblePixels(TRANSLUCENT_PNG));

		const [saved, ...otherSaved] = outputPathsOf(result);
		expect(otherSaved).toHaveLength(0);
		expect(path.dirname(saved ?? "")).toBe(os.tmpdir());
		expect(path.basename(saved ?? "")).toMatch(/^omp-image-.+\.webp$/);
		expect(Buffer.from(await Bun.file(saved ?? "").bytes()).equals(image?.bytes ?? Buffer.alloc(0))).toBe(true);
		expect(textOf(result)).toContain(saved ?? "missing");
		expect(textOf(result)).toContain("1024x1024, quality medium");
	});

	test("sends the pinned Sunburst snapshot when asked", async () => {
		await run({ prompt: "x", model: "gpt-image-2.5-sunburst-2026-09-08" });

		expect(requests[0]?.body.model).toBe("gpt-image-2.5-sunburst-2026-09-08");
	});

	test("keeps requested settings apart from what the API reported, with the request id", async () => {
		const result = await run({ prompt: "x" });

		expect(result.details).toMatchObject({
			mode: "openai",
			requested: { model: "gpt-image-2.5-sunburst", output_format: "png" },
			reported: { background: "opaque", output_format: "png", quality: "medium", size: "1024x1024" },
			usage: { input_tokens: 12, output_tokens: 1056, total_tokens: 1068 },
			requestId: "req_abc",
		});
		const details = result.details as Record<string, unknown>;
		for (const key of ["generationId", "quotaWarning", "outputTokens", "images"]) expect(details).not.toHaveProperty(key);
	});
});

describe("arguments", () => {
	test("rejects unknown arguments, including Codex's transparent_background, before any request", async () => {
		const tool = await openaiTool();

		const error = await failure(
			tool.execute("c", { prompt: "x", transparent_background: true }, undefined, undefined, openaiContext()),
		);

		expect(error.message).toContain("Unknown argument(s): transparent_background.");
		expect(requests).toHaveLength(0);
	});

	test("rejects a model other than the Sunburst alias or snapshot", async () => {
		const tool = await openaiTool();

		const error = await failure(tool.execute("c", { prompt: "x", model: "gpt-image-2" }, undefined, undefined, openaiContext()));

		expect(error.message).toContain("model");
		expect(requests).toHaveLength(0);
	});

	test("accepts a 32,000-character prompt and rejects a longer one", async () => {
		await run({ prompt: "a".repeat(32_000) });
		const tool = await openaiTool();

		const error = await failure(tool.execute("c", { prompt: "a".repeat(32_001) }, undefined, undefined, openaiContext()));

		expect(error.message).toContain("prompt");
		expect(requests).toHaveLength(1);
	});
});

describe("credentials and routing", () => {
	test("explains that a Codex login does not cover OpenAI mode and sends nothing", async () => {
		const tool = await openaiTool();
		const context = fakeContext({ credentials: { "openai-codex": codexToken(), openai: undefined } });

		const error = await failure(tool.execute("c", { prompt: "x" }, undefined, undefined, context));

		expect(error.message).toContain("openai");
		expect(error.message).toContain("OPENAI_API_KEY");
		expect(error.message).toContain("Codex");
		expect(error.message).toContain("imageGenerationMode");
		expect(requests).toHaveLength(0);
	});

	test("sends the openai provider's organization and project headers", async () => {
		await run(
			{ prompt: "x" },
			{ openaiHeaders: { "openai-organization": "org-1", "OpenAI-Project": "proj-1", "X-Other": "kept out" } },
		);

		const headers = requests[0]?.headers;
		expect(headers?.get("openai-organization")).toBe("org-1");
		expect(headers?.get("openai-project")).toBe("proj-1");
		expect(headers?.has("x-other")).toBe(false);
	});

	test("falls back to OPENAI_ORG_ID and OPENAI_PROJECT_ID like the OpenAI SDKs", async () => {
		const saved = { org: process.env.OPENAI_ORG_ID, project: process.env.OPENAI_PROJECT_ID };
		process.env.OPENAI_ORG_ID = "org-env";
		process.env.OPENAI_PROJECT_ID = "proj-env";
		try {
			await run({ prompt: "x" });
		} finally {
			for (const [key, value] of [["OPENAI_ORG_ID", saved.org], ["OPENAI_PROJECT_ID", saved.project]] as const) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}

		expect(requests[0]?.headers.get("openai-organization")).toBe("org-env");
		expect(requests[0]?.headers.get("openai-project")).toBe("proj-env");
	});

	test("refuses to send the openai credential when the provider points at another endpoint", async () => {
		const tool = await openaiTool();
		const context = openaiContext({ openaiBaseUrl: "https://proxy.example.com/v1" });

		const error = await failure(tool.execute("c", { prompt: "x" }, undefined, undefined, context));

		expect(error.message).toContain("https://proxy.example.com/v1");
		expect(error.message).toContain("https://api.openai.com/v1");
		expect(requests).toHaveLength(0);
	});
});

describe("errors", () => {
	async function errorFor(response: () => Response): Promise<Error> {
		respond = response;
		const tool = await openaiTool();
		return failure(tool.execute("c", { prompt: "x" }, undefined, undefined, openaiContext()));
	}

	const apiError = (status: number, error: Record<string, unknown>) => () =>
		Response.json({ error }, { status, headers: { "x-request-id": "req_err" } });

	test("tells credit exhaustion apart from rate limiting, without a Codex reset time", async () => {
		const exhausted = await errorFor(
			apiError(429, { message: "You exceeded your current quota.", code: "credit_balance_exhausted", type: "insufficient_quota" }),
		);
		const limited = await errorFor(
			apiError(429, { message: "Rate limit reached for images per minute.", code: "rate_limit_exceeded", type: "requests" }),
		);

		expect(exhausted.message).toContain("credits");
		expect(exhausted.message).toContain("credit_balance_exhausted");
		expect(exhausted.message).toContain("req_err");
		expect(limited.message).toContain("rate limit");
		expect(limited.message).not.toContain("credits are exhausted");
		for (const message of [exhausted.message, limited.message]) expect(message).not.toContain("resets at");
		expect(requests).toHaveLength(2);
	});

	test("reports authentication, permission, and moderation refusals with the provider's message", async () => {
		const auth = await errorFor(apiError(401, { message: "Incorrect API key provided.", code: "invalid_api_key" }));
		const permission = await errorFor(
			apiError(403, { message: "Your organization must be verified to use this model.", code: null }),
		);
		const moderation = await errorFor(
			apiError(400, { message: "Your request was rejected by the safety system.", code: "moderation_blocked" }),
		);

		expect(auth.message).toContain("HTTP 401");
		expect(auth.message).toContain("Incorrect API key provided.");
		expect(permission.message).toContain("HTTP 403");
		expect(permission.message).toContain("Your organization must be verified to use this model.");
		expect(moderation.message).toContain("Your request was rejected by the safety system.");
		expect(moderation.message).toContain("moderation_blocked");
		for (const error of [auth, permission, moderation]) expect(error.message).toContain("req_err");
		expect(requests).toHaveLength(3);
	});

	test("fails a malformed or empty response without saving anything", async () => {
		const before = savedImageFiles();

		const malformed = await errorFor(() => new Response("<html>bad gateway</html>", { status: 200 }));
		const empty = await errorFor(() => imagesResponse({ data: [] }));

		expect(malformed.message).toContain("invalid JSON");
		expect(empty.message).toContain("no image");
		expect(savedImageFiles()).toEqual(before);
	});

	test("times out after five minutes", async () => {
		const timeout = new AbortController();
		const timeoutSpy = spyOn(AbortSignal, "timeout").mockImplementation((milliseconds: number) => {
			expect(milliseconds).toBe(5 * 60 * 1000);
			return timeout.signal;
		});
		respond = (_request, signal) =>
			new Promise((_resolve, reject) => {
				signal?.addEventListener("abort", () => reject(signal.reason));
				timeout.abort(new DOMException("timed out", "TimeoutError"));
			});
		try {
			const error = await failure((await openaiTool()).execute("c", { prompt: "x" }, undefined, undefined, openaiContext()));

			expect(error.message).toContain("timed out after 5 minutes");
		} finally {
			timeoutSpy.mockRestore();
		}
	});

	test("an abort during the request or before the image is saved publishes nothing", async () => {
		const before = savedImageFiles();
		const duringRequest = new AbortController();
		respond = (_request, signal) =>
			new Promise((_resolve, reject) => {
				signal?.addEventListener("abort", () => reject(signal.reason));
				duringRequest.abort();
			});
		const tool = await openaiTool();
		const first = await failure(tool.execute("c", { prompt: "x" }, duringRequest.signal, undefined, openaiContext()));

		const afterResponse = new AbortController();
		respond = () => {
			const response = imagesResponse();
			afterResponse.abort();
			return response;
		};
		const second = await failure(tool.execute("c", { prompt: "x" }, afterResponse.signal, undefined, openaiContext()));

		expect(first.name).toBe("ToolAbortError");
		expect(second.name).toBe("ToolAbortError");
		expect(savedImageFiles()).toEqual(before);
	});

	test("an abort while the images are written removes them and publishes nothing", async () => {
		const before = savedImageFiles();
		const controller = new AbortController();
		const write = Bun.write;
		const writeSpy = spyOn(Bun, "write").mockImplementation((async (...args: Parameters<typeof Bun.write>) => {
			const written = await write(...args);
			controller.abort();
			return written;
		}) as typeof Bun.write);
		respond = () => imagesResponse();
		try {
			const error = await failure((await openaiTool()).execute("c", { prompt: "x" }, controller.signal, undefined, openaiContext()));

			expect(error.name).toBe("ToolAbortError");
			expect(writeSpy).toHaveBeenCalled();
			expect(savedImageFiles()).toEqual(before);
		} finally {
			writeSpy.mockRestore();
		}
	});

	test("a failed write waits for every write, removes every image, and keeps the first failure", async () => {
		const before = savedImageFiles();
		const write = Bun.write;
		const rm = fsp.rm;
		const gate = Promise.withResolvers<void>();
		const held = Promise.withResolvers<void>();
		let writes = 0;
		let pending = 0;
		let removals = 0;
		let removedWhilePending = false;
		const writeSpy = spyOn(Bun, "write").mockImplementation((async (...args: Parameters<typeof Bun.write>) => {
			const index = writes++;
			if (index === 1) throw new Error("disk full");
			pending += 1;
			if (pending === 2) held.resolve();
			try {
				await gate.promise;
				if (index === 0) throw new Error("later failure");
				return await write(...args);
			} finally {
				pending -= 1;
			}
		}) as typeof Bun.write);
		const rmSpy = spyOn(fsp, "rm").mockImplementation((async (...args: Parameters<typeof fsp.rm>) => {
			if (pending > 0) removedWhilePending = true;
			if (removals++ === 0) throw new Error("cannot remove");
			return rm(...args);
		}) as typeof fsp.rm);
		const pngs = [2, 3, 4].map(width => encodePng(width, 2, () => [0, 0, 0, 255]));
		respond = () => imagesResponse({ data: pngs.map(png => ({ b64_json: Buffer.from(png).toString("base64") })) });
		try {
			const call = failure((await openaiTool()).execute("c", { prompt: "x", n: 3 }, undefined, undefined, openaiContext()));
			await held.promise;
			await setImmediate();
			gate.resolve();
			const error = await call;

			expect(removedWhilePending).toBe(false);
			expect(savedImageFiles()).toEqual(before);
			expect(error.message).toBe("disk full");
		} finally {
			writeSpy.mockRestore();
			rmSpy.mockRestore();
		}
	});
});

describe("results saved before Image generation modes", () => {
	const legacy = {
		path: path.join(os.tmpdir(), "omp-image-legacy.webp"),
		size: "1254x1254",
		quality: "low",
		quotaWarning: "Image generation limit 85% used.",
		requestId: "req-legacy",
	};

	test("still show their saved path and quota warning in either mode", async () => {
		for (const mode of ["openai", "codex"]) {
			const tool = await loadTool({ imageGenerationMode: mode });
			const result = { content: [{ type: "text" as const, text: "Generated image saved." }], details: structuredClone(legacy) };

			const view = tool.describeResult?.(result as never, { expanded: false, isPartial: false }, { prompt: "a fox" });

			expect(cardLinks(view)).toEqual([legacy.path]);
			expect(JSON.stringify(view)).toContain(legacy.quotaWarning);
		}
	});
});

async function rejected(params: Record<string, unknown>): Promise<Error> {
	const error = await failure((await openaiTool()).execute("c", params, undefined, undefined, openaiContext()));
	expect(requests).toHaveLength(0);
	return error;
}

describe("multiple outputs", () => {
	test("saves and returns every final image in provider order, each named once", async () => {
		const pngs = [2, 3, 4].map(width => encodePng(width, 2, () => [width * 50, 0, 0, 255]));
		respond = () => imagesResponse({ data: pngs.map(png => ({ b64_json: Buffer.from(png).toString("base64") })) });

		const result = await run({ prompt: "three foxes", n: 3 });

		expect(requests[0]?.body.n).toBe(3);
		const images = imagesOf(result);
		expect(await Promise.all(images.map(async image => (await rgbaPixels(image.bytes)).width))).toEqual([2, 3, 4]);
		const paths = outputPathsOf(result);
		expect(new Set(paths).size).toBe(3);
		for (const [index, saved] of paths.entries()) {
			expect(Buffer.from(await Bun.file(saved).bytes()).equals(images[index]?.bytes ?? Buffer.alloc(0))).toBe(true);
		}
		const text = textOf(result);
		expect(paths.map(saved => text.indexOf(saved))).toEqual([...paths.map(saved => text.indexOf(saved))].sort((a, b) => a - b));
		for (const saved of paths) expect(text.split(saved)).toHaveLength(2);
		expect(result.details).not.toHaveProperty("images");
	});

	test("the result card lists every saved path once", async () => {
		const pngs = [2, 3].map(width => encodePng(width, 2, () => [0, 0, 0, 255]));
		respond = () => imagesResponse({ data: pngs.map(png => ({ b64_json: Buffer.from(png).toString("base64") })) });
		const tool = await openaiTool();
		const args = { prompt: "two foxes", n: 2 };
		const result = await tool.execute("c", args, undefined, undefined, openaiContext());
		savedFiles.push(...outputPathsOf(result));

		const view = tool.describeResult?.(result, { expanded: false, isPartial: false }, args);

		expect(cardLinks(view)).toEqual(outputPathsOf(result));
	});


	test("rejects n outside 1 to 10 or not an integer before any request", async () => {
		for (const n of [0, 11, 1.5]) {
			const error = await rejected({ prompt: "x", n });
			expect(error.message).toContain("n must be");
		}
	});
});

describe("output formats", () => {
	const formats = [
		{ output_format: "png", extension: ".png", mimeType: "image/png", encode: (png: Uint8Array) => png },
		{ output_format: "jpeg", extension: ".jpg", mimeType: "image/jpeg", encode: (png: Uint8Array) => new Bun.Image(png).jpeg({ quality: 60 }).bytes() },
		{ output_format: "webp", extension: ".webp", mimeType: "image/webp", encode: (png: Uint8Array) => new Bun.Image(png).webp({ quality: 60 }).bytes() },
	] as const;

	for (const format of formats) {
		test(`an explicit ${format.output_format} is saved and returned byte-identical to the API's bytes`, async () => {
			const bytes = Buffer.from(await format.encode(TRANSLUCENT_PNG));
			respond = () => imagesResponse({ data: [{ b64_json: bytes.toString("base64") }], output_format: format.output_format });

			const result = await run({ prompt: "x", output_format: format.output_format });

			expect(requests[0]?.body.output_format).toBe(format.output_format);
			const [image] = imagesOf(result);
			expect(image?.mimeType).toBe(format.mimeType);
			expect(image?.bytes.equals(bytes)).toBe(true);
			const [saved] = outputPathsOf(result);
			expect(path.extname(saved ?? "")).toBe(format.extension);
			expect(Buffer.from(await Bun.file(saved ?? "").bytes()).equals(bytes)).toBe(true);
		});
	}

	test("a null output_format keeps the default lossless WebP policy", async () => {
		const result = await run({ prompt: "x", output_format: null });

		expect(requests[0]?.body.output_format).toBe("png");
		const [image] = imagesOf(result);
		expect(image?.mimeType).toBe("image/webp");
		expect(isLosslessWebp(image?.bytes ?? new Uint8Array())).toBe(true);
	});

	test("sends output_compression for JPEG and WebP", async () => {
		for (const output_format of ["jpeg", "webp"] as const) {
			const bytes = await (output_format === "jpeg" ? new Bun.Image(TRANSLUCENT_PNG).jpeg() : new Bun.Image(TRANSLUCENT_PNG).webp()).bytes();
			respond = () => imagesResponse({ data: [{ b64_json: Buffer.from(bytes).toString("base64") }] });
			await run({ prompt: "x", output_format, output_compression: 40 });
		}

		expect(requests.map(request => [request.body.output_format, request.body.output_compression])).toEqual([
			["jpeg", 40],
			["webp", 40],
		]);
	});

	test("rejects output_compression with PNG or the default policy, and outside 0 to 100", async () => {
		for (const params of [
			{ output_format: "png", output_compression: 50 },
			{ output_compression: 50 },
			{ output_format: "jpeg", output_compression: 101 },
			{ output_format: "jpeg", output_compression: -1 },
			{ output_format: "webp", output_compression: 50.5 },
		]) {
			const error = await rejected({ prompt: "x", ...params });
			expect(error.message).toContain("output_compression");
		}
	});
});

describe("background", () => {
	const alphaPng = encodePng(4, 3, x => [255, 0, 0, x === 0 ? 0 : 128]);

	test("sends each background choice", async () => {
		for (const background of ["auto", "opaque", "transparent"]) await run({ prompt: "x", background });

		expect(requests.map(request => request.body.background)).toEqual(["auto", "opaque", "transparent"]);
	});

	test("keeps alpha in a transparent result under the default policy, PNG, and WebP", async () => {
		const webp = await new Bun.Image(alphaPng).webp({ lossless: true }).bytes();
		for (const [output_format, bytes] of [[undefined, alphaPng], ["png", alphaPng], ["webp", webp]] as const) {
			respond = () => imagesResponse({ data: [{ b64_json: Buffer.from(bytes).toString("base64") }], background: "transparent" });
			const result = await run({ prompt: "a sticker", background: "transparent", ...(output_format ? { output_format } : {}) });
			const [image] = imagesOf(result);
			const alpha = [];
			const { rgba } = await rgbaPixels(image?.bytes ?? new Uint8Array());
			for (let i = 3; i < rgba.length; i += 4) alpha.push(rgba[i]);
			expect(Math.min(...(alpha as number[]))).toBe(0);
			expect(alpha).toContain(128);
		}
	});

	test("rejects a transparent background with JPEG output before any request", async () => {
		const error = await rejected({ prompt: "x", background: "transparent", output_format: "jpeg" });

		expect(error.message).toContain("transparent");
		expect(error.message).toContain("jpeg");
	});
});

describe("quality, size, and moderation", () => {
	test("sends every Sunburst quality and rejects legacy ones", async () => {
		const qualities = ["auto", "low", "medium", "high", "xhigh", "max"];
		for (const quality of qualities) await run({ prompt: "x", quality });
		expect(requests.map(request => request.body.quality)).toEqual(qualities);

		requests = [];
		for (const quality of ["standard", "hd"]) expect((await rejected({ prompt: "x", quality })).message).toContain("quality");
	});

	test("sends auto, the standard sizes, and valid custom sizes", async () => {
		const sizes = ["auto", "1024x1024", "1536x1024", "1024x1536", "1536x864", "3840x2160", "2160x3840", "816x816"];
		for (const size of sizes) await run({ prompt: "x", size });

		expect(requests.map(request => request.body.size)).toEqual(sizes);
	});

	test("rejects a custom size that breaks a documented rule, naming the rule", async () => {
		const cases = [
			["1000x1000", "multiples of 16"],
			["3072x1008", "1:3 and 3:1"],
			["3856x1296", "3840"],
			["800x800", "655,360"],
			["3840x2176", "8,294,400"],
			["big", "WIDTHxHEIGHT"],
		];
		for (const [size, rule] of cases) {
			const error = await rejected({ prompt: "x", size });
			expect(error.message).toContain(rule ?? "");
		}
	});


	test("sends moderation low and rejects other values", async () => {
		await run({ prompt: "x", moderation: "low" });

		expect(requests[0]?.body.moderation).toBe("low");
		requests = [];
		expect((await rejected({ prompt: "x", moderation: "none" })).message).toContain("moderation");
	});

	test("a null optional setting leaves the API default instead of a local one", async () => {
		await run({ prompt: "x", quality: null, size: null, moderation: null, background: null, n: null, model: null });

		expect(requests[0]?.body).toEqual({ model: "gpt-image-2.5-sunburst", prompt: "x", output_format: "png" });
	});

	test("rejects legacy and unsupported fields as unknown arguments", async () => {
		for (const field of ["response_format", "style", "input_fidelity"]) {
			const error = await rejected({ prompt: "x", [field]: "b64_json" });
			expect(error.message).toContain(`Unknown argument(s): ${field}.`);
		}
	});
});

describe("safety identifiers", () => {
	test("a nonempty safety_identifier wins over user, and user is sent alone otherwise", async () => {
		await run({ prompt: "x", safety_identifier: "hash-1", user: "legacy-1" });
		await run({ prompt: "x", safety_identifier: "", user: "legacy-2" });
		await run({ prompt: "x", user: "legacy-3" });

		expect(requests.map(request => [request.body.safety_identifier, request.body.user])).toEqual([
			["hash-1", undefined],
			[undefined, "legacy-2"],
			[undefined, "legacy-3"],
		]);
	});

	test("sends no identifier the caller did not give, and never shows one in the result", async () => {
		const result = await run({ prompt: "x", safety_identifier: "hash-secret" });
		await run({ prompt: "y" });

		expect(requests[1]?.body).not.toHaveProperty("safety_identifier");
		expect(requests[1]?.body).not.toHaveProperty("user");
		expect(textOf(result)).not.toContain("hash-secret");
		expect(JSON.stringify(result.details)).not.toContain("hash-secret");
	});

	test("accepts a 128-character safety_identifier and rejects a longer one", async () => {
		await run({ prompt: "x", safety_identifier: "a".repeat(128) });
		requests = [];

		expect((await rejected({ prompt: "x", safety_identifier: "a".repeat(129) })).message).toContain("safety_identifier");
	});
});

describe("edits with Reference images", () => {
	const EDITS_URL = "https://api.openai.com/v1/images/edits";
	let dir: string;
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "generate-image-openai-test-"));
	});
	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const sentUrls = () => (requests[0]?.body.images as { image_url?: string; file_id?: string }[] | undefined) ?? [];

	test("local paths become an edit with each image's own bytes as a data URL, in order", async () => {
		const png = encodePng(5, 3, () => [10, 200, 30, 255]);
		const jpeg = await new Bun.Image(png).jpeg().bytes();
		const webp = await new Bun.Image(png).webp({ quality: 70 }).bytes();
		const files = [path.join(dir, "a.png"), path.join(dir, "b.jpg"), path.join(dir, "c.webp")];
		await Promise.all(files.map((file, index) => Bun.write(file, [png, jpeg, webp][index] ?? png)));

		await run({ prompt: "make it blue", referenced_image_paths: files });

		expect(requests[0]?.url).toBe(EDITS_URL);
		expect(requests[0]?.body.prompt).toBe("make it blue");
		expect(sentUrls()).toEqual([
			{ image_url: `data:image/png;base64,${Buffer.from(png).toString("base64")}` },
			{ image_url: `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}` },
			{ image_url: `data:image/webp;base64,${Buffer.from(webp).toString("base64")}` },
		]);
	});

	test("native image URLs, data URLs, and file ids reach the API as given", async () => {
		const images = [
			{ image_url: "https://example.com/cat.png" },
			{ file_id: "file-abc" },
			{ image_url: "data:image/png;base64,AAAA" },
		];

		await run({ prompt: "combine", images });

		expect(requests[0]?.url).toBe(EDITS_URL);
		expect(sentUrls()).toEqual(images);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	test("rejects more than one reference source before any request, naming them", async () => {
		const file = path.join(dir, "a.png");
		await Bun.write(file, encodePng(2, 2, () => [0, 0, 0, 255]));
		const sources = {
			referenced_image_paths: [file],
			num_last_images_to_include: 1,
			images: [{ file_id: "file-1" }],
		};
		for (const [first, second] of [
			["referenced_image_paths", "images"],
			["num_last_images_to_include", "images"],
			["referenced_image_paths", "num_last_images_to_include"],
		] as const) {
			const error = await rejected({ prompt: "x", [first]: sources[first], [second]: sources[second] });
			expect(error.message).toContain(first);
			expect(error.message).toContain(second);
		}
	});

	test("accepts sixteen references from each source and rejects seventeen", async () => {
		const file = path.join(dir, "a.png");
		await Bun.write(file, encodePng(2, 2, () => [0, 0, 0, 255]));
		const branch = Array.from({ length: 17 }, (_, index) => ({
			type: "message",
			id: `m${index}`,
			message: { role: "user", content: [{ type: "image", data: Buffer.from(encodePng(2, 2, () => [index, 0, 0, 255])).toString("base64"), mimeType: "image/png" }] },
		}));
		await run({ prompt: "x", referenced_image_paths: Array(16).fill(file) });
		await run({ prompt: "x", images: Array.from({ length: 16 }, (_, index) => ({ file_id: `file-${index}` })) });
		await run({ prompt: "x", num_last_images_to_include: 16 }, { branch });
		expect(requests.map(request => (request.body.images as unknown[]).length)).toEqual([16, 16, 16]);

		requests = [];
		for (const params of [
			{ referenced_image_paths: Array(17).fill(file) },
			{ images: Array.from({ length: 17 }, (_, index) => ({ file_id: `file-${index}` })) },
			{ num_last_images_to_include: 17 },
		]) {
			await rejected({ prompt: "x", ...params });
		}
	});

	test("rejects an image URL over the documented length before any request", async () => {
		const error = await rejected({ prompt: "x", images: [{ image_url: `data:image/png;base64,${"A".repeat(20_971_520)}` }] });

		expect(error.message).toContain("image_url");
	});

	test("rejects relative and missing local paths before any request", async () => {
		const relative = await rejected({ prompt: "x", referenced_image_paths: ["images/a.png"] });
		const missing = await rejected({ prompt: "x", referenced_image_paths: [path.join(dir, "missing.png")] });

		expect(relative.message).toContain("must be absolute: images/a.png");
		expect(missing.message).toContain(`Reference image not found: ${path.join(dir, "missing.png")}`);
	});

	describe("recent conversation images", () => {
		const base64Png = (width: number) => Buffer.from(encodePng(width, width, () => [1, 2, 3, 255])).toString("base64");
		let branch: unknown[];
		beforeEach(() => {
			const duplicated = base64Png(5);
			const message = (value: Record<string, unknown>) => ({ type: "message", id: crypto.randomUUID(), message: value });
			branch = [
				message({ role: "user", content: [{ type: "text", text: "look" }, { type: "image", data: base64Png(2), mimeType: "image/png" }] }),
				message({ role: "assistant", content: [{ type: "text", text: "ok" }] }),
				message({ role: "toolResult", toolName: "read", content: [{ type: "image", data: base64Png(3), mimeType: "image/png" }] }),
				message({
					role: "toolResult",
					toolName: "generate_image",
					content: [{ type: "text", text: "Generated 1 image(s)" }],
					details: { images: [{ data: base64Png(4), mimeType: "image/png" }] },
				}),
				message({
					role: "toolResult",
					toolName: "other",
					content: [{ type: "image", data: duplicated, mimeType: "image/png" }],
					details: { images: [{ data: duplicated, mimeType: "image/png" }] },
				}),
			];
		});

		async function sentWidths(count: number): Promise<number[]> {
			await run({ prompt: "combine", num_last_images_to_include: count }, { branch });
			return Promise.all(
				sentUrls().map(async ({ image_url: url = "" }) => {
					const bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
					return (await new Bun.Image(bytes).metadata()).width;
				}),
			);
		}

		test("sends the last N images oldest first, counting a content and details copy once", async () => {
			const before = structuredClone(branch);

			expect(await sentWidths(4)).toEqual([2, 3, 4, 5]);
			expect(sentUrls()[0]?.image_url).toBe(`data:image/png;base64,${base64Png(2)}`);
			expect(branch).toEqual(before);
		});

		test("errors when the conversation has fewer images than requested", async () => {
			const tool = await openaiTool();
			const error = await failure(
				tool.execute("c", { prompt: "x", num_last_images_to_include: 5 }, undefined, undefined, openaiContext({ branch })),
			);

			expect(error.message).toBe("num_last_images_to_include is 5, but the conversation has only 4 images.");
			expect(requests).toHaveLength(0);
		});
	});

	test("applies no Codex body cap or dropped-reference check", async () => {
		const big = path.join(dir, "big.jpg");
		const bytes = new Uint8Array(51 * 1024 * 1024);
		bytes.set([0xff, 0xd8, 0xff]);
		await Bun.write(big, bytes);
		respond = () => imagesResponse({ usage: { input_tokens_details: { image_tokens: 0, text_tokens: 9 } } });

		const result = await run({ prompt: "x", referenced_image_paths: [big] });

		expect(requests[0]?.url).toBe(EDITS_URL);
		expect(outputPathsOf(result)).toHaveLength(1);
	});
});

describe("mask and markup", () => {
	let dir: string;
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "generate-image-openai-test-"));
	});
	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const dataUrl = (bytes: Uint8Array, mime = "image/png") => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
	const image8x4 = encodePng(8, 4, x => [x * 30, 90, 40, 255]);
	const mask8x4 = encodePng(8, 4, x => [0, 0, 0, x < 4 ? 0 : 255]);
	const overlay8x4 = encodePng(8, 4, x => [255, 0, 0, x === 0 ? 255 : 0]);

	async function file(name: string, bytes: Uint8Array): Promise<string> {
		const target = path.join(dir, name);
		await Bun.write(target, bytes);
		return target;
	}

	test("a valid local mask and a data-URL markup reach the API byte-identical", async () => {
		const image = await file("image.png", image8x4);
		const mask = await file("mask.png", mask8x4);

		await run({ prompt: "add a pool", referenced_image_paths: [image], mask: { path: mask } });
		await run({ prompt: "follow the marks", referenced_image_paths: [image], markup: { image_url: dataUrl(overlay8x4) } });

		expect(requests[0]?.body.mask).toEqual({ image_url: dataUrl(mask8x4) });
		expect(requests[1]?.body.markup).toEqual({ image_url: dataUrl(overlay8x4) });
		expect(requests.map(request => request.url)).toEqual([
			"https://api.openai.com/v1/images/edits",
			"https://api.openai.com/v1/images/edits",
		]);
	});

	test("rejects a local or data-URL mask that breaks a documented rule, naming the rule", async () => {
		const image = await file("image.png", image8x4);
		const jpegImage = await file("image.jpg", await new Bun.Image(image8x4).jpeg().bytes());
		const cases: [Record<string, unknown>, string][] = [
			[{ referenced_image_paths: [image], mask: { path: await file("rgb.png", encodePng(8, 4, () => [0, 0, 0, 255], { alpha: false })) } }, "alpha channel"],
			[{ referenced_image_paths: [image], mask: { image_url: dataUrl(encodePng(4, 4, () => [0, 0, 0, 0])) } }, "8x4"],
			[{ referenced_image_paths: [jpegImage], mask: { path: await file("mask.png", mask8x4) } }, "same format"],
		];
		for (const [params, rule] of cases) {
			const error = await rejected({ prompt: "x", ...params });
			expect(error.message).toContain("mask");
			expect(error.message).toContain(rule);
		}
	});

	test("rejects a markup that is not PNG, has no transparent pixels, or misses the first image's size", async () => {
		const image = await file("image.png", image8x4);
		const cases: [Record<string, unknown>, string][] = [
			[{ markup: { image_url: dataUrl(await new Bun.Image(overlay8x4).webp({ lossless: true }).bytes(), "image/webp") } }, "PNG"],
			[{ markup: { path: await file("opaque.png", encodePng(8, 4, () => [255, 0, 0, 255])) } }, "transparent"],
			[{ markup: { image_url: dataUrl(encodePng(4, 8, () => [0, 0, 0, 0])) } }, "8x4"],
		];
		for (const [params, rule] of cases) {
			const error = await rejected({ prompt: "x", referenced_image_paths: [image], ...params });
			expect(error.message).toContain("markup");
			expect(error.message).toContain(rule);
		}
	});

	test("compares markup with the first image's size after its EXIF orientation", async () => {
		const rotated = await file("rotated.jpg", await jpegWithOrientation(image8x4, 6));
		const upright = dataUrl(encodePng(4, 8, y => [0, 0, 0, y === 0 ? 255 : 0]));

		await run({ prompt: "x", referenced_image_paths: [rotated], markup: { image_url: upright } });
		requests = [];
		const error = await rejected({ prompt: "x", referenced_image_paths: [rotated], markup: { image_url: dataUrl(overlay8x4) } });

		expect(error.message).toContain("4x8");
	});

	test("rejects mask with markup, and either one without Reference images", async () => {
		const image = await file("image.png", image8x4);
		const mask = { image_url: dataUrl(mask8x4) };
		const markup = { image_url: dataUrl(overlay8x4) };

		const both = await rejected({ prompt: "x", referenced_image_paths: [image], mask, markup });
		const maskAlone = await rejected({ prompt: "x", mask });
		const markupAlone = await rejected({ prompt: "x", markup });

		expect(both.message).toContain("mask and markup");
		for (const error of [maskAlone, markupAlone]) expect(error.message).toContain("Reference image");
	});

	test("remote URL and file-id masks and markups pass through unchecked", async () => {
		const images = [{ file_id: "file-image" }];

		await run({ prompt: "x", images, mask: { file_id: "file-mask" } });
		await run({ prompt: "x", images, markup: { image_url: "https://example.com/marks.png" } });

		expect(requests[0]?.body.mask).toEqual({ file_id: "file-mask" });
		expect(requests[1]?.body.markup).toEqual({ image_url: "https://example.com/marks.png" });
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});
});

describe("streaming", () => {
	const PREVIEW_A = encodePng(6, 4, () => [10, 10, 10, 255]);
	const PREVIEW_B = encodePng(6, 4, () => [20, 20, 20, 255]);
	const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

	function sse(events: Record<string, unknown>[], { chunkSize = 7, tail = "" } = {}): Response {
		const text = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("") + tail;
		const bytes = new TextEncoder().encode(text);
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				for (let offset = 0; offset < bytes.length; offset += chunkSize) controller.enqueue(bytes.subarray(offset, offset + chunkSize));
				controller.close();
			},
		});
		return new Response(stream, { headers: { "content-type": "text/event-stream", "x-request-id": "req_stream" } });
	}

	const partial = (kind: string, index: number, png: Uint8Array) => ({
		type: `${kind}.partial_image`,
		b64_json: b64(png),
		partial_image_index: index,
		output_format: "png",
		size: "1024x1024",
		quality: "medium",
		background: "opaque",
	});
	const completed = (kind: string, png: Uint8Array = TRANSLUCENT_PNG) => ({
		type: `${kind}.completed`,
		b64_json: b64(png),
		output_format: "png",
		size: "1024x1024",
		quality: "medium",
		background: "opaque",
		usage: { input_tokens: 10, output_tokens: 1256, total_tokens: 1266 },
	});

	async function streamed(params: Record<string, unknown>, options: FakeContextOptions = {}) {
		const updates: { content: { type: string; data?: string; mimeType?: string; text?: string }[]; details?: unknown }[] = [];
		const tool = await openaiTool();
		const result = await tool.execute("c", params, undefined, update => updates.push(update as never), openaiContext(options));
		savedFiles.push(...outputPathsOf(result));
		return { result, updates, tool };
	}

	test("a split-chunk generation stream shows each preview, then saves the final image as a non-streamed one", async () => {
		respond = () => sse([partial("image_generation", 0, PREVIEW_A), partial("image_generation", 1, PREVIEW_B), completed("image_generation")]);

		const { result, updates } = await streamed({ prompt: "x", stream: true, partial_images: 2 });

		expect(requests[0]?.body).toMatchObject({ stream: true, partial_images: 2 });
		expect(updates.map(update => update.content.find(block => block.type === "image")?.data)).toEqual([b64(PREVIEW_A), b64(PREVIEW_B)]);
		for (const update of updates) {
			expect(update.details).toMatchObject({ stage: "preview" });
			expect(update.content.find(block => block.type === "text")?.text).toContain("not a final image");
		}
		const [image, ...more] = imagesOf(result);
		expect(more).toHaveLength(0);
		expect(isLosslessWebp(image?.bytes ?? new Uint8Array())).toBe(true);
		expect(await visiblePixels(image?.bytes ?? new Uint8Array())).toEqual(await visiblePixels(TRANSLUCENT_PNG));
		expect(outputPathsOf(result)).toHaveLength(1);
		expect(result.details).toMatchObject({ requestId: "req_stream", usage: { output_tokens: 1256 }, reported: { size: "1024x1024" } });
	});

	test("a streamed edit uses the edit events", async () => {
		respond = () => sse([partial("image_edit", 0, PREVIEW_A), completed("image_edit")]);

		const { result, updates } = await streamed({ prompt: "x", images: [{ file_id: "file-1" }], stream: true, partial_images: 1 });

		expect(requests[0]?.url).toBe("https://api.openai.com/v1/images/edits");
		expect(updates).toHaveLength(1);
		expect(outputPathsOf(result)).toHaveLength(1);
	});

	test("partial_images 0, and fewer previews than asked for, still end with every final image", async () => {
		respond = () => sse([completed("image_generation")]);
		const none = await streamed({ prompt: "x", stream: true, partial_images: 0 });
		respond = () => sse([partial("image_generation", 0, PREVIEW_A), completed("image_generation")]);
		const fewer = await streamed({ prompt: "x", stream: true, partial_images: 3 });
		const pngs = [2, 3].map(width => encodePng(width, 2, () => [0, 0, 0, 255]));
		respond = () => sse(pngs.map(png => completed("image_generation", png)));
		const two = await streamed({ prompt: "x", stream: true, n: 2 });

		expect(none.updates).toHaveLength(0);
		expect(outputPathsOf(none.result)).toHaveLength(1);
		expect(fewer.updates).toHaveLength(1);
		expect(outputPathsOf(fewer.result)).toHaveLength(1);
		expect(await Promise.all(imagesOf(two.result).map(async image => (await rgbaPixels(image.bytes)).width))).toEqual([2, 3]);
	});

	test("an error event, a missing completion, or a malformed event fails the call and saves nothing", async () => {
		const before = savedImageFiles();
		const cases: [() => Response, string][] = [
			[
				() => sse([partial("image_generation", 0, PREVIEW_A), { type: "error", error: { message: "Image generation failed.", code: "server_error" } }]),
				"Image generation failed.",
			],
			[() => sse([partial("image_generation", 0, PREVIEW_A)]), "ended after 0 of 1 final image"],
			[() => sse([partial("image_generation", 0, PREVIEW_A)], { tail: "data: {not json\n\n" }), "malformed"],
		];
		for (const [response, message] of cases) {
			respond = response;
			const tool = await openaiTool();
			const error = await failure(tool.execute("c", { prompt: "x", stream: true, partial_images: 1 }, undefined, () => {}, openaiContext()));
			expect(error.message).toContain(message);
			expect(error.message).toContain("req_stream");
		}
		expect(savedImageFiles()).toEqual(before);
	});

	test("aborting while the stream is read stops it and publishes nothing", async () => {
		const controller = new AbortController();
		const before = savedImageFiles();
		respond = (_request, signal) => {
			const encoder = new TextEncoder();
			const stream = new ReadableStream<Uint8Array>({
				start(stream) {
					stream.enqueue(encoder.encode(`data: ${JSON.stringify(partial("image_generation", 0, PREVIEW_A))}\n\n`));
					signal?.addEventListener("abort", () => stream.error(signal.reason));
				},
			});
			return new Response(stream, { headers: { "content-type": "text/event-stream" } });
		};
		const tool = await openaiTool();

		const error = await failure(
			tool.execute("c", { prompt: "x", stream: true, partial_images: 1 }, controller.signal, () => controller.abort(), openaiContext()),
		);

		expect(error.name).toBe("ToolAbortError");
		expect(savedImageFiles()).toEqual(before);
	});

	test("rejects partial_images outside 0 to 3, or without stream, before any request", async () => {
		for (const params of [{ stream: true, partial_images: 4 }, { stream: true, partial_images: 1.5 }, { partial_images: 1 }, { stream: false, partial_images: 2 }]) {
			const error = await rejected({ prompt: "x", ...params });
			expect(error.message).toContain("partial_images");
		}
	});

	test("the card shows a preview as in progress, then only the final images", async () => {
		respond = () => sse([partial("image_generation", 0, PREVIEW_A), completed("image_generation")]);
		const args = { prompt: "x", stream: true, partial_images: 1 };
		const { result, updates, tool } = await streamed(args);

		const previewView = JSON.stringify(tool.describeResult?.(updates[0] as never, { expanded: false, isPartial: true }, args));
		const finalView = JSON.stringify(tool.describeResult?.(result, { expanded: false, isPartial: false }, args));

		expect(previewView).toContain("in progress");
		expect(previewView).not.toContain("Saved to");
		expect(finalView).toContain("Saved to");
		expect(finalView).not.toContain("in progress");
	});

});
