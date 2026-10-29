import type { SessionEntry } from "@oh-my-pi/pi-coding-agent";
import { type ImageFormat, imageFormatOf, mimeTypeOf, toLosslessWebp } from "./image-codecs";

export type ReferenceEncoding = "codex" | "openai";

// The Codex endpoint takes lossless WebP at PNG's image-token cost and about
// 25% fewer bytes. The public API documents PNG, JPEG, and WebP, and a mask
// must match its image's format, so OpenAI mode keeps a PNG a PNG.
const ENCODINGS: Record<ReferenceEncoding, { kept: readonly ImageFormat[]; reencode: ImageFormat }> = {
	codex: { kept: ["jpeg", "webp"], reencode: "webp" },
	openai: { kept: ["png", "jpeg", "webp"], reencode: "png" },
};

interface ImageBlock {
	type: "image";
	data: string;
	mimeType: string;
}

async function reencode(bytes: Uint8Array, format: ImageFormat): Promise<Uint8Array> {
	return format === "webp" ? toLosslessWebp(bytes) : new Bun.Image(bytes).png().bytes();
}

async function toDataUrl(bytes: Uint8Array, label: string, encoding: ReferenceEncoding, base64?: string): Promise<string> {
	const { kept, reencode: target } = ENCODINGS[encoding];
	const format = imageFormatOf(bytes);
	if (format && kept.includes(format)) {
		return `data:${mimeTypeOf(format)};base64,${base64 ?? Buffer.from(bytes).toString("base64")}`;
	}
	let encoded: Uint8Array;
	try {
		encoded = await reencode(bytes, target);
	} catch (error) {
		throw new Error(`Cannot read ${label} as an image: ${error instanceof Error ? error.message : String(error)}`);
	}
	return `data:${mimeTypeOf(target)};base64,${Buffer.from(encoded).toString("base64")}`;
}

/** The bytes of an image file named by an absolute path. */
export async function readImageFile(imagePath: string, label = "Reference image"): Promise<Uint8Array> {
	const file = Bun.file(imagePath);
	if (!(await file.exists())) throw new Error(`${label} not found: ${imagePath}`);
	return file.bytes();
}

export async function referencesFromPaths(paths: readonly string[], encoding: ReferenceEncoding): Promise<string[]> {
	return Promise.all(
		paths.map(async imagePath => toDataUrl(await readImageFile(imagePath), imagePath, encoding)),
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
export async function referencesFromConversation(
	branch: readonly SessionEntry[],
	count: number,
	encoding: ReferenceEncoding,
): Promise<string[]> {
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
			toDataUrl(Buffer.from(base64, "base64"), `conversation image ${index + 1}`, encoding, base64),
		),
	);
}
