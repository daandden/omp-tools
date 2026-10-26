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
import type { MarkdownAskResult } from "./ask-dialog";
import { nativeRejects, sanitizeQuestions } from "./ask-questions";
import { formatAskAnswers, joinOptionNotes } from "./ask-result";
import { askInPicker, routeHostAskDialog } from "./host-ask-dialog";
import { pickerBtwRunner } from "./picker-btw";
import { openPicker, PickerDraftSlot, type PickerSession } from "./picker-draft";
import flexibleAskDescription from "./flexible-ask.md" with { type: "text" };

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
	session: PickerSession,
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

	let picked: MarkdownAskResult | undefined;
	try {
		picked = await openPicker(ctx.ui, questions, session, {
			timeout: timeoutSeconds > 0 ? timeoutSeconds * 1000 : undefined,
			signal,
			notify: message => ctx.ui.notify(message, "warning"),
		});
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") throw new ToolAbortError("Ask input was cancelled");
		throw error;
	}
	if (!picked) {
		ctx.abort();
		throw new ToolAbortError("Ask tool was cancelled by the user");
	}
	const dialogResult = picked;

	const results: QuestionResult[] = questions.map((question, index) => {
		const answer = dialogResult.results[index];
		const note = joinOptionNotes(answer?.notes ?? []);
		return {
			id: question.id,
			question: question.question,
			options: question.options.map(option => option.label),
			multi: question.multi ?? false,
			selectedOptions: answer?.selectedOptions ?? [],
			customInput: answer?.customInput,
			note,
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

	const drafts = new PickerDraftSlot();
	const dropDraft = () => drafts.drop();
	pi.on("session_before_switch", dropDraft);
	pi.on("session_before_branch", dropDraft);
	pi.on("session_tree", dropDraft);

	// Borrow the main prompt's suggestion provider for the answer editor. omp
	// calls this factory with the current provider every time it rebuilds it
	// (commands, templates, other extensions), so the copy stays fresh.
	let hostAutocomplete: AutocompleteProvider | undefined;
	let autocompleteRegistered = false;
	let hostCtx: ExtensionContext | undefined;
	let endHostRoute: (() => void) | undefined;
	const pickerSession = (ctx: ExtensionContext): PickerSession => ({
		cwd: ctx.cwd,
		drafts,
		btw: () => pickerBtwRunner(ctx),
		autocomplete: () => hostAutocomplete,
		fileCommands: () => loadFileCommandNames(ctx.cwd),
	});
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		if (!autocompleteRegistered) {
			autocompleteRegistered = true;
			ctx.ui.addAutocompleteProvider(provider => {
				hostAutocomplete = provider;
				return provider;
			});
		}
		if (endHostRoute) return;
		hostCtx = ctx;
		endHostRoute = routeHostAskDialog(ctx.ui, (questions, options, host) =>
			askInPicker(questions, options, host, pickerSession(hostCtx ?? ctx)),
		);
	});
	const followSession = (_event: unknown, ctx: ExtensionContext) => {
		if (endHostRoute) hostCtx = ctx;
	};
	pi.on("session_switch", followSession);
	pi.on("session_branch", followSession);
	pi.on("session_shutdown", () => {
		endHostRoute?.();
		endHostRoute = undefined;
		return drafts.drop();
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
			return askWithMarkdownDialog(ctx, questions, signal, pickerSession(ctx));
		},
	};
	// `concurrency` and `mergeCallAndResult` are not part of the extension
	// ToolDefinition type, but RegisteredToolAdapter forwards definition keys.
	// Native ask runs alone in its batch; two concurrent pickers would steal
	// each other's editor slot. Its result card replaces the call card.
	pi.registerTool(Object.assign(definition, { concurrency: "exclusive" as const, mergeCallAndResult: true }));
}
