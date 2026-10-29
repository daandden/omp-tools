import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { requestCodexImages } from "./codex-images";
import description from "./generate-image.md" with { type: "text" };
import type { ArtifactPolicy, FinalImage } from "./image-artifacts";
import { referencesFromConversation, referencesFromPaths } from "./reference-images";

export type ImageModeId = "codex" | "openai";

export type Schema = ReturnType<ExtensionAPI["arktype"]>;

/** Details for the result while a mode is still running (streamed previews). */
export interface PreviewDetails {
	stage: "preview";
	mode: ImageModeId;
	previews: number;
}

export interface ModeUpdate {
	/** One preview image as base64, with its MIME type. */
	preview: { data: string; mimeType: string };
	/** Previews received so far, this one included. */
	count: number;
}

export interface ModeCall {
	toolCallId: string;
	params: Record<string, unknown>;
	signal: AbortSignal | undefined;
	onPreview: ((update: ModeUpdate) => void) | undefined;
	ctx: ExtensionContext;
}

export interface ModeResult<Details> {
	images: FinalImage[];
	policy: ArtifactPolicy;
	/** Extra model-facing lines after the saved paths, such as a quota warning. */
	notes: string[];
	/** Tracing facts kept in the result details, beside the saved outputs. */
	details: Details;
}

export interface ImageMode<Details = Record<string, unknown>> {
	id: ImageModeId;
	description: string;
	parameters: Schema;
	/** The card head's facts about a call's arguments, such as its reference count. */
	callFacts(args: Record<string, unknown>): string[];
	/** Warnings shown on the result card, such as a near-limit quota. */
	cardWarnings(details: Details): string[];
	run(call: ModeCall): Promise<ModeResult<Details>>;
}

export interface CodexDetails {
	quotaWarning?: string;
	/** For tracing a result with OpenAI; not shown to the model. */
	requestId?: string;
	generationId?: string;
	outputTokens?: number;
}

export function referenceCount(args: Record<string, unknown>): number | undefined {
	const paths = args.referenced_image_paths;
	if (Array.isArray(paths) && paths.length > 0) return paths.length;
	const count = args.num_last_images_to_include;
	return typeof count === "number" && count > 0 ? count : undefined;
}

function referenceFact(count: number | undefined): string[] {
	return count ? [`${count} reference${count === 1 ? "" : "s"}`] : [];
}

/** Codex mode: the Codex Images endpoint with Codex OAuth and Codex's four arguments. */
export function codexMode(type: ExtensionAPI["arktype"]): ImageMode<CodexDetails> {
	const parameters = type({
		prompt: type("string").describe("Image or edit description."),
		"transparent_background?": type("boolean").describe("Transparent output."),
		"referenced_image_paths?": type("string[]").describe("Absolute image paths, max 5."),
		"num_last_images_to_include?": type("1 <= number.integer <= 5").describe(
			"Last N conversation images, 1–5; not with paths.",
		),
	});
	return {
		id: "codex",
		description: description.trimEnd(),
		parameters,
		callFacts: args => [...referenceFact(referenceCount(args)), ...(args.transparent_background ? ["transparent"] : [])],
		cardWarnings: details => (details.quotaWarning ? [details.quotaWarning] : []),
		async run({ toolCallId, params, signal, ctx }) {
			const paths = params.referenced_image_paths as string[] | undefined;
			const count = params.num_last_images_to_include as number | undefined;
			if (paths !== undefined && count !== undefined) {
				throw new Error("referenced_image_paths and num_last_images_to_include cannot be used together.");
			}
			const relative = paths?.filter(imagePath => !path.isAbsolute(imagePath)) ?? [];
			if (relative.length > 0) {
				throw new Error(`referenced_image_paths must be absolute: ${relative.join(", ")}`);
			}

			const accessToken = await ctx.modelRegistry.getApiKeyForProvider(
				"openai-codex",
				ctx.sessionManager.getSessionId(),
				{ signal },
			);
			if (!accessToken) {
				throw new Error(
					"generate_image needs a ChatGPT/Codex login. Log in to openai-codex with /login, then retry.",
				);
			}

			const references = paths
				? await referencesFromPaths(paths, "codex")
				: count
					? await referencesFromConversation(ctx.sessionManager.getBranch(), count, "codex")
					: [];
			const generated = await requestCodexImages(
				{ prompt: params.prompt as string, transparent: params.transparent_background === true, references },
				accessToken,
				toolCallId,
				signal,
			);
			return {
				images: generated.images,
				policy: "lossless-webp",
				notes: generated.quotaWarning ? [generated.quotaWarning] : [],
				details: {
					quotaWarning: generated.quotaWarning,
					requestId: generated.requestId,
					generationId: generated.generationId,
					outputTokens: generated.outputTokens,
				},
			};
		},
	};
}
