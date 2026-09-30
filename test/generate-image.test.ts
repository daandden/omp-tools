import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { USER_AGENT } from "@oh-my-pi/pi-utils";
import { alphaValues, codexToken, encodePng, fakeContext, isLosslessWebp, loadTool } from "./support";

const GENERATIONS_URL = "https://chatgpt.com/backend-api/codex/images/generations";

interface CapturedRequest {
	url: string;
	headers: Headers;
	body: string;
}

let requests: CapturedRequest[];
let respond: (request: CapturedRequest, signal: AbortSignal | undefined) => Response | Promise<Response>;
let savedFiles: string[];

const OPAQUE_PNG = encodePng(8, 6, (x, y) => [x * 30, y * 40, 200, 255]);

function imageResponse(overrides: Record<string, unknown> = {}, png: Uint8Array = OPAQUE_PNG): Response {
	return Response.json({
		created: 1,
		background: "opaque",
		data: [{ b64_json: Buffer.from(png).toString("base64") }],
		output_format: "png",
		quality: "low",
		size: "1370x1148",
		usage: { input_tokens: 20, input_tokens_details: { image_tokens: 0, text_tokens: 20 } },
		...overrides,
	});
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
	return result.content
		.filter(block => block.type === "text")
		.map(block => block.text)
		.join("\n");
}

function savedPathOf(result: { content: { type: string; text?: string }[] }): string {
	const match = / as (\S+\.webp) by default/.exec(textOf(result));
	if (!match?.[1]) throw new Error(`no saved path in: ${textOf(result)}`);
	savedFiles.push(match[1]);
	return match[1];
}

beforeEach(() => {
	requests = [];
	savedFiles = [];
	respond = () => imageResponse();
	spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = { url: String(input), headers: new Headers(init?.headers), body: String(init?.body) };
		requests.push(request);
		return respond(request, init?.signal ?? undefined);
	}) as typeof fetch);
});

afterEach(() => {
	for (const file of savedFiles) fs.rmSync(file, { force: true });
});

describe("generate", () => {
	test("posts Codex's generation body and headers and returns a lossless WebP with the hint", async () => {
		const tool = loadTool();
		const token = codexToken({ chatgpt_account_id: "acct-123", chatgpt_data_residency: " us " });

		const result = await tool.execute(
			"call-42",
			{ prompt: "a red fox" },
			undefined,
			undefined,
			fakeContext({ credentials: { "openai-codex": token } }),
		);

		expect(requests).toHaveLength(1);
		const [request] = requests;
		expect(request?.url).toBe(GENERATIONS_URL);
		expect(request?.body).toBe(
			'{"prompt":"a red fox","background":"opaque","model":"gpt-image-2","quality":"auto","size":"auto"}',
		);
		expect(Object.fromEntries(request?.headers ?? [])).toEqual({
			authorization: `Bearer ${token}`,
			"chatgpt-account-id": "acct-123",
			"x-openai-internal-codex-residency": "us",
			originator: "omp",
			"user-agent": USER_AGENT,
			"x-codex-image-turn-id": "call-42",
			"content-type": "application/json",
		});

		const [image] = result.content;
		expect(image?.type).toBe("image");
		if (image?.type !== "image") throw new Error("unreachable");
		expect(image.mimeType).toBe("image/webp");
		expect(isLosslessWebp(Buffer.from(image.data, "base64"))).toBe(true);

		const saved = savedPathOf(result);
		expect(path.dirname(saved)).toBe(os.tmpdir());
		expect(path.basename(saved)).toMatch(/^omp-image-.+\.webp$/);
		expect(Buffer.from(await Bun.file(saved).bytes()).toString("base64")).toBe(image.data);
		expect(textOf(result)).toBe(
			`Generated images are saved to ${os.tmpdir()} as ${saved} by default. If you need to use a generated image at another path, copy it and leave the original in place unless the user explicitly asks you to delete it. The generated image is already displayed to the user. There is no need to render it in the final response as a Markdown image or file link.\n1370x1148, quality low`,
		);
		expect((result.details as { images?: unknown } | undefined)?.images).toBeUndefined();
	});

	test("omits account and residency headers for a malformed token", async () => {
		const tool = loadTool();

		await tool.execute("call-1", { prompt: "x" }, undefined, undefined, fakeContext({ credentials: { "openai-codex": "not-a-jwt" } }));

		const headers = requests[0]?.headers;
		expect(headers?.get("authorization")).toBe("Bearer not-a-jwt");
		expect(headers?.has("chatgpt-account-id")).toBe(false);
		expect(headers?.has("x-openai-internal-codex-residency")).toBe(false);
	});
});

describe("arguments", () => {
	test("rejects unknown arguments before any request", async () => {
		const tool = loadTool();

		const call = tool.execute("c", { prompt: "x", size: "1024x1024" }, undefined, undefined, fakeContext());

		await expect(call).rejects.toThrow("Unknown argument(s): size.");
		expect(requests).toHaveLength(0);
	});

	test("rejects referenced_image_paths combined with num_last_images_to_include", async () => {
		const tool = loadTool();
		const params = { prompt: "x", referenced_image_paths: ["/tmp/a.png"], num_last_images_to_include: 1 };

		await expect(tool.execute("c", params, undefined, undefined, fakeContext())).rejects.toThrow(
			"referenced_image_paths and num_last_images_to_include cannot be used together.",
		);
		expect(requests).toHaveLength(0);
	});

	test("rejects relative reference paths", async () => {
		const tool = loadTool();
		const params = { prompt: "x", referenced_image_paths: ["images/a.png"] };

		await expect(tool.execute("c", params, undefined, undefined, fakeContext())).rejects.toThrow(
			"referenced_image_paths must be absolute: images/a.png",
		);
	});
});

describe("edit via referenced_image_paths", () => {
	let dir: string;
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "generate-image-test-"));
	});
	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("sends PNG as lossless WebP and JPEG and lossy WebP byte-identical to /images/edits", async () => {
		const tool = loadTool();
		const png = encodePng(5, 3, () => [10, 200, 30, 255]);
		const jpeg = await new Bun.Image(png).jpeg().bytes();
		const lossyWebp = await new Bun.Image(png).webp({ quality: 70 }).bytes();
		const files = { png: path.join(dir, "a.png"), jpeg: path.join(dir, "b.jpg"), webp: path.join(dir, "c.webp") };
		await Bun.write(files.png, png);
		await Bun.write(files.jpeg, jpeg);
		await Bun.write(files.webp, lossyWebp);
		respond = () => imageResponse({ usage: { input_tokens_details: { image_tokens: 1470 } } });

		const result = await tool.execute(
			"c",
			{ prompt: "make it blue", referenced_image_paths: [files.png, files.jpeg, files.webp] },
			undefined,
			undefined,
			fakeContext(),
		);
		savedPathOf(result);

		expect(requests[0]?.url).toBe("https://chatgpt.com/backend-api/codex/images/edits");
		const body = JSON.parse(requests[0]?.body ?? "{}") as { images: { image_url: string }[] };
		expect(Object.keys(body)).toEqual(["images", "prompt", "background", "model", "quality", "size"]);
		const [first, second, third] = body.images.map(image => image.image_url);
		expect(first).toStartWith("data:image/webp;base64,");
		const firstBytes = Buffer.from(first?.slice("data:image/webp;base64,".length) ?? "", "base64");
		expect(isLosslessWebp(firstBytes)).toBe(true);
		expect((await new Bun.Image(firstBytes).metadata()).width).toBe(5);
		expect(second).toBe(`data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`);
		expect(third).toBe(`data:image/webp;base64,${Buffer.from(lossyWebp).toString("base64")}`);
	});

	test("reports a missing reference file", async () => {
		const tool = loadTool();
		const missing = path.join(dir, "missing.png");

		await expect(
			tool.execute("c", { prompt: "x", referenced_image_paths: [missing] }, undefined, undefined, fakeContext()),
		).rejects.toThrow(`Reference image not found: ${missing}`);
	});
});

describe("edit via num_last_images_to_include", () => {
	const base64Png = (size: number) => Buffer.from(encodePng(size, size, () => [1, 2, 3, 255])).toString("base64");
	let jpeg3: string;
	let branch: unknown[];

	beforeEach(async () => {
		jpeg3 = Buffer.from(await new Bun.Image(encodePng(3, 3, () => [9, 9, 9, 255])).jpeg().bytes()).toString("base64");
		const duplicated = base64Png(5);
		const message = (value: Record<string, unknown>) => ({ type: "message", id: crypto.randomUUID(), message: value });
		branch = [
			message({ role: "user", content: [{ type: "text", text: "look" }, { type: "image", data: base64Png(2), mimeType: "image/png" }] }),
			message({ role: "assistant", content: [{ type: "text", text: "ok" }] }),
			message({ role: "toolResult", toolName: "read", content: [{ type: "image", data: jpeg3, mimeType: "image/jpeg" }] }),
			// Native generate_image kept its output in details.images, not content.
			message({
				role: "toolResult",
				toolName: "generate_image",
				content: [{ type: "text", text: "Generated 1 image(s)" }],
				details: { images: [{ data: base64Png(4), mimeType: "image/png" }] },
			}),
			{ type: "model_change", id: "m" },
			message({
				role: "toolResult",
				toolName: "other",
				content: [{ type: "image", data: duplicated, mimeType: "image/png" }],
				details: { images: [{ data: duplicated, mimeType: "image/png" }] },
			}),
		];
	});

	async function sentImages(count: number): Promise<{ url: string; width: number }[]> {
		respond = () => imageResponse({ usage: { input_tokens_details: { image_tokens: 500 } } });
		const result = await loadTool().execute(
			"c",
			{ prompt: "combine", num_last_images_to_include: count },
			undefined,
			undefined,
			fakeContext({ branch }),
		);
		savedPathOf(result);
		expect(requests[0]?.url).toBe("https://chatgpt.com/backend-api/codex/images/edits");
		const body = JSON.parse(requests[0]?.body ?? "{}") as { images: { image_url: string }[] };
		return Promise.all(
			body.images.map(async ({ image_url: url }) => {
				const bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
				return { url, width: (await new Bun.Image(bytes).metadata()).width };
			}),
		);
	}

	test("sends the last N images oldest first, counting a content+details duplicate once", async () => {
		const images = await sentImages(3);

		expect(images.map(image => image.width)).toEqual([3, 4, 5]);
		expect(images[0]?.url).toBe(`data:image/jpeg;base64,${jpeg3}`);
		expect(images[1]?.url).toStartWith("data:image/webp;base64,");
	});

	test("reaches back to user attachments", async () => {
		const images = await sentImages(4);

		expect(images.map(image => image.width)).toEqual([2, 3, 4, 5]);
	});

	test("errors when the conversation has fewer images than requested", async () => {
		const call = loadTool().execute("c", { prompt: "x", num_last_images_to_include: 5 }, undefined, undefined, fakeContext({ branch }));

		await expect(call).rejects.toThrow("num_last_images_to_include is 5, but the conversation has only 4 images.");
		expect(requests).toHaveLength(0);
	});
});

describe("guards", () => {
	let dir: string;
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "generate-image-test-"));
	});
	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("rejects a body over 64 MB before sending", async () => {
		const big = path.join(dir, "big.jpg");
		// JPEG magic + padding: sent unchanged, so base64 inflates it past 64 MB.
		const bytes = new Uint8Array(51 * 1024 * 1024);
		bytes.set([0xff, 0xd8, 0xff]);
		await Bun.write(big, bytes);

		const call = loadTool().execute("c", { prompt: "x", referenced_image_paths: [big] }, undefined, undefined, fakeContext());

		await expect(call).rejects.toThrow("over the 64.0 MB limit");
		expect(requests).toHaveLength(0);
	});

	test("fails an edit whose references the backend dropped, saving nothing", async () => {
		const reference = path.join(dir, "a.png");
		await Bun.write(reference, encodePng(2, 2, () => [0, 0, 0, 255]));
		const savedBefore = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith("omp-image-"));
		respond = () => imageResponse({ usage: { input_tokens_details: { image_tokens: 0, text_tokens: 12 } } });

		const call = loadTool().execute("c", { prompt: "x", referenced_image_paths: [reference] }, undefined, undefined, fakeContext());

		await expect(call).rejects.toThrow("dropped the reference images");
		const savedAfter = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith("omp-image-"));
		expect(savedAfter).toEqual(savedBefore);
	});

	test("aborting the tool signal cancels the request", async () => {
		const controller = new AbortController();
		respond = (_request, signal) =>
			new Promise((_resolve, reject) => {
				signal?.addEventListener("abort", () => reject(signal.reason));
				controller.abort();
			});

		const call = loadTool().execute("c", { prompt: "x" }, controller.signal, undefined, fakeContext());

		await expect(call).rejects.toMatchObject({ name: "ToolAbortError" });
	});
});

describe("errors", () => {
	test("asks for an openai-codex login and never falls back to another provider", async () => {
		const context = fakeContext({ credentials: { "openai-codex": undefined, openai: "sk-test" } });

		const call = loadTool().execute("c", { prompt: "x" }, undefined, undefined, context);

		await expect(call).rejects.toThrow("Log in to openai-codex with /login");
		expect(requests).toHaveLength(0);
	});

	test("names limit, plan and reset for a 429 usage_limit_reached", async () => {
		const body = { error: { type: "usage_limit_reached", message: "image limit reached", plan_type: "plus" } };
		respond = () =>
			Response.json(body, {
				status: 429,
				headers: { "x-codex-active-limit": "image_gen", "x-codex-primary-reset-after-seconds": "7980" },
			});

		const call = loadTool().execute("c", { prompt: "x" }, undefined, undefined, fakeContext());

		const error = (await call.catch(caught => caught)) as Error;
		expect(error.message).toStartWith("Codex usage limit reached (limit: image_gen, plan: plus). It resets at ");
		expect(error.message).toEndWith(" local time (in 2h 13m). Do not retry generate_image before then.");
	});

	test("reads the reset time from x-codex-primary-reset-at", async () => {
		const resetAt = Math.floor(Date.now() / 1000) + 3600;
		respond = () =>
			Response.json(
				{ error: { type: "usage_limit_reached", plan_type: "pro" } },
				{ status: 429, headers: { "x-codex-active-limit": "codex", "x-codex-primary-reset-at": String(resetAt) } },
			);

		const error = (await loadTool()
			.execute("c", { prompt: "x" }, undefined, undefined, fakeContext())
			.catch(caught => caught)) as Error;

		expect(error.message).toContain(`It resets at ${new Date(resetAt * 1000).toLocaleString()} local time (in 1h).`);
	});

	test("prefers the active limit's own reset headers, as Codex names them", async () => {
		respond = () =>
			Response.json(
				{ error: { type: "usage_limit_reached", plan_type: "plus" } },
				{
					status: 429,
					headers: {
						"x-codex-active-limit": "image_gen",
						"x-image-gen-primary-reset-after-seconds": "600",
						"x-codex-primary-reset-after-seconds": "86400",
					},
				},
			);

		const error = (await loadTool()
			.execute("c", { prompt: "x" }, undefined, undefined, fakeContext())
			.catch(caught => caught)) as Error;

		expect(error.message).toContain("local time (in 10m).");
	});

	test("reports status, message and code for other HTTP errors", async () => {
		respond = () => Response.json({ error: { message: "upstream exploded", code: "server_error" } }, { status: 502 });

		const call = loadTool().execute("c", { prompt: "x" }, undefined, undefined, fakeContext());

		await expect(call).rejects.toThrow("Codex Images endpoint returned HTTP 502: upstream exploded (code: server_error)");
	});

	test("passes a moderation_blocked message through", async () => {
		const message = "Your request was rejected by the safety system.";
		respond = () =>
			Response.json({ error: { message, code: "moderation_blocked", type: "image_generation_user_error" } }, { status: 400 });

		const error = (await loadTool()
			.execute("c", { prompt: "x" }, undefined, undefined, fakeContext())
			.catch(caught => caught)) as Error;

		expect(error.message).toBe(message);
	});
});

describe("transparency", () => {
	test("requests a transparent background and keeps alpha in the saved WebP", async () => {
		respond = () =>
			imageResponse({ background: "transparent" }, encodePng(6, 4, x => [255, 0, 0, x === 0 ? 0 : 128]));

		const result = await loadTool().execute(
			"c",
			{ prompt: "a sticker", transparent_background: true },
			undefined,
			undefined,
			fakeContext(),
		);

		expect(JSON.parse(requests[0]?.body ?? "{}").background).toBe("transparent");
		const alpha = await alphaValues(await Bun.file(savedPathOf(result)).bytes());
		expect(Math.min(...alpha)).toBe(0);
		expect(alpha).toContain(128);
	});
});
