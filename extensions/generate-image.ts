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
import type { ExtensionAPI, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { Snowflake } from "@oh-my-pi/pi-utils";
import { requestImage } from "./codex-images";
import description from "./generate-image.md" with { type: "text" };
import { referencesFromConversation, referencesFromPaths, toLosslessWebp } from "./reference-images";

const ARGUMENTS = ["prompt", "transparent_background", "referenced_image_paths", "num_last_images_to_include"];

interface GenerateImageDetails {
	path: string;
	size?: string;
	quality?: string;
	/** For tracing a result with OpenAI; not shown to the model. */
	requestId?: string;
	generationId?: string;
	outputTokens?: number;
}

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
					requestId: generated.requestId,
					generationId: generated.generationId,
					outputTokens: generated.outputTokens,
				},
			};
		},
	};
	pi.registerTool(definition);
}
