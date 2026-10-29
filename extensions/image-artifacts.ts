import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { throwIfAborted } from "@oh-my-pi/pi-coding-agent/tools/tool-errors";
import { Snowflake } from "@oh-my-pi/pi-utils";
import { type ImageFormat, imageFormatOf, mimeTypeOf, toLosslessWebp } from "./image-codecs";

export interface FinalImage {
	bytes: Uint8Array;
	/** Provider-reported size and quality, e.g. `1370x1148` and `low`. */
	size?: string;
	quality?: string;
}

/**
 * `lossless-webp` re-encodes every image as lossless WebP, pixels and alpha
 * unchanged. `as-returned` keeps the provider's bytes in the format they are in.
 */
export type ArtifactPolicy = "lossless-webp" | "as-returned";

export interface SavedImage {
	path: string;
	mimeType: string;
	base64: string;
	size?: string;
	quality?: string;
}

const EXTENSIONS: Record<ImageFormat, string> = { png: "png", jpeg: "jpg", webp: "webp" };

/** Encode every image first, then write them all, so a bad image or a cancel saves nothing. */
export async function saveImages(
	images: readonly FinalImage[],
	policy: ArtifactPolicy,
	signal: AbortSignal | undefined,
): Promise<SavedImage[]> {
	const encoded = await Promise.all(
		images.map(async (image, index) => {
			if (policy === "lossless-webp") return { ...image, bytes: await toLosslessWebp(image.bytes), format: "webp" as const };
			const format = imageFormatOf(image.bytes);
			if (!format) throw new Error(`Image ${index + 1} of the response is not PNG, JPEG, or WebP data.`);
			return { ...image, format };
		}),
	);
	throwIfAborted(signal);
	const dir = os.tmpdir();
	const files = encoded.map(image => ({
		bytes: image.bytes,
		saved: {
			path: path.join(dir, `omp-image-${Snowflake.next()}.${EXTENSIONS[image.format]}`),
			mimeType: mimeTypeOf(image.format),
			base64: Buffer.from(image.bytes).toString("base64"),
			size: image.size,
			quality: image.quality,
		},
	}));
	try {
		await Promise.all(files.map(file => Bun.write(file.saved.path, file.bytes)));
		throwIfAborted(signal);
	} catch (error) {
		await Promise.all(files.map(file => fs.rm(file.saved.path, { force: true })));
		throw error;
	}
	return files.map(file => file.saved);
}

function reportedFacts(image: SavedImage): string {
	return [image.size, image.quality && `quality ${image.quality}`].filter(Boolean).join(", ");
}

const KEEP_ORIGINALS =
	"If you need to use a generated image at another path, copy it and leave the original in place unless the user " +
	"explicitly asks you to delete it.";

/** The model-facing lines: where each image is saved, then what the provider reported about it. */
export function savedImagesText(saved: readonly SavedImage[]): string[] {
	const dir = os.tmpdir();
	const [only] = saved;
	if (saved.length === 1 && only) {
		const lines = [
			`Generated images are saved to ${dir} as ${only.path} by default. ${KEEP_ORIGINALS} The generated image is ` +
				"already displayed to the user. There is no need to render it in the final response as a Markdown image " +
				"or file link.",
		];
		const facts = reportedFacts(only);
		if (facts) lines.push(facts);
		return lines;
	}
	return [
		`Generated images are saved to ${dir} by default, in this order: ${KEEP_ORIGINALS} All ${saved.length} ` +
			"generated images are already displayed to the user. There is no need to render them in the final response " +
			"as Markdown images or file links.",
		...saved.map((image, index) => {
			const facts = reportedFacts(image);
			return `${index + 1}. ${image.path}${facts ? ` (${facts})` : ""}`;
		}),
	];
}
