import { type } from "@oh-my-pi/omptype";
import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import generateImage from "../extensions/generate-image";

export function writePluginSettings(dir: string, settings: Record<string, unknown>): void {
	fs.mkdirSync(path.join(dir, ".omp"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".omp", "plugin-overrides.json"),
		JSON.stringify({ settings: { "omp-tools": settings } }),
	);
}

export interface LoadedSession {
	/** The `generate_image` definition registered most recently. */
	tool(): ToolDefinition;
	/** Runs the extension's handlers for a host event, as OMP does. */
	emit(event: string, ctx: Partial<ExtensionContext>): Promise<void>;
}

/** Loads the extension as OMP does at startup, from a project whose plugin settings are `settings`. */
export async function loadSession(settings: Record<string, unknown>, dir: string): Promise<LoadedSession> {
	writePluginSettings(dir, settings);
	let registered: ToolDefinition | undefined;
	const handlers = new Map<string, ((event: unknown, ctx: unknown) => unknown)[]>();
	const pi = {
		arktype: type,
		registerTool: (definition: ToolDefinition) => {
			registered = definition;
		},
		on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
	};
	const cwd = process.cwd();
	process.chdir(dir);
	try {
		await generateImage(pi as unknown as ExtensionAPI);
	} finally {
		process.chdir(cwd);
	}
	return {
		tool: () => {
			if (!registered) throw new Error("generate_image was not registered");
			return registered;
		},
		emit: async (event, ctx) => {
			for (const handler of handlers.get(event) ?? []) await handler({ type: event }, ctx);
		},
	};
}

/** Loads generate_image as a new OMP process would, from a project whose plugin settings are `settings`. */
export async function loadTool(
	settings: Record<string, unknown> = { imageGenerationMode: "codex" },
	dir?: string,
): Promise<ToolDefinition> {
	const project = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "generate-image-project-"));
	try {
		return (await loadSession(settings, project)).tool();
	} finally {
		if (!dir) fs.rmSync(project, { recursive: true, force: true });
	}
}

export function argumentNames(tool: ToolDefinition): string[] {
	const schema = (tool.parameters as unknown as { toJsonSchema(): { properties?: object } }).toJsonSchema();
	return Object.keys(schema.properties ?? {}).sort();
}

export interface FakeContextOptions {
	/** Credential per provider; openai-codex defaults to a valid token. */
	credentials?: Record<string, string | undefined>;
	branch?: unknown[];
	openaiBaseUrl?: string;
	openaiHeaders?: Record<string, string>;
}

export function fakeContext(options: FakeContextOptions = {}): ExtensionContext {
	const credentials = options.credentials ?? { "openai-codex": codexToken() };
	return {
		modelRegistry: {
			getApiKeyForProvider: async (provider: string) => credentials[provider],
			getProviderBaseUrl: (provider: string) =>
				provider === "openai" ? ("openaiBaseUrl" in options ? options.openaiBaseUrl : "https://api.openai.com/v1") : undefined,
			getProviderHeaders: async (provider: string) => (provider === "openai" ? options.openaiHeaders : undefined),
		},
		sessionManager: {
			getSessionId: () => "session-1",
			getBranch: () => options.branch ?? [],
		},
	} as unknown as ExtensionContext;
}

type Result = Pick<AgentToolResult<unknown>, "content" | "details">;

export function textOf(result: Result): string {
	return result.content
		.flatMap(block => (block.type === "text" ? [block.text] : []))
		.join("\n");
}

export function imagesOf(result: Result): { bytes: Buffer; mimeType: string }[] {
	return result.content.flatMap(block =>
		block.type === "image" ? [{ bytes: Buffer.from(block.data, "base64"), mimeType: block.mimeType }] : [],
	);
}

export function outputPathsOf(result: Result): string[] {
	const outputs = (result.details as { outputs?: { path: string }[] } | undefined)?.outputs ?? [];
	return outputs.map(output => output.path);
}

export function savedImageFiles(): string[] {
	return fs.readdirSync(os.tmpdir()).filter(name => name.startsWith("omp-image-"));
}

export function codexToken(claims: Record<string, unknown> = { chatgpt_account_id: "acct-123" }): string {
	const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${encode({ alg: "RS256" })}.${encode({ "https://api.openai.com/auth": claims })}.signature`;
}

function pngChunk(kind: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out.set(new TextEncoder().encode(kind), 4);
	out.set(data, 8);
	view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
	return out;
}

/** PNG whose pixel (x, y) is `pixel(x, y)`: RGBA, or RGB with no alpha channel when `alpha` is false. */
export function encodePng(
	width: number,
	height: number,
	pixel: (x: number, y: number) => [number, number, number, number],
	{ alpha = true }: { alpha?: boolean } = {},
): Uint8Array {
	const bpp = alpha ? 4 : 3;
	const stride = 1 + width * bpp;
	const raw = new Uint8Array(height * stride);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) raw.set(pixel(x, y).slice(0, bpp), y * stride + 1 + x * bpp);
	}
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header.set([8, alpha ? 6 : 2, 0, 0, 0], 8);
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk("IHDR", header),
		pngChunk("IDAT", deflateSync(raw)),
		pngChunk("IEND", new Uint8Array()),
	]);
}

export async function jpegWithOrientation(png: Uint8Array, orientation: number): Promise<Uint8Array> {
	const jpeg = await new Bun.Image(png).jpeg().bytes();
	const tiff = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]);
	const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
	const segment = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
	return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

/** Every pixel of an image as RGBA, decoded by hand from a PNG, since Bun.Image exposes no pixels. */
export async function rgbaPixels(image: Uint8Array): Promise<{ width: number; height: number; rgba: Uint8Array }> {
	const png = await new Bun.Image(image).png().bytes();
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	let offset = 8;
	let width = 0;
	let height = 0;
	let colorType = 0;
	const idat: Uint8Array[] = [];
	while (offset < png.length) {
		const length = view.getUint32(offset);
		const kind = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
		const data = png.subarray(offset + 8, offset + 8 + length);
		if (kind === "IHDR") {
			width = view.getUint32(offset + 8);
			height = view.getUint32(offset + 12);
			colorType = data[9] ?? 0;
			if (data[8] !== 8 || data[12] !== 0) throw new Error("fixture decoder handles 8-bit non-interlaced PNG only");
		}
		if (kind === "IDAT") idat.push(data);
		offset += 12 + length;
	}
	if (colorType !== 6 && colorType !== 2) throw new Error(`fixture decoder handles RGB and RGBA PNG only (was ${colorType})`);
	const bpp = colorType === 6 ? 4 : 3;
	const stride = width * bpp;
	const raw = inflateSync(Buffer.concat(idat));
	const pixels = new Uint8Array(height * stride);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		for (let i = 0; i < stride; i++) {
			const value = raw[y * (stride + 1) + 1 + i] ?? 0;
			const left = i >= bpp ? (pixels[y * stride + i - bpp] ?? 0) : 0;
			const up = y > 0 ? (pixels[(y - 1) * stride + i] ?? 0) : 0;
			const upLeft = y > 0 && i >= bpp ? (pixels[(y - 1) * stride + i - bpp] ?? 0) : 0;
			let predictor = 0;
			if (filter === 1) predictor = left;
			else if (filter === 2) predictor = up;
			else if (filter === 3) predictor = (left + up) >> 1;
			else if (filter === 4) {
				const estimate = left + up - upLeft;
				const [dl, du, dul] = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - upLeft)];
				predictor = dl <= du && dl <= dul ? left : du <= dul ? up : upLeft;
			}
			pixels[y * stride + i] = (value + predictor) & 0xff;
		}
	}
	if (bpp === 4) return { width, height, rgba: pixels };
	const rgba = new Uint8Array(width * height * 4);
	for (let pixel = 0; pixel < width * height; pixel++) {
		rgba.set(pixels.subarray(pixel * 3, pixel * 3 + 3), pixel * 4);
		rgba[pixel * 4 + 3] = 255;
	}
	return { width, height, rgba };
}

/** Alpha values of every pixel of an image. */
export async function alphaValues(image: Uint8Array): Promise<number[]> {
	const { rgba } = await rgbaPixels(image);
	const alpha: number[] = [];
	for (let i = 3; i < rgba.length; i += 4) alpha.push(rgba[i] ?? 0);
	return alpha;
}

/** RIFF WebP whose first image chunk is lossless VP8L. */
export function isLosslessWebp(bytes: Uint8Array): boolean {
	const text = Buffer.from(bytes.subarray(0, 16)).toString("latin1");
	return text.startsWith("RIFF") && text.slice(8, 16) === "WEBPVP8L";
}
