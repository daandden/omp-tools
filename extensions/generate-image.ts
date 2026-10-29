// This registration wins whether loaded before native tools or deferred until
// after startup. Deferred extension tools replace the same-name native tool.
//
// OMP's argument validator deletes unknown keys from closed schemas before
// `execute` runs, so the schema stays open and `execute` rejects them itself.
import { pathToFileURL } from "node:url";
import type { AgentToolResult, ExtensionAPI, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { getPluginSettings } from "@oh-my-pi/pi-coding-agent/extensibility/plugins/loader";
import { type NativeChild, node, span, text } from "@oh-my-pi/pi-tui";
import type { NativeToolHead, NativeToolView } from "@oh-my-pi/pi-tui/tools/renderer";
import { saveImages, savedImagesText } from "./image-artifacts";
import { codexMode, type ImageMode, type ImageModeId, type PreviewDetails } from "./image-modes";
import { openaiMode } from "./openai-mode";

interface OutputDetails {
	path: string;
	mimeType: string;
	size?: string;
	quality?: string;
}

type FinalDetails<D> = { mode: ImageModeId; outputs: OutputDetails[] } & D;

type GenerateImageDetails<D> = FinalDetails<D> | PreviewDetails;

function isPreview<D>(details: GenerateImageDetails<D>): details is PreviewDetails {
	return "stage" in details && details.stage === "preview";
}

/** A Codex result saved before Image generation modes, as session files still hold it. */
interface LegacyDetails {
	path: string;
	size?: string;
	quality?: string;
	quotaWarning?: string;
}

function cardContent<D>(mode: ImageMode<D>, details: FinalDetails<D>): { outputs: OutputDetails[]; warnings: string[] } {
	if (Array.isArray(details.outputs)) return { outputs: details.outputs, warnings: mode.cardWarnings(details) };
	const legacy = details as unknown as LegacyDetails;
	return {
		outputs: [{ path: legacy.path, mimeType: "image/webp", size: legacy.size, quality: legacy.quality }],
		warnings: legacy.quotaWarning ? [legacy.quotaWarning] : [],
	};
}

function imageHead<D>(mode: ImageMode<D>, args: Record<string, unknown>, outputs: OutputDetails[] = []): NativeToolHead {
	const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
	const meta = mode.callFacts(args);
	const [only] = outputs;
	if (outputs.length === 1 && only) {
		if (only.size) meta.push(only.size);
		if (only.quality) meta.push(`quality ${only.quality}`);
	} else if (outputs.length > 1) {
		meta.push(`${outputs.length} images`);
	}
	return {
		title: "Generate image",
		target: prompt.split("\n", 1)[0] || undefined,
		targetKind: "text",
		meta: meta.length > 0 ? meta : undefined,
	};
}

function promptSection(args: Record<string, unknown>): NativeChild[] {
	const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
	if (!prompt.includes("\n") && prompt.length <= 100) return [];
	return [node("section", { head: "Prompt", collapsible: true, collapsed: true }, [text(prompt, { wrap: "word" })], "prompt")];
}

function savedLine(output: OutputDetails, label: string, facts: boolean): NativeChild {
	const extra = facts ? [output.size, output.quality && `quality ${output.quality}`].filter(Boolean).join(", ") : "";
	return text(
		[
			span(label, "dim"),
			span(output.path, "path", { href: pathToFileURL(output.path).href }),
			...(extra ? [span(` · ${extra}`, "dim")] : []),
		],
		{ wrap: "char" },
	);
}

function describeImageResult<D>(
	mode: ImageMode<D>,
	result: AgentToolResult<GenerateImageDetails<D>>,
	args: Record<string, unknown>,
): NativeToolView {
	const details = result.details;
	if (details && isPreview(details)) {
		const label = `Preview ${details.previews}, in progress (not a final image)`;
		return { tool: imageHead(mode, args), body: [text([span(label, "dim")]), ...promptSection(args)], open: true };
	}
	if (result.isError || !details) {
		const message = result.content.flatMap(block => (block.type === "text" ? [block.text] : [])).join("\n").trim();
		return {
			tool: imageHead(mode, args),
			tone: "error",
			body: message ? [text([span(message, "error")], { wrap: "word" })] : undefined,
		};
	}
	const { outputs, warnings } = cardContent(mode, details);
	const many = outputs.length > 1;
	const body: NativeChild[] = outputs.map((output, index) =>
		savedLine(output, many ? `${index + 1}. Saved to ` : "Saved to ", many),
	);
	for (const warning of warnings) body.push(text([span(warning, "warning")], { wrap: "word" }));
	body.push(...promptSection(args));
	return { tool: imageHead(mode, args, outputs), body, open: true };
}

function argumentNames(mode: ImageMode<unknown>): string[] {
	const schema = mode.parameters.toJsonSchema() as { properties?: Record<string, unknown> };
	return Object.keys(schema.properties ?? {});
}

function registerImageTool<D extends object>(pi: ExtensionAPI, mode: ImageMode<D>) {
	const names = argumentNames(mode);
	const resultViews = new WeakMap<object, NativeToolView>();
	const definition: ToolDefinition<ImageMode<D>["parameters"], GenerateImageDetails<D>> = {
		name: "generate_image",
		label: "GenerateImage",
		description: mode.description,
		parameters: mode.parameters,
		approval: "write",
		describeCall: args => ({ tool: imageHead(mode, args ?? {}), body: promptSection(args ?? {}) }),
		describeResult: (result, _options, args) => {
			const cached = result.details && resultViews.get(result.details);
			if (cached) return cached;
			const view = describeImageResult(mode, result, args ?? {});
			if (result.details) resultViews.set(result.details, view);
			return view;
		},
		async execute(toolCallId, params: Record<string, unknown>, signal, onUpdate, ctx) {
			const unknown = Object.keys(params).filter(key => !names.includes(key));
			if (unknown.length > 0) {
				throw new Error(`Unknown argument(s): ${unknown.join(", ")}. generate_image accepts only ${names.join(", ")}.`);
			}
			const checked = mode.parameters(params);
			if (checked instanceof pi.arktype.errors) throw new Error(`Invalid generate_image arguments: ${checked.summary}`);

			const run = await mode.run({
				toolCallId,
				params,
				signal,
				ctx,
				onPreview: onUpdate
					? ({ preview, count }) =>
							onUpdate({
								content: [
									{ type: "image", data: preview.data, mimeType: preview.mimeType },
									{ type: "text", text: `Preview ${count}, in progress. This is not a final image.` },
								],
								details: { stage: "preview", mode: mode.id, previews: count },
							})
					: undefined,
			});
			const saved = await saveImages(run.images, run.policy, signal);
			return {
				content: [
					...saved.map(image => ({ type: "image" as const, data: image.base64, mimeType: image.mimeType })),
					{ type: "text", text: [...savedImagesText(saved), ...run.notes].join("\n") },
				],
				details: {
					mode: mode.id,
					outputs: saved.map(({ path, mimeType, size, quality }) => ({ path, mimeType, size, quality })),
					...run.details,
				},
			};
		},
	};
	// The result view replaces the call view (the host's `mergeCallAndResult`,
	// forwarded from the definition like `concurrency` in flexible-ask.ts).
	pi.registerTool(Object.assign(definition, { mergeCallAndResult: true }));
}

const MODE_VALUES: readonly ImageModeId[] = ["openai", "codex"];

function selectedMode(value: unknown): ImageModeId | { invalid: string } {
	if (value === undefined || value === null) return "openai";
	return MODE_VALUES.find(mode => mode === value) ?? { invalid: JSON.stringify(value) };
}

function registerConfigurationError(pi: ExtensionAPI, message: string) {
	const parameters = pi.arktype({ prompt: pi.arktype("string").describe("Image or edit description.") });
	const definition: ToolDefinition<typeof parameters> = {
		name: "generate_image",
		label: "GenerateImage",
		description: `Not available: ${message}`,
		parameters,
		approval: "write",
		async execute() {
			throw new Error(message);
		},
	};
	pi.registerTool(definition);
}

async function registerConfiguredTool(pi: ExtensionAPI, cwd: string): Promise<void> {
	const settings = await getPluginSettings("omp-tools", cwd);
	const mode = selectedMode(settings.imageGenerationMode);
	if (typeof mode === "object") {
		registerConfigurationError(
			pi,
			`The omp-tools setting imageGenerationMode is ${mode.invalid}, but it must be "openai" or "codex". Set it ` +
				"with `omp plugin config set omp-tools imageGenerationMode openai` (or codex), then start a new session.",
		);
		return;
	}
	if (mode === "codex") registerImageTool(pi, codexMode(pi.arktype));
	else registerImageTool(pi, openaiMode(pi.arktype));
}

/**
 * OMP runs this initializer once per process, so each new session (`/new`,
 * resume, fork) reads the setting again and registers the tool anew. A call
 * already running keeps the definition it started with.
 */
export default async function generateImage(pi: ExtensionAPI) {
	await registerConfiguredTool(pi, process.cwd());
	pi.on("session_switch", async (_event, ctx) => {
		await registerConfiguredTool(pi, ctx.cwd);
	});
}
