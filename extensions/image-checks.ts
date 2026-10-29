import { inflateSync } from "node:zlib";
import { imageFormatOf } from "./image-codecs";

/** Width and height after the image's EXIF orientation, as `WIDTHxHEIGHT`. */
export async function orientedSize(bytes: Uint8Array): Promise<string> {
	const { width, height } = await new Bun.Image(bytes).metadata();
	return `${width}x${height}`;
}

function pngChunks(png: Uint8Array): { kind: string; data: Uint8Array }[] {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	const chunks: { kind: string; data: Uint8Array }[] = [];
	for (let offset = 8; offset + 8 <= png.length; ) {
		const length = view.getUint32(offset);
		chunks.push({
			kind: Buffer.from(png.subarray(offset + 4, offset + 8)).toString("latin1"),
			data: png.subarray(offset + 8, offset + 8 + length),
		});
		offset += 12 + length;
	}
	return chunks;
}

/** Whether the image file itself stores an alpha channel (PNG colour type or `tRNS`, WebP flags). */
export function hasAlphaChannel(bytes: Uint8Array): boolean {
	const format = imageFormatOf(bytes);
	if (format === "png") {
		const chunks = pngChunks(bytes);
		const colorType = chunks.find(chunk => chunk.kind === "IHDR")?.data[9];
		return colorType === 4 || colorType === 6 || chunks.some(chunk => chunk.kind === "tRNS");
	}
	if (format === "webp") {
		const kind = Buffer.from(bytes.subarray(12, 16)).toString("latin1");
		if (kind === "VP8X") return ((bytes[20] ?? 0) & 0x10) !== 0;
		// VP8L: after the 0x2f signature, bit 28 of the little-endian header word is alpha_is_used.
		if (kind === "VP8L") return ((bytes[24] ?? 0) & 0x10) !== 0;
	}
	return false;
}

function paeth(left: number, up: number, upLeft: number): number {
	const estimate = left + up - upLeft;
	const dl = Math.abs(estimate - left);
	const du = Math.abs(estimate - up);
	const dul = Math.abs(estimate - upLeft);
	return dl <= du && dl <= dul ? left : du <= dul ? up : upLeft;
}

/** Whether any pixel is less than fully opaque. Bun.Image exposes no pixels, but its PNG encoder always writes 8-bit RGBA. */
export async function hasTransparentPixels(bytes: Uint8Array): Promise<boolean> {
	const png = await new Bun.Image(bytes).png().bytes();
	const chunks = pngChunks(png);
	const header = chunks.find(chunk => chunk.kind === "IHDR")?.data;
	if (!header || header[8] !== 8 || header[9] !== 6 || header[12] !== 0) {
		throw new Error("Cannot read the image's alpha values.");
	}
	const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
	const [width, height] = [view.getUint32(0), view.getUint32(4)];
	const stride = width * 4;
	const raw = inflateSync(Buffer.concat(chunks.filter(chunk => chunk.kind === "IDAT").map(chunk => chunk.data)));
	let previous = new Uint8Array(stride);
	let row = new Uint8Array(stride);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		for (let i = 0; i < stride; i++) {
			const value = raw[y * (stride + 1) + 1 + i] ?? 0;
			const left = i >= 4 ? (row[i - 4] ?? 0) : 0;
			const up = previous[i] ?? 0;
			const upLeft = i >= 4 ? (previous[i - 4] ?? 0) : 0;
			const predictor =
				filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : filter === 4 ? paeth(left, up, upLeft) : 0;
			row[i] = (value + predictor) & 0xff;
		}
		for (let i = 3; i < stride; i += 4) if ((row[i] ?? 255) < 255) return true;
		const done = previous;
		previous = row;
		row = done;
	}
	return false;
}
