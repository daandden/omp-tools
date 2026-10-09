// Flexible Ask: shadow the built-in `ask` tool with option guidance that
// states no count and a full-Markdown picker.
//
// Minimal-diff contract: ./flexible-ask.md mirrors
// `packages/coding-agent/src/prompts/tools/ask.md` verbatim except one
// deviation: the option count ("2–5 distinct options each" -> "distinct
// options", no number). Keep it that way; any other prose drift is a bug.
// Prompt lives in a static .md, never built in code.
//
// Execution: in the interactive TUI the wrapper shows its own picker
// (./ask-dialog.ts) because the native dialog flattens questions to one
// inline paragraph and cannot be restyled from an extension. Everywhere else
// (RPC/ACP/print, subagents) and for inputs the native tool rejects, it
// delegates to the native tool through `ctx.invokeTool`.
import type {
	AgentToolResult,
	AskToolDetails,
	ExtensionAPI,
	ExtensionAskDialogQuestion,
	ExtensionContext,
	QuestionResult,
	ToolDefinition,
} from "@oh-my-pi/pi-coding-agent";
import { askToolRenderer, discoverSlashCommands, logger, settings } from "@oh-my-pi/pi-coding-agent";
import { cfgAskNotify, cfgAskTimeout } from "@oh-my-pi/pi-coding-agent/modes/settings";
import { ToolAbortError } from "@oh-my-pi/pi-coding-agent/tools/tool-errors";
import { type AutocompleteProvider, span, TERMINAL, text } from "@oh-my-pi/pi-tui";
import type { NativeToolView } from "@oh-my-pi/pi-tui/tools/renderer";
import { sanitizeCarriageReturns } from "@oh-my-pi/pi-tui/render";
import { type MarkdownAskResult, showMarkdownAskDialog } from "./ask-dialog";
import { formatAskAnswers } from "./ask-result";
import { pickerBtwRunner } from "./picker-btw";
import flexibleAskDescription from "./flexible-ask.md" with { type: "text" };

/** Labels the native runtime reserves for its own action rows. */
const RESERVED_OPTION_LABELS = new Set(["Other (type your own)", "Chat about this", "Next →"]);

/** Native ask details plus the Submit note, which only the picker writes. */
type FlexibleAskDetails = AskToolDetails & {
	/** Shown on the Tern card; the model reads it in the result text. */
	submitNote?: string;
};

/** Result views, keyed by `details` so an unchanged card keeps its nodes. */
const resultViews = new WeakMap<FlexibleAskDetails, NativeToolView | undefined>();
/** Views with a plain head target, keyed by the native view they rewrite. */
const plainTargetViews = new WeakMap<NativeToolView, NativeToolView>();

const HEADING_MARKER = /^\s*#{1,6}\s+/;

/** Native ask heads the card with the question's first line; drop its Markdown heading marker. */
function withPlainTarget(view: NativeToolView | undefined): NativeToolView | undefined {
	const target = view?.tool?.target;
	if (!view || typeof target !== "string" || !HEADING_MARKER.test(target)) return view;
	let plain = plainTargetViews.get(view);
	if (!plain) {
		plain = { ...view, tool: { ...view.tool, target: target.replace(HEADING_MARKER, "") } };
		plainTargetViews.set(view, plain);
	}
	return plain;
}

/** The native ask card for the result, with the Submit note below the answers. */
function describeAskResult(
	result: AgentToolResult<FlexibleAskDetails>,
	args: Parameters<typeof askToolRenderer.describeResult>[2],
): NativeToolView | undefined {
	const details = result.details;
	if (details && resultViews.has(details)) return resultViews.get(details);
	const view = askToolRenderer.describeResult(result, undefined, args);
	const note = details?.submitNote;
	const withNote =
		view && note
			? {
					...view,
					body: [
						...(view.body ?? []),
						text([span("Note on all answers: ", "dim"), span(note, "muted")], {
							wrap: "word",
							role: "omp.tool.context",
						}),
					],
				}
			: view;
	const described = withPlainTarget(withNote);
	if (details) resultViews.set(details, described);
	return described;
}

interface AskQuestionParams {
	id: string;
	question: string;
	header?: string;
	options: Array<{ label: string; description?: string; preview?: string }>;
	multi?: boolean;
	recommended?: number;
}

/** Strip model-injected `\r` runs before display and before answers echo back (native parity). */
function sanitizeQuestions(questions: readonly AskQuestionParams[]): ExtensionAskDialogQuestion[] {
	return questions.map(question => ({
		id: sanitizeCarriageReturns(question.id),
		question: sanitizeCarriageReturns(question.question),
		...(question.header?.trim() ? { header: sanitizeCarriageReturns(question.header) } : {}),
		options: question.options.map(option => ({
			label: sanitizeCarriageReturns(option.label),
			...(option.description?.trim() ? { description: sanitizeCarriageReturns(option.description).trim() } : {}),
			...(option.preview?.trim() ? { preview: sanitizeCarriageReturns(option.preview) } : {}),
		})),
		...(question.multi !== undefined ? { multi: question.multi } : {}),
		...(question.recommended !== undefined ? { recommended: question.recommended } : {}),
	}));
}

/** Inputs the native tool answers with an error result instead of a dialog. */
function nativeRejects(questions: readonly ExtensionAskDialogQuestion[]): boolean {
	const ids = new Set<string>();
	for (const question of questions) {
		if (ids.has(question.id)) return true;
		ids.add(question.id);
		const labels = new Set<string>();
		for (const option of question.options) {
			if (RESERVED_OPTION_LABELS.has(option.label) || labels.has(option.label)) return true;
			labels.add(option.label);
		}
	}
	return false;
}

/**
 * Names of commands defined as files (`~/.agents/commands`, `~/.omp/commands`,
 * project command folders), the only `/` suggestions in the answer box. Bundled
 * templates carry no source provider and are left out. Loaded per dialog so
 * new or renamed files show up without a reload.
 */
async function loadFileCommandNames(cwd: string): Promise<ReadonlySet<string>> {
	try {
		const commands = await discoverSlashCommands({ cwd });
		return new Set(commands.filter(command => command._source !== undefined).map(command => command.name));
	} catch (error) {
		logger.warn("omp-tools: failed to load file commands for ask suggestions", { error: String(error) });
		return new Set();
	}
}

async function askWithMarkdownDialog(
	ctx: ExtensionContext,
	questions: ExtensionAskDialogQuestion[],
	signal: AbortSignal | undefined,
	autocomplete: () => AutocompleteProvider | undefined,
): Promise<AgentToolResult<FlexibleAskDetails>> {
	const timeoutSeconds = cfgAskTimeout.get(settings);
	if (cfgAskNotify.get(settings) !== "off") {
		TERMINAL.sendNotification({
			title: "omp",
			body: "Waiting for input",
			type: "ask",
			urgency: "normal",
			actions: "focus",
		});
	}

	let dialogResult: MarkdownAskResult | undefined;
	try {
		dialogResult = await showMarkdownAskDialog(ctx.ui, questions, {
			timeout: timeoutSeconds > 0 ? timeoutSeconds * 1000 : undefined,
			signal,
			cwd: ctx.cwd,
			notify: message => ctx.ui.notify(message, "warning"),
			autocomplete,
			fileCommands: await loadFileCommandNames(ctx.cwd),
			askBtw: pickerBtwRunner(ctx),
		});
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") throw new ToolAbortError("Ask input was cancelled");
		throw error;
	}
	if (!dialogResult) {
		ctx.abort();
		throw new ToolAbortError("Ask tool was cancelled by the user");
	}

	const results: QuestionResult[] = questions.map((question, index) => {
		const answer = dialogResult.results[index];
		// Native details hold one note string per question.
		const note = answer?.notes
			.map(({ option, note, picked }) => `${option}${picked ? "" : " (not picked)"}: ${note}`)
			.join("\n");
		return {
			id: question.id,
			question: question.question,
			options: question.options.map(option => option.label),
			multi: question.multi ?? false,
			selectedOptions: answer?.selectedOptions ?? [],
			customInput: answer?.customInput,
			note: note || undefined,
			timedOut: answer?.timedOut,
		};
	});
	const submitNote = dialogResult.submitNote;
	const text = formatAskAnswers(questions, dialogResult.results, submitNote?.text);
	// Pasted images follow the answer text, each introduced by the label the
	// user's text refers to (`[Image #N]`), plus its file path when pasted from disk.
	const images = [...dialogResult.results.flatMap(answer => answer.images), ...(submitNote?.images ?? [])];
	const imageBlocks: AgentToolResult<FlexibleAskDetails>["content"] = images.flatMap(({ label, image, source }) => [
		{ type: "text" as const, text: source ? `${label} ${source}` : label },
		image,
	]);
	const [single] = results;
	if (results.length === 1 && single) {
		// An empty multi-select submission is a valid "select none" answer;
		// only an empty single-select counts as cancellation.
		if (!single.timedOut && !single.multi && single.selectedOptions.length === 0 && single.customInput === undefined) {
			ctx.abort();
			throw new ToolAbortError("Ask tool was cancelled by the user");
		}
		const details: FlexibleAskDetails = {
			question: single.question,
			options: single.options,
			multi: single.multi,
			selectedOptions: single.selectedOptions,
			customInput: single.customInput,
			note: single.note,
			timedOut: single.timedOut,
			submitNote: submitNote?.text,
		};
		return { content: [{ type: "text", text }, ...imageBlocks], details };
	}
	return { content: [{ type: "text", text }, ...imageBlocks], details: { results, submitNote: submitNote?.text } };
}

export default function flexibleAsk(pi: ExtensionAPI) {
	const type = pi.arktype;
	const parameters = type({
		questions: type({
			id: "string",
			question: "string",
			"header?": "string",
			options: type({
				label: "string",
				"description?": "string",
				"preview?": "string",
			}).array(),
			"multi?": "boolean",
			"recommended?": "number",
		})
			.array()
			.atLeastLength(1),
	});

	// Borrow the main prompt's suggestion provider for the answer editor. omp
	// calls this factory with the current provider every time it rebuilds it
	// (commands, templates, other extensions), so the copy stays fresh. Register
	// once per load; session switches emit session_start again.
	let hostAutocomplete: AutocompleteProvider | undefined;
	let autocompleteRegistered = false;
	pi.on("session_start", (_event, ctx) => {
		if (autocompleteRegistered || ctx.mode !== "tui" || !ctx.hasUI) return;
		autocompleteRegistered = true;
		ctx.ui.addAutocompleteProvider(provider => {
			hostAutocomplete = provider;
			return provider;
		});
	});

	const definition: ToolDefinition<typeof parameters, FlexibleAskDetails> = {
		name: "ask",
		label: "Ask",
		description: flexibleAskDescription.trimEnd(),
		parameters,
		// Native ask is read-tier; omitted defaults to exec and would
		// re-prompt/deny differently. Keep the tier.
		approval: "read",
		// Tern draws the card with native ask's views, so it reads the same as a native ask.
		describeCall: args => withPlainTarget(askToolRenderer.describeCall(args)),
		describeResult: (result, _options, args) => describeAskResult(result, args),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (!ctx.invokeTool) throw new Error("Native ask tool unavailable for delegation");
			const questions = sanitizeQuestions(params.questions);
			if (ctx.mode !== "tui" || !ctx.hasUI || nativeRejects(questions)) {
				return ctx.invokeTool<AskToolDetails>(params, { signal, onUpdate });
			}
			return askWithMarkdownDialog(ctx, questions, signal, () => hostAutocomplete);
		},
	};
	// `concurrency` and `mergeCallAndResult` are not part of the extension
	// ToolDefinition type, but RegisteredToolAdapter forwards definition keys.
	// Native ask runs alone in its batch; two concurrent pickers would steal
	// each other's editor slot. Its result card replaces the call card.
	pi.registerTool(Object.assign(definition, { concurrency: "exclusive" as const, mergeCallAndResult: true }));
}
