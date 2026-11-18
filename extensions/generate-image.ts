// This registration wins whether loaded before native tools or deferred until
// after startup. Deferred extension tools replace the same-name native tool.
//
// OMP's argument validator deletes unknown keys from closed schemas before
// `execute` runs, so the schema stays open and `execute` rejects them itself.
import { pathToFileURL } from "node:url";
import type { TypeProperty } from "@oh-my-pi/omptype";
import type { AgentToolResult, ExtensionAPI, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { getPluginSettings } from "@oh-my-pi/pi-coding-agent/extensibility/plugins/loader";
import { formatApprovalArguments } from "@oh-my-pi/pi-coding-agent/tools/approval";
import { type NativeChild, node, span, text } from "@oh-my-pi/pi-tui";
import type { NativeToolHead, NativeToolView } from "@oh-my-pi/pi-tui/tools/renderer";
import { prompt } from "@oh-my-pi/pi-utils";
import description from "./generate-image.md" with { type: "text" };
import { saveImages, savedImagesText } from "./image-artifacts";
import { codexMode, type ImageMode, type ImageModeId, type PreviewDetails, type Schema } from "./image-modes";
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

function cardContent<D>(
	mode: ImageMode<D> | undefined,
	details: FinalDetails<D>,
): { outputs: OutputDetails[]; warnings: string[] } {
	if (Array.isArray(details.outputs)) return { outputs: details.outputs, warnings: mode?.cardWarnings(details) ?? [] };
	const legacy = details as unknown as LegacyDetails;
	return {
		outputs: [{ path: legacy.path, mimeType: "image/webp", size: legacy.size, quality: legacy.quality }],
		warnings: legacy.quotaWarning ? [legacy.quotaWarning] : [],
	};
}

/** The head names the mode the call used; a call naming an invalid mode used none. */
function imageHead<D>(
	mode: ImageMode<D> | undefined,
	args: Record<string, unknown>,
	outputs: OutputDetails[] = [],
): NativeToolHead {
	const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
	const meta = mode ? [mode.label, ...mode.callFacts(args)] : [];
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
	mode: ImageMode<D> | undefined,
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

type Modes = Record<ImageModeId, ImageMode<object>>;

const MODE_VALUES: readonly ImageModeId[] = ["openai", "codex"];

function modeIdOf(value: unknown): ImageModeId | undefined {
	return MODE_VALUES.find(id => id === value);
}

function argumentNames(schema: Schema): string[] {
	const json = schema.toJsonSchema() as { properties?: Record<string, unknown> };
	return Object.keys(json.properties ?? {});
}

function properties(schema: Schema): readonly TypeProperty[] {
	return (schema as unknown as { props: readonly TypeProperty[] }).props;
}

/**
 * Every mode's arguments plus `mode`, in one open schema. An argument several
 * modes take accepts what any of them accepts; `execute` applies the chosen
 * mode's own schema.
 */
function sharedParameters(type: ExtensionAPI["arktype"], modes: Modes): Schema {
	const merged = new Map<string, { required: boolean; schema: Schema; notes: { label: string; text: string }[] }>();
	for (const id of MODE_VALUES) {
		const mode = modes[id];
		for (const property of properties(mode.parameters)) {
			const key = String(property.key);
			const note = { label: mode.label, text: property.value.description ?? "" };
			const seen = merged.get(key);
			if (seen) {
				seen.required &&= property.kind === "required";
				seen.schema = seen.schema.or(property.value);
				seen.notes.push(note);
			} else {
				merged.set(key, { required: property.kind === "required", schema: property.value, notes: [note] });
			}
		}
	}
	const definition: Record<string, Schema> = {
		"mode?": type("'openai' | 'codex'").describe(
			"Image generation mode for this call; the Default image generation mode when omitted.",
		),
	};
	for (const [key, { required, schema, notes }] of merged) {
		const [first] = notes;
		const description =
			notes.length === 1 && first
				? `${first.label} only. ${first.text}`
				: notes.every(note => note.text === first?.text)
					? (first?.text ?? "")
					: notes.map(note => `${note.label}: ${note.text}`).join(" ");
		definition[required ? key : `${key}?`] = schema.describe(description);
	}
	return type(definition);
}

function registerImageTool(pi: ExtensionAPI, modes: Modes, defaultMode: ImageModeId) {
	const parameters = sharedParameters(pi.arktype, modes);
	const names = argumentNames(parameters);
	const modeNames = { openai: argumentNames(modes.openai.parameters), codex: argumentNames(modes.codex.parameters) };
	const otherMode = MODE_VALUES.find(id => id !== defaultMode);
	const resultViews = new WeakMap<object, NativeToolView>();
	/** A call's mode: its `mode`, else the default; undefined for an invalid `mode`. */
	const callModeId = (args: Record<string, unknown> | undefined) =>
		args?.mode === undefined ? defaultMode : modeIdOf(args.mode);
	const modeOf = (id: ImageModeId | undefined) => (id ? modes[id] : undefined);
	const definition: ToolDefinition<Schema, GenerateImageDetails<object>> = {
		name: "generate_image",
		label: "GenerateImage",
		description: prompt.render(description, { defaultMode, otherMode }).trimEnd(),
		parameters,
		approval: "write",
		describeCall: args => ({ tool: imageHead(modeOf(callModeId(args)), args ?? {}), body: promptSection(args ?? {}) }),
		describeResult: (result, _options, args) => {
			const details = result.details;
			const cached = details && resultViews.get(details);
			if (cached) return cached;
			// OMP 18.22.2 stores a thrown error with empty details, so an error card
			// takes the call's mode. Results saved before Image generation modes are
			// Codex results without `mode`.
			const id =
				result.isError || !details ? callModeId(args) : "mode" in details ? modeIdOf(details.mode) : "codex";
			const view = describeImageResult(modeOf(id), result, args ?? {});
			if (details) resultViews.set(details, view);
			return view;
		},
		async execute(toolCallId, params: Record<string, unknown>, signal, onUpdate, ctx) {
			const unknown = Object.keys(params).filter(key => !names.includes(key));
			if (unknown.length > 0) {
				throw new Error(`Unknown argument(s): ${unknown.join(", ")}. generate_image accepts only ${names.join(", ")}.`);
			}
			const { mode: _mode, ...modeParams } = params;
			const modeId = callModeId(params);
			if (!modeId) throw new Error(`mode must be "openai" or "codex" (was ${JSON.stringify(params.mode)}).`);
			const mode = modes[modeId];
			const accepted = modeNames[modeId];
			const unsupported = Object.keys(modeParams).filter(key => !accepted.includes(key));
			if (unsupported.length > 0) {
				throw new Error(`${mode.label} does not take ${unsupported.join(", ")}. It takes ${accepted.join(", ")}.`);
			}
			const checked = mode.parameters(modeParams);
			if (checked instanceof pi.arktype.errors) {
				throw new Error(`Invalid generate_image arguments for ${mode.label}: ${checked.summary}`);
			}

			const run = await mode.run({
				toolCallId,
				params: modeParams,
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
					...saved.flatMap(({ base64, mimeType }) =>
						base64 === undefined ? [] : [{ type: "image" as const, data: base64, mimeType }],
					),
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
	// The approval prompt shows a native extension tool's arguments only
	// through its own `formatApprovalDetails` (OMP 18.22.0 `approvalDetails`).
	// The host forwards it from the definition, but the extension type omits it.
	const formatApprovalDetails = (args: unknown): string[] => {
		const call = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
		const mode = modeOf(callModeId(call));
		const modeLine = !mode
			? []
			: call.mode === undefined
				? [`Mode: ${mode.label}, the Default image generation mode`]
				: [`Mode: ${mode.label}`];
		return [...modeLine, ...formatApprovalArguments(args, { showEmpty: true })];
	};
	// The result view replaces the call view (the host's `mergeCallAndResult`,
	// forwarded from the definition like `concurrency` in flexible-ask.ts).
	pi.registerTool(Object.assign(definition, { mergeCallAndResult: true, formatApprovalDetails }));
}

function selectedMode(value: unknown): ImageModeId | { invalid: string } {
	if (value === undefined || value === null) return "openai";
	return modeIdOf(value) ?? { invalid: JSON.stringify(value) };
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
	if ("imageGenerationMode" in settings && !("defaultImageGenerationMode" in settings)) {
		const oldValue = settings.imageGenerationMode;
		const command = "omp plugin config set omp-tools defaultImageGenerationMode";
		const oldMode = MODE_VALUES.find(mode => mode === oldValue);
		registerConfigurationError(
			pi,
			oldMode
				? `The omp-tools setting imageGenerationMode was renamed. Run \`${command} ${oldMode}\`, then start a new session.`
				: `The old omp-tools setting imageGenerationMode is ${JSON.stringify(oldValue)}. ` +
					`Choose "openai" or "codex", then run \`${command} <value>\` and start a new session.`,
		);
		return;
	}
	const mode = selectedMode(settings.defaultImageGenerationMode);
	if (typeof mode === "object") {
		registerConfigurationError(
			pi,
			`The omp-tools setting defaultImageGenerationMode is ${mode.invalid}, but it must be "openai" or "codex". ` +
				"Set it with `omp plugin config set omp-tools defaultImageGenerationMode openai` (or codex), then start a new session.",
		);
		return;
	}
	registerImageTool(pi, { openai: openaiMode(pi.arktype, settings.svgAuthorModel), codex: codexMode(pi.arktype) }, mode);
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
