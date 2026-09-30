// Reference images for Codex Images edits: files named by absolute path, or
// the last N images of the active conversation branch, as `data:` URLs.
//
// JPEG and WebP go out byte-identical. Every other format (PNG, GIF, BMP,
// HEIC, ...) is re-encoded as lossless WebP, which the endpoint accepts at
// the same image-token cost and about 25% fewer bytes than PNG.
import type { SessionEntry } from "@oh-my-pi/pi-coding-agent";

interface ImageBlock {
	type: "image";
	data: string;
	mimeType: string;
}

type ImageFormat = "jpeg" | "webp" | "other";

function sniffFormat(bytes: Uint8Array): ImageFormat {
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
	const riff = Buffer.from(bytes.subarray(0, 12)).toString("latin1");
	if (riff.startsWith("RIFF") && riff.endsWith("WEBP")) return "webp";
	return "other";
}

/** Losslessly re-encode an image as WebP (non-JPEG/WebP references and the generated result). */
export async function toLosslessWebp(bytes: Uint8Array): Promise<Uint8Array> {
	return new Bun.Image(bytes).webp({ lossless: true }).bytes();
}

/** `data:` URL for one reference; `base64` is reused when the bytes go out unchanged. */
async function toDataUrl(bytes: Uint8Array, label: string, base64?: string): Promise<string> {
	const format = sniffFormat(bytes);
	if (format !== "other") {
		return `data:image/${format};base64,${base64 ?? Buffer.from(bytes).toString("base64")}`;
	}
	let webp: Uint8Array;
	try {
		webp = await toLosslessWebp(bytes);
	} catch (error) {
		throw new Error(`Cannot read ${label} as an image: ${error instanceof Error ? error.message : String(error)}`);
	}
	return `data:image/webp;base64,${Buffer.from(webp).toString("base64")}`;
}

export async function referencesFromPaths(paths: readonly string[]): Promise<string[]> {
	return Promise.all(
		paths.map(async imagePath => {
			const file = Bun.file(imagePath);
			if (!(await file.exists())) throw new Error(`Reference image not found: ${imagePath}`);
			return toDataUrl(await file.bytes(), imagePath);
		}),
	);
}

function isImageBlock(value: unknown): value is ImageBlock {
	if (!value || typeof value !== "object") return false;
	const block = value as Partial<ImageBlock>;
	return block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string";
}

/** Images of one message, oldest first; tool-result `details.images` hold native `generate_image` output. */
function messageImages(entry: SessionEntry): string[] {
	if (entry.type !== "message") return [];
	const message = entry.message;
	if (message.role !== "user" && message.role !== "toolResult") return [];
	const content = typeof message.content === "string" ? [] : message.content;
	const images = content.filter(isImageBlock).map(block => block.data);
	if (message.role === "toolResult") {
		const details = message.details as { images?: unknown } | undefined;
		if (Array.isArray(details?.images)) {
			for (const image of details.images) {
				const data = (image as { data?: unknown } | undefined)?.data;
				if (typeof data === "string" && !images.includes(data)) images.push(data);
			}
		}
	}
	return images;
}

/** The last `count` images of the branch (user attachments, tool results), sent oldest first. */
export async function referencesFromConversation(branch: readonly SessionEntry[], count: number): Promise<string[]> {
	const newestFirst: string[] = [];
	for (let index = branch.length - 1; index >= 0 && newestFirst.length < count; index--) {
		const entry = branch[index];
		if (!entry) continue;
		const images = messageImages(entry);
		for (let image = images.length - 1; image >= 0 && newestFirst.length < count; image--) {
			newestFirst.push(images[image] ?? "");
		}
	}
	if (newestFirst.length < count) {
		const found = newestFirst.length === 1 ? "1 image" : `${newestFirst.length} images`;
		throw new Error(`num_last_images_to_include is ${count}, but the conversation has only ${found}.`);
	}
	const chronological = newestFirst.reverse();
	return Promise.all(
		chronological.map((base64, index) =>
			toDataUrl(Buffer.from(base64, "base64"), `conversation image ${index + 1}`, base64),
		),
	);
}
