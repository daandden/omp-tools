
export type ImageFormat = "png" | "jpeg" | "webp" | "gif" | "svg";

const MIME_TYPES: Record<ImageFormat, string> = {
	png: "image/png",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	svg: "image/svg+xml",
};

const SVG_START = /^\uFEFF?\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg[\s>]/;

/** The format the bytes are in, by their magic numbers or an SVG root element; undefined for any other format. */
export function imageFormatOf(bytes: Uint8Array): ImageFormat | undefined {
	if (bytes[0] === 0x89 && Buffer.from(bytes.subarray(1, 4)).toString("latin1") === "PNG") return "png";
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
	const head = Buffer.from(bytes.subarray(0, 12)).toString("latin1");
	if (head.startsWith("RIFF") && head.endsWith("WEBP")) return "webp";
	if (head.startsWith("GIF87a") || head.startsWith("GIF89a")) return "gif";
	if (SVG_START.test(Buffer.from(bytes.subarray(0, 4096)).toString("utf8"))) return "svg";
	return undefined;
}

export function mimeTypeOf(format: ImageFormat): string {
	return MIME_TYPES[format];
}

/** Losslessly re-encode an image as WebP: every visible pixel and alpha value is kept. */
export async function toLosslessWebp(bytes: Uint8Array): Promise<Uint8Array> {
	return new Bun.Image(bytes).webp({ lossless: true }).bytes();
}
