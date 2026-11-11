import type {
	ExtensionAskDialogQuestion,
	ExtensionAskDialogResult,
	ExtensionAskDialogResultItem,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
} from "@oh-my-pi/pi-coding-agent";
import { isRecord } from "@oh-my-pi/pi-utils";
import { OTHER_OPTION } from "./ask-dialog";
import { type AnswerText, type AskImage, type AskNote, hostQuestionsForm, type QuestionAnswer } from "./ask-form";
import { openPicker, type PickerSession } from "./picker-draft";

/** Native reserved action rows; option labels must disambiguate against them. */
const RESERVED_LABELS = [OTHER_OPTION, "Chat about this", "Next →"];

/** Questions native askDialog rejects: duplicate ids, or reserved or duplicate option labels. */
function nativeRejects(questions: readonly ExtensionAskDialogQuestion[]): boolean {
	const ids = new Set<string>();
	for (const question of questions) {
		if (ids.has(question.id)) return true;
		ids.add(question.id);
		const labels = new Set<string>();
		for (const option of question.options) {
			if (RESERVED_LABELS.includes(option.label) || labels.has(option.label)) return true;
			labels.add(option.label);
		}
	}
	return false;
}

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

/** The note text native askDialog holds for one question: every note, each after its option. */
function joinNotes(notes: readonly AskNote[]): string | undefined {
	const text = notes.map(({ option, text, picked }) => `${option}${picked ? "" : " (not picked)"}: ${text}`).join("\n");
	return text || undefined;
}

function hostAnswer(
	asked: ExtensionAskDialogQuestion,
	answer: QuestionAnswer | undefined,
	submitNote: AnswerText | undefined,
	timedOut: boolean,
): ExtensionAskDialogResultItem {
	const notes = [joinNotes(answer?.notes ?? []), submitNote && `Submit note: ${submitNote.text}`].filter(
		note => note !== undefined,
	);
	const images = answer?.images ?? [];
	const inAnswer = (image: AskImage) => answer?.other?.text.includes(image.label) === true;
	const customInputImages = images.filter(inAnswer).map(item => item.image);
	const noteImages = [...images.filter(image => !inAnswer(image)), ...(submitNote?.images ?? [])].map(
		item => item.image,
	);
	const labels = asked.options.map(option => option.label);
	let selectedOptions = (answer?.picked ?? []).flatMap(index => (labels[index] === undefined ? [] : [labels[index]]));
	// The host dialog's own timeout picks the recommended option of each unanswered question.
	const autoPicked = timedOut && selectedOptions.length === 0 && !answer?.other;
	if (autoPicked) {
		const fallback = labels[Math.min(Math.max(asked.recommended ?? 0, 0), Math.max(labels.length - 1, 0))];
		selectedOptions = fallback === undefined ? [] : [fallback];
	}
	return {
		id: asked.id,
		question: asked.question,
		options: labels,
		multi: asked.multi ?? false,
		selectedOptions,
		...(answer?.other ? { customInput: answer.other.text } : {}),
		...(customInputImages.length > 0 ? { customInputImages } : {}),
		...(notes.length > 0 ? { note: notes.join("\n") } : {}),
		...(noteImages.length > 0 ? { noteImages } : {}),
		...(autoPicked ? { timedOut: true } : {}),
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
	if (!wellFormed(questions) || nativeRejects(questions)) return host.native(questions, options);
	let result: Awaited<ReturnType<typeof openPicker>>;
	try {
		result = await openPicker(host.ui, hostQuestionsForm(questions), session, {
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
	const { answer } = result;
	const last = questions.length - 1;
	return {
		kind: "submit",
		results: questions.map((question, index) =>
			hostAnswer(question, answer.questions[index], index === last ? answer.submitNote : undefined, answer.timedOut),
		),
	};
}
