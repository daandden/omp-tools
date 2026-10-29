
export type ImageFormat = "png" | "jpeg" | "webp";

const MIME_TYPES: Record<ImageFormat, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };

/** The format the bytes are in, by their magic numbers; undefined for any other format. */
export function imageFormatOf(bytes: Uint8Array): ImageFormat | undefined {
	if (bytes[0] === 0x89 && Buffer.from(bytes.subarray(1, 4)).toString("latin1") === "PNG") return "png";
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
	const riff = Buffer.from(bytes.subarray(0, 12)).toString("latin1");
	if (riff.startsWith("RIFF") && riff.endsWith("WEBP")) return "webp";
	return undefined;
}

export function mimeTypeOf(format: ImageFormat): string {
	return MIME_TYPES[format];
}

/** Losslessly re-encode an image as WebP: every visible pixel and alpha value is kept. */
export async function toLosslessWebp(bytes: Uint8Array): Promise<Uint8Array> {
	return new Bun.Image(bytes).webp({ lossless: true }).bytes();
}
