import type { AgentToolResult, AskToolDetails, ExtensionAPI, ExtensionContext, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { askToolRenderer, discoverSlashCommands, logger, settings } from "@oh-my-pi/pi-coding-agent";
import { cfgAskNotify, cfgAskTimeout } from "@oh-my-pi/pi-coding-agent/modes/settings";
import { ToolAbortError } from "@oh-my-pi/pi-coding-agent/tools/tool-errors";
import { type AutocompleteProvider, span, TERMINAL, text } from "@oh-my-pi/pi-tui";
import type { NativeToolView } from "@oh-my-pi/pi-tui/tools/renderer";
import { type AskForm, readHtmlForm } from "./ask-form";
import { type AskResultDetails, askToolResult } from "./ask-result";
import { askInPicker, routeHostAskDialog } from "./host-ask-dialog";
import { pickerBtwRunner } from "./picker-btw";
import { openPicker, PickerDraftSlot, type PickerSession } from "./picker-draft";
import flexibleAskDescription from "./flexible-ask.md" with { type: "text" };

/** Result views, keyed by `details` so an unchanged card keeps its nodes. */
const resultViews = new WeakMap<AskResultDetails, NativeToolView | undefined>();

function cardDetails(details: AskResultDetails | undefined): AskToolDetails | undefined {
	if (!details) return undefined;
	const unpicked = (details.unpickedNotes ?? []).map(note => ({ ...note, option: `${note.option} (not picked)` }));
	const notes = [...(details.notes ?? []), ...unpicked];
	return {
		answers: details.answers,
		...(notes.length > 0 ? { notes } : {}),
		...(details.timedOut ? { timedOut: true } : {}),
	};
}

/** The native ask card for the result, with the Submit note below the answers. */
function describeAskResult(
	result: AgentToolResult<AskResultDetails>,
	args: { html?: string } | undefined,
): NativeToolView | undefined {
	const details = result.details;
	if (details && resultViews.has(details)) return resultViews.get(details);
	const view = askToolRenderer.describeResult({ content: result.content, details: cardDetails(details) }, undefined, args);
	const note = details?.submitNote;
	const described =
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
	if (details) resultViews.set(details, described);
	return described;
}

function classicDetails(details: AskResultDetails | undefined): AskToolDetails | undefined {
	const card = cardDetails(details);
	const note = details?.submitNote;
	// Results saved before HTML forms have no `answers`; the host renders their saved text.
	if (!card || !note || !Array.isArray(card.answers)) return card;
	return { ...card, answers: [...card.answers, { name: "", question: "Note on all answers", answer: note }] };
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

async function askWithPicker(
	ctx: ExtensionContext,
	form: AskForm,
	signal: AbortSignal | undefined,
	session: PickerSession,
): Promise<AgentToolResult<AskResultDetails>> {
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

	let picked: Awaited<ReturnType<typeof openPicker>>;
	try {
		picked = await openPicker(ctx.ui, form, session, {
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
	return askToolResult(picked.answer);
}

export default function flexibleAsk(pi: ExtensionAPI) {
	const type = pi.arktype;
	const parameters = type({ "+": "reject", html: type("string").describe("one HTML <form>") });

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

	const definition: ToolDefinition<typeof parameters, AskResultDetails> = {
		name: "ask",
		label: "Ask",
		description: flexibleAskDescription.trimEnd(),
		parameters,
		// Native ask is read-tier; omitted defaults to exec and would
		// re-prompt/deny differently. Keep the tier.
		approval: "read",
		describeCall: args => askToolRenderer.describeCall(args),
		describeResult: (result, _options, args) => describeAskResult(result, args),
		renderCall: (args, options, theme) => askToolRenderer.renderCall(args, options, theme),
		renderResult: (result, options, theme, args) =>
			askToolRenderer.renderResult({ content: result.content, details: classicDetails(result.details) }, options, theme, args),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (!ctx.invokeTool) throw new Error("Native ask tool unavailable for delegation");
			if (ctx.mode !== "tui" || !ctx.hasUI) return ctx.invokeTool<AskToolDetails>(params, { signal, onUpdate });
			const read = readHtmlForm(params.html);
			if (read.kind === "empty") return ctx.invokeTool<AskToolDetails>(params, { signal, onUpdate });
			return askWithPicker(ctx, read.form, signal, pickerSession(ctx));
		},
	};
	// `concurrency` and `mergeCallAndResult` are not part of the extension
	// ToolDefinition type, but RegisteredToolAdapter forwards definition keys.
	// Native ask runs alone in its batch; two concurrent pickers would steal
	// each other's editor slot. Its result card replaces the call card.
	pi.registerTool(Object.assign(definition, { concurrency: "exclusive" as const, mergeCallAndResult: true }));
}
