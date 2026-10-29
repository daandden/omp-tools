import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import description from "./generate-image-openai.md" with { type: "text" };
import { hasAlphaChannel, hasTransparentPixels, orientedSize } from "./image-checks";
import { imageFormatOf, mimeTypeOf } from "./image-codecs";
import { type ImageMode, referenceCount } from "./image-modes";
import { readImageFile, referencesFromConversation, referencesFromPaths } from "./reference-images";
import {
	FIRST_PARTY_BASE_URL,
	requestSunburstImages,
	type SunburstAccess,
	type SunburstReported,
	type SunburstUsage,
} from "./sunburst-images";

export const SUNBURST_MODELS = ["gpt-image-2.5-sunburst", "gpt-image-2.5-sunburst-2026-09-08"] as const;

export interface OpenAIDetails {
	/** The settings this call asked for, as sent (the prompt and images left out). */
	requested: Record<string, unknown>;
	reported: SunburstReported;
	usage?: SunburstUsage;
	requestId?: string;
}

const ATTRIBUTION_HEADERS = [
	["OpenAI-Organization", "OPENAI_ORG_ID"],
	["OpenAI-Project", "OPENAI_PROJECT_ID"],
] as const;

function normalizedUrl(url: string): string {
	return url.trim().replace(/\/+$/, "");
}

async function openaiAccess(ctx: ExtensionContext, signal: AbortSignal | undefined): Promise<SunburstAccess> {
	const registry = ctx.modelRegistry;
	const baseUrl = registry.getProviderBaseUrl("openai") ?? process.env.OPENAI_BASE_URL?.trim();
	if (baseUrl && normalizedUrl(baseUrl) !== FIRST_PARTY_BASE_URL) {
		throw new Error(
			`The openai provider is configured for ${baseUrl}. OpenAI mode sends images only to the first-party API ` +
				`at ${FIRST_PARTY_BASE_URL}, so it does not send that provider's credential. Remove the custom base URL ` +
				"for openai, or set imageGenerationMode to codex and start a new session.",
		);
	}
	const apiKey = await registry.getApiKeyForProvider("openai", ctx.sessionManager.getSessionId(), { signal });
	if (!apiKey) {
		throw new Error(
			"OpenAI mode needs an OpenAI API key for the openai provider: set OPENAI_API_KEY or store an openai key in " +
				"OMP. A ChatGPT/Codex login (openai-codex) does not cover the public Images API. To use the Codex login " +
				"instead, set the omp-tools setting imageGenerationMode to codex and start a new session.",
		);
	}
	const configured = (await registry.getProviderHeaders("openai")) ?? {};
	const attribution: Record<string, string> = {};
	for (const [header, envName] of ATTRIBUTION_HEADERS) {
		const name = Object.keys(configured).find(key => key.toLowerCase() === header.toLowerCase());
		const value = (name ? configured[name] : undefined) ?? process.env[envName];
		if (value?.trim()) attribution[header] = value.trim();
	}
	return { apiKey, attribution };
}

type OutputFormat = "png" | "jpeg" | "webp";

interface OpenAIArgs {
	prompt: string;
	model?: string | null;
	n?: number | null;
	output_format?: OutputFormat | null;
	output_compression?: number | null;
	background?: "auto" | "opaque" | "transparent" | null;
	quality?: string | null;
	size?: string | null;
	moderation?: "auto" | "low" | null;
	safety_identifier?: string | null;
	user?: string | null;
	referenced_image_paths?: string[] | null;
	num_last_images_to_include?: number | null;
	images?: NativeImage[] | null;
	mask?: EditResource | null;
	markup?: EditResource | null;
	stream?: boolean | null;
	partial_images?: number | null;
}

type NativeImage = { image_url: string } | { file_id: string };

type EditResource = NativeImage | { path: string };

const MAX_MASK_BYTES = 50 * 1024 * 1024;

const REFERENCE_SOURCES = ["referenced_image_paths", "num_last_images_to_include", "images"] as const;

const PASSED_SETTINGS = [
	"n",
	"background",
	"output_compression",
	"quality",
	"size",
	"moderation",
	"stream",
	"partial_images",
] as const satisfies readonly (keyof OpenAIArgs)[];

const SIZE_RULES = {
	multiple: 16,
	maxRatio: 3,
	maxEdge: 3840,
	minPixels: 655_360,
	maxPixels: 8_294_400,
};

function checkSize(size: string): void {
	if (size === "auto") return;
	const match = /^(\d+)x(\d+)$/.exec(size);
	if (!match) throw new Error(`size must be "auto" or WIDTHxHEIGHT, such as 1536x864 (was ${JSON.stringify(size)}).`);
	const [width, height] = [Number(match[1]), Number(match[2])];
	const broken = (rule: string) => new Error(`size ${size} is not supported: ${rule}.`);
	if (width % SIZE_RULES.multiple || height % SIZE_RULES.multiple) throw broken("width and height must be multiples of 16");
	if (Math.max(width, height) > SIZE_RULES.maxEdge) throw broken("neither edge may exceed 3840 pixels");
	if (Math.max(width, height) > SIZE_RULES.maxRatio * Math.min(width, height)) {
		throw broken("the aspect ratio must be between 1:3 and 3:1");
	}
	const pixels = width * height;
	if (pixels < SIZE_RULES.minPixels) throw broken("it must have at least 655,360 pixels");
	if (pixels > SIZE_RULES.maxPixels) throw broken("it may have at most 8,294,400 pixels (3840x2160)");
}

function checkCombinations(args: OpenAIArgs): void {
	const format = args.output_format ?? undefined;
	if (args.output_compression != null && format !== "jpeg" && format !== "webp") {
		throw new Error(
			`output_compression applies only to output_format jpeg or webp, not ${format ?? "the default lossless WebP"}.`,
		);
	}
	if (args.background === "transparent" && format === "jpeg") {
		throw new Error('background "transparent" needs output_format png or webp; jpeg has no alpha channel.');
	}
	if (args.size != null) checkSize(args.size);
	if (args.partial_images != null && args.stream !== true) {
		throw new Error("partial_images needs stream: true; previews only arrive in a streamed response.");
	}
	const sources = REFERENCE_SOURCES.filter(source => args[source] != null);
	if (sources.length > 1) {
		throw new Error(`Use one Reference image source, not ${sources.join(" and ")} together.`);
	}
	const relative = args.referenced_image_paths?.filter(imagePath => !path.isAbsolute(imagePath)) ?? [];
	if (relative.length > 0) throw new Error(`referenced_image_paths must be absolute: ${relative.join(", ")}`);
	if (args.mask != null && args.markup != null) {
		throw new Error("Use mask or markup, not mask and markup together.");
	}
	for (const name of ["mask", "markup"] as const) {
		const resource = args[name];
		if (resource == null) continue;
		if (sources.length === 0) {
			throw new Error(
				`${name} applies to the first Reference image; give Reference images with referenced_image_paths, ` +
					"num_last_images_to_include, or images.",
			);
		}
		if ("path" in resource && !path.isAbsolute(resource.path)) {
			throw new Error(`${name}.path must be absolute: ${resource.path}`);
		}
	}
}

function dataUrlBytes(url: string): Uint8Array | undefined {
	const match = /^data:[^,;]*(?:;[^,;]*)*;base64,(.*)$/s.exec(url);
	return match ? Buffer.from(match[1] ?? "", "base64") : undefined;
}

async function editResource(
	name: "mask" | "markup",
	resource: EditResource,
): Promise<{ reference: NativeImage; bytes?: Uint8Array }> {
	if ("file_id" in resource) return { reference: resource };
	if ("image_url" in resource) return { reference: resource, bytes: dataUrlBytes(resource.image_url) };
	const bytes = await readImageFile(resource.path, name === "mask" ? "Mask" : "Markup");
	const format = imageFormatOf(bytes);
	if (!format) throw new Error(`${name} ${resource.path} is not a PNG, JPEG, or WebP image.`);
	return { reference: { image_url: `data:${mimeTypeOf(format)};base64,${Buffer.from(bytes).toString("base64")}` }, bytes };
}

async function checkMask(mask: Uint8Array, first: Uint8Array | undefined): Promise<void> {
	if (!hasAlphaChannel(mask)) {
		throw new Error("The mask has no alpha channel. Save it as a PNG or WebP with alpha; transparent areas mark the edit.");
	}
	if (mask.length >= MAX_MASK_BYTES) throw new Error("The mask must be smaller than 50 MB.");
	if (!first) return;
	const [maskFormat, firstFormat] = [imageFormatOf(mask), imageFormatOf(first)];
	if (maskFormat !== firstFormat) {
		throw new Error(
			`The mask must be the same format as the first Reference image (mask ${maskFormat ?? "unknown"}, image ${firstFormat ?? "unknown"}).`,
		);
	}
	const [maskSize, firstSize] = await Promise.all([orientedSize(mask), orientedSize(first)]);
	if (maskSize !== firstSize) throw new Error(`The mask is ${maskSize}, but the first Reference image is ${firstSize}.`);
}

async function checkMarkup(markup: Uint8Array, first: Uint8Array | undefined): Promise<void> {
	if (imageFormatOf(markup) !== "png") throw new Error("The markup must be a PNG with transparent pixels.");
	if (!(await hasTransparentPixels(markup))) {
		throw new Error("The markup has no transparent pixels. It is an overlay on the first Reference image.");
	}
	if (!first) return;
	const [markupSize, firstSize] = await Promise.all([orientedSize(markup), orientedSize(first)]);
	if (markupSize !== firstSize) {
		throw new Error(`The markup is ${markupSize}, but the first Reference image is ${firstSize} after its orientation.`);
	}
}

async function editOverlays(args: OpenAIArgs, images: readonly NativeImage[]): Promise<Record<string, NativeImage>> {
	const [first] = images;
	const firstImage = () => (first && "image_url" in first ? dataUrlBytes(first.image_url) : undefined);
	const overlays: Record<string, NativeImage> = {};
	if (args.mask != null) {
		const { reference, bytes } = await editResource("mask", args.mask);
		if (bytes) await checkMask(bytes, firstImage());
		overlays.mask = reference;
	}
	if (args.markup != null) {
		const { reference, bytes } = await editResource("markup", args.markup);
		if (bytes) await checkMarkup(bytes, firstImage());
		overlays.markup = reference;
	}
	return overlays;
}

async function references(args: OpenAIArgs, ctx: ExtensionContext): Promise<NativeImage[]> {
	if (args.images) return args.images;
	const urls = args.referenced_image_paths
		? await referencesFromPaths(args.referenced_image_paths, "openai")
		: args.num_last_images_to_include
			? await referencesFromConversation(ctx.sessionManager.getBranch(), args.num_last_images_to_include, "openai")
			: [];
	return urls.map(url => ({ image_url: url }));
}

function identifier(args: OpenAIArgs): Record<string, string> {
	if (args.safety_identifier) return { safety_identifier: args.safety_identifier };
	return args.user != null ? { user: args.user } : {};
}

function requestedSettings(args: OpenAIArgs) {
	const explicit = args.output_format ?? undefined;
	const settings: Record<string, unknown> = {
		model: args.model ?? SUNBURST_MODELS[0],
		output_format: explicit ?? "png",
	};
	for (const field of PASSED_SETTINGS) {
		if (args[field] != null) settings[field] = args[field];
	}
	return { settings, policy: explicit ? ("as-returned" as const) : ("lossless-webp" as const) };
}

function editResourceType(type: ExtensionAPI["arktype"]) {
	return type({ path: "string" })
		.or({ image_url: "string <= 20971520" })
		.or({ file_id: "string" })
		.or("null");
}

export function openaiMode(type: ExtensionAPI["arktype"]): ImageMode<OpenAIDetails> {
	const parameters = type({
		prompt: type("0 < string <= 32000").describe("Image or edit description, sent unchanged; up to 32,000 characters."),
		"model?": type("'gpt-image-2.5-sunburst' | 'gpt-image-2.5-sunburst-2026-09-08' | null").describe(
			"gpt-image-2.5-sunburst (default) or its pinned snapshot gpt-image-2.5-sunburst-2026-09-08.",
		),
		"n?": type("1 <= number.integer <= 10 | null").describe("Number of images, 1–10; every image is returned."),
		"quality?": type("'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null").describe(
			"Rendering effort and cost, low to max; auto by default.",
		),
		"size?": type("string | null").describe(
			"auto (default), 1024x1024, 1536x1024, 1024x1536, or WIDTHxHEIGHT: multiples of 16, ratio 1:3 to 3:1, " +
				"edges up to 3840, 655,360 to 8,294,400 pixels. Sizes above 2560x1440 are experimental.",
		),
		"output_format?": type("'png' | 'jpeg' | 'webp' | null").describe(
			"Omit for a lossless WebP made locally from PNG. An explicit format returns the API's own bytes.",
		),
		"output_compression?": type("0 <= number.integer <= 100 | null").describe(
			"0–100, for output_format jpeg or webp only.",
		),
		"background?": type("'auto' | 'opaque' | 'transparent' | null").describe(
			"transparent needs png, webp, or the default format.",
		),
		"moderation?": type("'auto' | 'low' | null").describe("auto (default) or low, which filters less strictly."),
		"safety_identifier?": type("string <= 128 | null").describe(
			"Stable hashed end-user id for OpenAI safety monitoring, up to 128 characters. Only when the user supplies one.",
		),
		"user?": type("string | null").describe("Deprecated end-user id; safety_identifier takes precedence."),
		"referenced_image_paths?": type("string[] <= 16 | null").describe(
			"Absolute paths of Reference images to edit or draw from, up to 16, in order.",
		),
		"num_last_images_to_include?": type("1 <= number.integer <= 16 | null").describe(
			"Use the last N conversation images, 1–16, oldest first.",
		),
		"images?": type({ image_url: "string <= 20971520" })
			.or({ file_id: "string" })
			.array()
			.atMostLength(16)
			.or("null")
			.describe("Up to 16 Reference images as { image_url } (https or data URL) or { file_id }."),
		"stream?": type("boolean | null").describe("Stream the response, showing previews as they arrive."),
		"partial_images?": type("0 <= number.integer <= 3 | null").describe(
			"Previews to stream, 0–3; needs stream. Each preview costs 100 extra image output tokens. Fewer may arrive.",
		),
		"mask?": editResourceType(type).describe(
			"Edit only where this mask is transparent: { path }, { image_url }, or { file_id }. A PNG or WebP with alpha, " +
				"the same format and size as the first Reference image. Not with markup.",
		),
		"markup?": editResourceType(type).describe(
			"Visual instructions drawn on a transparent PNG the size of the first Reference image: { path }, " +
				"{ image_url }, or { file_id }. Not with mask.",
		),
	});
	return {
		id: "openai",
		description: description.trimEnd(),
		parameters,
		callFacts: args => {
			const facts: string[] = [];
			const count = referenceCount(args) ?? (Array.isArray(args.images) ? args.images.length : undefined);
			if (count) facts.push(`${count} reference${count === 1 ? "" : "s"}`);
			if (typeof args.model === "string" && args.model !== SUNBURST_MODELS[0]) facts.push(args.model);
			if (typeof args.n === "number" && args.n > 1) facts.push(`n ${args.n}`);
			if (typeof args.output_format === "string") facts.push(args.output_format);
			if (args.background === "transparent") facts.push("transparent");
			return facts;
		},
		cardWarnings: () => [],
		async run({ params, signal, ctx, onPreview }) {
			const args = params as unknown as OpenAIArgs;
			checkCombinations(args);
			const { settings, policy } = requestedSettings(args);
			const access = await openaiAccess(ctx, signal);
			const images = await references(args, ctx);
			const overlays = await editOverlays(args, images);
			const body = { ...settings, ...identifier(args), prompt: args.prompt };
			const expectedImages = args.n ?? 1;
			let previews = 0;
			const response = await requestSunburstImages(
				images.length > 0
					? { endpoint: "edits", body: { images, ...overlays, ...body }, expectedImages }
					: { endpoint: "generations", body, expectedImages },
				access,
				signal,
				preview => onPreview?.({ preview, count: ++previews }),
			);
			return {
				images: response.images,
				policy,
				notes: [],
				details: { requested: settings, reported: response.reported, usage: response.usage, requestId: response.requestId },
			};
		},
	};
}
