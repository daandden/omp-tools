import type {
	ExtensionAskDialogQuestion,
	ExtensionAskDialogResult,
	ExtensionAskDialogResultItem,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
} from "@oh-my-pi/pi-coding-agent";
import { isRecord } from "@oh-my-pi/pi-utils";
import type { AskImage, MarkdownAskResult, MarkdownAskResultItem, SubmitNote } from "./ask-dialog";
import { nativeRejects, sanitizeQuestions } from "./ask-questions";
import { joinOptionNotes } from "./ask-result";
import { openPicker, type PickerSession } from "./picker-draft";

type AskDialog = NonNullable<ExtensionUIContext["askDialog"]>;

export interface HostDialogs {
	native: AskDialog;
	ui: Pick<ExtensionUIContext, "custom" | "notify">;
}

export type HostAskDialog = (
	questions: ExtensionAskDialogQuestion[],
	options: ExtensionUIDialogOptions | undefined,
	host: HostDialogs,
) => Promise<ExtensionAskDialogResult | undefined>;

/** The value of `ui`'s own property, past a proxy's `get` (a proxy without a descriptor trap forwards it). */
function ownValue(ui: object, key: PropertyKey): unknown {
	return Object.getOwnPropertyDescriptor(ui, key)?.value;
}

const ROUTES = Symbol.for("omp-tools.host-ask-dialog");

interface Routes {
	host: HostDialogs;
	opens: HostAskDialog[];
}

/**
 * Route `ui.askDialog` through `open`; returns the function that ends the route. `ui` holds one wrapper
 * however many routes there are, and gets its own dialog back when the last one ends.
 */
export function routeHostAskDialog(ui: ExtensionUIContext, open: HostAskDialog): () => void {
	let routes = ownValue(ui, ROUTES) as Routes | undefined;
	if (!routes) {
		const native = ownValue(ui, "askDialog");
		const custom = ownValue(ui, "custom");
		const notify = ownValue(ui, "notify");
		if (typeof native !== "function" || typeof custom !== "function" || typeof notify !== "function") return () => {};
		const created: Routes = {
			host: { native: native as AskDialog, ui: { custom, notify } as HostDialogs["ui"] },
			opens: [],
		};
		Object.defineProperty(ui, ROUTES, { value: created, configurable: true });
		ui.askDialog = (questions, options) => {
			const current = created.opens.at(-1);
			return current ? current(questions, options, created.host) : created.host.native(questions, options);
		};
		routes = created;
	}
	const active = routes;
	const route: HostAskDialog = (questions, options, host) => open(questions, options, host);
	active.opens.push(route);
	return () => {
		const index = active.opens.indexOf(route);
		if (index === -1) return;
		active.opens.splice(index, 1);
		if (active.opens.length > 0) return;
		delete (ui as unknown as Record<PropertyKey, unknown>)[ROUTES];
		ui.askDialog = active.host.native;
	};
}

function hostAnswer(
	asked: ExtensionAskDialogQuestion,
	shown: ExtensionAskDialogQuestion,
	answer: MarkdownAskResultItem | undefined,
	submitNote: SubmitNote | undefined,
): ExtensionAskDialogResultItem {
	const notes = [joinOptionNotes(answer?.notes ?? []), submitNote && `Submit note: ${submitNote.text}`].filter(
		note => note !== undefined,
	);
	const images = answer?.images ?? [];
	const inAnswer = (image: AskImage) => answer?.customInput?.includes(image.label) === true;
	const customInputImages = images.filter(inAnswer).map(item => item.image);
	const noteImages = [...images.filter(image => !inAnswer(image)), ...(submitNote?.images ?? [])].map(
		item => item.image,
	);
	const labels = asked.options.map(option => option.label);
	const shownLabels = shown.options.map(option => option.label);
	return {
		id: asked.id,
		question: asked.question,
		options: labels,
		multi: asked.multi ?? false,
		selectedOptions: (answer?.selectedOptions ?? []).map(label => labels[shownLabels.indexOf(label)] ?? label),
		...(answer?.customInput !== undefined ? { customInput: answer.customInput } : {}),
		...(customInputImages.length > 0 ? { customInputImages } : {}),
		...(notes.length > 0 ? { note: notes.join("\n") } : {}),
		...(noteImages.length > 0 ? { noteImages } : {}),
		...(answer?.timedOut ? { timedOut: true } : {}),
	};
}

const optionalString = (value: unknown) => value === undefined || typeof value === "string";

/** Questions the native dialog would have to coerce: it accepts any shape, the picker only this one. */
function wellFormed(questions: unknown): questions is ExtensionAskDialogQuestion[] {
	return (
		Array.isArray(questions) &&
		questions.every(
			question =>
				isRecord(question) &&
				typeof question.id === "string" &&
				typeof question.question === "string" &&
				optionalString(question.header) &&
				Array.isArray(question.options) &&
				question.options.every(
					option =>
						isRecord(option) &&
						typeof option.label === "string" &&
						optionalString(option.description) &&
						optionalString(option.preview),
				),
		)
	);
}

export async function askInPicker(
	questions: ExtensionAskDialogQuestion[],
	options: ExtensionUIDialogOptions | undefined,
	host: HostDialogs,
	session: PickerSession,
): Promise<ExtensionAskDialogResult | undefined> {
	if (!wellFormed(questions)) return host.native(questions, options);
	const shown = sanitizeQuestions(questions);
	if (nativeRejects(shown)) return host.native(questions, options);
	let result: MarkdownAskResult | undefined;
	try {
		result = await openPicker(host.ui, shown, session, {
			timeout: options?.timeout,
			onTimeout: options?.onTimeout,
			signal: options?.signal,
			notify: message => host.ui.notify(message, "warning"),
		});
	} catch (error) {
		// The native dialog closes with no answer when its signal aborts.
		if (options?.signal?.aborted) return undefined;
		throw error;
	}
	if (!result) return undefined;
	const submitted = result;
	const last = shown.length - 1;
	return {
		kind: "submit",
		results: shown.map((question, index) =>
			hostAnswer(questions[index]!, question, submitted.results[index], index === last ? submitted.submitNote : undefined),
		),
	};
}
