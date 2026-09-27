// Image loading for the ask picker's custom-answer and note editors. The
// editor (the main prompt's CustomEditor) decides when to paste an image, as in
// the main prompt; this mirrors the main prompt's sources (Finder file URLs,
// clipboard bitmap, image-path text, pasted image paths) using the host's
// clipboard and image-loading helpers, so size limits, decoding checks, and
// `images.autoResize` behave the same.
import type { ImageContent } from "@oh-my-pi/pi-ai";
import { extractImagePathFromText, settings } from "@oh-my-pi/pi-coding-agent";
import { cfgImagesAutoResize } from "@oh-my-pi/pi-coding-agent/modes/settings";
import {
	readImageFromClipboard,
	readMacFileUrlsFromClipboard,
	readTextFromClipboard,
} from "@oh-my-pi/pi-coding-agent/utils/clipboard";
import { loadImageAttachmentInput, loadImageInput } from "@oh-my-pi/pi-coding-agent/utils/image-loading";

/** One loaded image; `source` is the file path for pasted files. */
export interface PastedImage {
	image: ImageContent;
	source?: string;
}

/** What a paste resolved to: images to attach, text to insert, or a status message. */
export type PasteOutcome = { images: PastedImage[] } | { text: string } | { error: string };

function errorMessage(error: unknown): string {
	if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") return "Image file not found";
	return error instanceof Error ? error.message : String(error);
}

/** Load image files as pasted attachments; stops at the first failure. */
export async function loadImagePaths(paths: readonly string[], cwd: string): Promise<PasteOutcome> {
	const images: PastedImage[] = [];
	for (const path of paths) {
		try {
			const loaded = await loadImageInput({ path, cwd, autoResize: cfgImagesAutoResize.get(settings) });
			if (!loaded) return { error: "Pasted path is not a supported image" };
			images.push({
				image: { type: "image", data: loaded.data, mimeType: loaded.mimeType },
				source: loaded.resolvedPath,
			});
		} catch (error) {
			return { error: errorMessage(error) };
		}
	}
	return { images };
}

/**
 * Read the clipboard for the image-paste chord or an empty bracketed paste.
 * Finder file URLs win over the bitmap (which is the generic file icon for
 * copied files); a clipboard holding only text pastes that text.
 */
export async function readClipboardPaste(cwd: string): Promise<PasteOutcome> {
	try {
		const fileUrls = await readMacFileUrlsFromClipboard();
		const filePaths = fileUrls.flatMap(url => extractImagePathFromText(url) ?? []);
		if (filePaths.length > 0) return await loadImagePaths(filePaths, cwd);

		const bitmap = await readImageFromClipboard();
		if (bitmap) {
			const loaded = await loadImageAttachmentInput({
				image: { type: "image", data: bitmap.data.toBase64(), mimeType: bitmap.mimeType },
				label: "clipboard image",
				uri: "clipboard",
				autoResize: cfgImagesAutoResize.get(settings),
			});
			if (!loaded) return { error: `Unsupported clipboard image format: ${bitmap.mimeType}` };
			return { images: [{ image: { type: "image", data: loaded.data, mimeType: loaded.mimeType } }] };
		}

		const text = await readTextFromClipboard();
		if (!text) return { error: "Clipboard is empty" };
		const imagePath = extractImagePathFromText(text);
		return imagePath ? await loadImagePaths([imagePath], cwd) : { text };
	} catch (error) {
		return { error: `Failed to read clipboard: ${errorMessage(error)}` };
	}
}

