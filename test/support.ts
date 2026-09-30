// Test fixtures for the generate_image tool: a fake extension host, Codex
// tokens, and a minimal RGBA PNG encoder/decoder (Bun.Image exposes no
// pixels, so alpha checks decode PNG by hand).
import { type } from "@oh-my-pi/omptype";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { deflateSync, inflateSync } from "node:zlib";
import generateImage from "../extensions/generate-image";

export function loadTool(): ToolDefinition {
	let registered: ToolDefinition | undefined;
	const pi = {
		arktype: type,
		registerTool: (definition: ToolDefinition) => {
			registered = definition;
		},
	};
	generateImage(pi as unknown as ExtensionAPI);
	if (!registered) throw new Error("generate_image was not registered");
	return registered;
}

export interface FakeContextOptions {
	/** Credential per provider; openai-codex defaults to a valid token. */
	credentials?: Record<string, string | undefined>;
	branch?: unknown[];
}

export function fakeContext(options: FakeContextOptions = {}): ExtensionContext {
	const credentials = options.credentials ?? { "openai-codex": codexToken() };
	return {
		modelRegistry: {
			getApiKeyForProvider: async (provider: string) => credentials[provider],
		},
		sessionManager: {
			getSessionId: () => "session-1",
			getBranch: () => options.branch ?? [],
		},
	} as unknown as ExtensionContext;
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

/** RGBA PNG whose pixel (x, y) is `pixel(x, y)`. */
export function encodePng(
	width: number,
	height: number,
	pixel: (x: number, y: number) => [number, number, number, number],
): Uint8Array {
	const stride = 1 + width * 4;
	const raw = new Uint8Array(height * stride);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * stride + 1 + x * 4);
	}
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header.set([8, 6, 0, 0, 0], 8);
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk("IHDR", header),
		pngChunk("IDAT", deflateSync(raw)),
		pngChunk("IEND", new Uint8Array()),
	]);
}

/** Alpha values of every pixel of an image, decoded through an RGBA PNG. */
export async function alphaValues(image: Uint8Array): Promise<number[]> {
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
	if (colorType !== 6) return new Array(width * height).fill(255);
	const bpp = 4;
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
	const alpha: number[] = [];
	for (let i = 3; i < pixels.length; i += 4) alpha.push(pixels[i] ?? 0);
	return alpha;
}

/** RIFF WebP whose first image chunk is lossless VP8L. */
export function isLosslessWebp(bytes: Uint8Array): boolean {
	const text = Buffer.from(bytes.subarray(0, 16)).toString("latin1");
	return text.startsWith("RIFF") && text.slice(8, 16) === "WEBPVP8L";
}
