// generate_image: replaces native `generate_image` with a direct call to the
// Codex Images endpoint, the way the official Codex CLI does. Codex OAuth only
// (`openai-codex` login), no system instructions, and Codex's exact arguments.
//
// Native `generate_image` is settings-gated and installed after extensions,
// skipping taken names, so this registration wins either way; users disable
// native anyway (README).
//
// OMP's argument validator deletes unknown keys from closed schemas before
// `execute` runs, so the schema stays open and `execute` rejects them itself.
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentToolResult, ExtensionAPI, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { type NativeChild, node, span, text } from "@oh-my-pi/pi-tui";
import type { NativeToolHead, NativeToolView } from "@oh-my-pi/pi-tui/tools/renderer";
import { Snowflake } from "@oh-my-pi/pi-utils";
import { requestImage } from "./codex-images";
import description from "./generate-image.md" with { type: "text" };
import { referencesFromConversation, referencesFromPaths, toLosslessWebp } from "./reference-images";

const ARGUMENTS = ["prompt", "transparent_background", "referenced_image_paths", "num_last_images_to_include"];

interface GenerateImageDetails {
	path: string;
	size?: string;
	quality?: string;
	/** The near-limit warning appended to the result text, for the Tern card. */
	quotaWarning?: string;
	/** For tracing a result with OpenAI; not shown to the model. */
	requestId?: string;
	generationId?: string;
	outputTokens?: number;
}

interface GenerateImageArgs {
	prompt?: string;
	transparent_background?: boolean;
	referenced_image_paths?: string[];
	num_last_images_to_include?: number;
}

/** The Tern card head: the prompt's first line, then reference and output facts. */
function imageHead(args: GenerateImageArgs, details?: GenerateImageDetails): NativeToolHead {
	const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
	const meta: string[] = [];
	const references = args.referenced_image_paths?.length ?? args.num_last_images_to_include;
	if (references) meta.push(`${references} reference${references === 1 ? "" : "s"}`);
	if (args.transparent_background) meta.push("transparent");
	if (details?.size) meta.push(details.size);
	if (details?.quality) meta.push(`quality ${details.quality}`);
	return {
		title: "Generate image",
		target: prompt.split("\n", 1)[0] || undefined,
		targetKind: "text",
		meta: meta.length > 0 ? meta : undefined,
	};
}

/** The whole prompt, folded, when the head's one line is unlikely to show it all. */
function promptSection(args: GenerateImageArgs): NativeChild[] {
	const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
	if (!prompt.includes("\n") && prompt.length <= 100) return [];
	return [node("section", { head: "Prompt", collapsible: true, collapsed: true }, [text(prompt, { wrap: "word" })], "prompt")];
}

/**
 * The Tern card once the call ends: the saved file (click opens it), the
 * near-limit warning, the folded prompt, then the image, which the host
 * appends from `content`. Open from the start so the image shows.
 */
function describeImageResult(
	result: AgentToolResult<GenerateImageDetails>,
	args: GenerateImageArgs,
): NativeToolView {
	const details = result.details;
	if (result.isError || !details) {
		const message = result.content.flatMap(block => (block.type === "text" ? [block.text] : [])).join("\n").trim();
		return {
			tool: imageHead(args),
			tone: "error",
			body: message ? [text([span(message, "error")], { wrap: "word" })] : undefined,
		};
	}
	const body: NativeChild[] = [
		text([span("Saved to ", "dim"), span(details.path, "path", { href: pathToFileURL(details.path).href })], {
			wrap: "char",
		}),
	];
	if (details.quotaWarning) body.push(text([span(details.quotaWarning, "warning")], { wrap: "word" }));
	body.push(...promptSection(args));
	return { tool: imageHead(args, details), body, open: true };
}

const resultViews = new WeakMap<GenerateImageDetails, NativeToolView>();

function savedImageHint(dir: string, file: string): string {
	return (
		`Generated images are saved to ${dir} as ${file} by default. If you need to use a generated image at another ` +
		"path, copy it and leave the original in place unless the user explicitly asks you to delete it. The generated " +
		"image is already displayed to the user. There is no need to render it in the final response as a Markdown " +
		"image or file link."
	);
}

export default function generateImage(pi: ExtensionAPI) {
	const type = pi.arktype;
	const parameters = type({
		prompt: type("string").describe("Image or edit description."),
		"transparent_background?": type("boolean").describe("Transparent output."),
		"referenced_image_paths?": type("string[]").describe("Absolute image paths, max 5."),
		"num_last_images_to_include?": type("1 <= number.integer <= 5").describe(
			"Last N conversation images, 1–5; not with paths.",
		),
	});

	const definition: ToolDefinition<typeof parameters, GenerateImageDetails> = {
		name: "generate_image",
		label: "GenerateImage",
		description: description.trimEnd(),
		parameters,
		approval: "write",
		describeCall: args => ({ tool: imageHead(args), body: promptSection(args) }),
		describeResult: (result, _options, args) => {
			// Keyed by `details` (one object per result) so an unchanged card keeps its nodes.
			const cached = result.details && resultViews.get(result.details);
			if (cached) return cached;
			const view = describeImageResult(result, args ?? {});
			if (result.details) resultViews.set(result.details, view);
			return view;
		},
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const unknown = Object.keys(params).filter(key => !ARGUMENTS.includes(key));
			if (unknown.length > 0) {
				throw new Error(`Unknown argument(s): ${unknown.join(", ")}. generate_image accepts only ${ARGUMENTS.join(", ")}.`);
			}
			const paths = params.referenced_image_paths;
			const count = params.num_last_images_to_include;
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
				? await referencesFromPaths(paths)
				: count
					? await referencesFromConversation(ctx.sessionManager.getBranch(), count)
					: [];
			const generated = await requestImage(
				{ prompt: params.prompt, transparent: params.transparent_background ?? false, references },
				accessToken,
				toolCallId,
				signal,
			);

			const webp = await toLosslessWebp(generated.bytes);
			const dir = os.tmpdir();
			const file = path.join(dir, `omp-image-${Snowflake.next()}.webp`);
			await Bun.write(file, webp);
			const reported = [generated.size, generated.quality && `quality ${generated.quality}`].filter(Boolean);
			const lines = [savedImageHint(dir, file)];
			if (reported.length > 0) lines.push(reported.join(", "));
			if (generated.quotaWarning) lines.push(generated.quotaWarning);
			return {
				content: [
					{ type: "image", data: Buffer.from(webp).toString("base64"), mimeType: "image/webp" },
					{ type: "text", text: lines.join("\n") },
				],
				details: {
					path: file,
					size: generated.size,
					quality: generated.quality,
					quotaWarning: generated.quotaWarning,
					requestId: generated.requestId,
					generationId: generated.generationId,
					outputTokens: generated.outputTokens,
				},
			};
		},
	};
	// The result view replaces the call view (the host's `mergeCallAndResult`,
	// forwarded from the definition like `concurrency` in flexible-ask.ts).
	pi.registerTool(Object.assign(definition, { mergeCallAndResult: true }));
}
