// The one place `ask` interprets a form: it reads the native HTML form model
// (the host's own `html-form` parser and data rules), names the form for
// Picker drafts, holds the rich answer state (picks, Other answers, Notes,
// typed text, images), validates a manual Submit, and serializes the answer as native
// form data plus the Picker's extra channels. The Picker, the host askDialog
// adapter, and the result builder all go through it.
import type { ImageContent } from "@oh-my-pi/pi-ai";
import type { ExtensionAskDialogQuestion } from "@oh-my-pi/pi-coding-agent";
import {
	choiceValue,
	fieldError,
	fieldQuestions,
	type HtmlFormData,
	type HtmlFormValue,
	OTHER_LABEL,
	textValue,
} from "@oh-my-pi/pi-tui/html-form/data";
import {
	type ChoiceField,
	type FormBlock,
	type FormField,
	type FormSpan,
	type HtmlForm,
	parseHtmlForm,
	spansText,
} from "@oh-my-pi/pi-tui/html-form/parse";
import { sanitizeCarriageReturns } from "@oh-my-pi/pi-tui/render";
import type { PastedImage } from "./ask-images";

export type { FormSpan } from "@oh-my-pi/pi-tui/html-form/parse";

/** An image pasted into an Other answer, a Note, a text field, or the Submit note, referenced by `label` in its text. */
export interface AskImage extends PastedImage {
	label: string;
}

/** Text the user wrote in a Picker editor, with the images its labels refer to. */
export interface AnswerText {
	text: string;
	images: AskImage[];
}

/** A picture shown with a question, for display only. */
export type AskPicture = Extract<FormBlock, { kind: "image" | "svg" }>;

/** Part of a question's body: Markdown text or a picture, in form order. */
export type AskContext = { kind: "markdown"; text: string } | AskPicture;

export interface AskOption {
	label: FormSpan[];
	/** Markdown under the label (host questions only). */
	description?: string;
	/** Markdown preview block (host questions only). */
	preview?: string;
	disabled: boolean;
	/** The host question's recommended option (host questions only). */
	recommended: boolean;
}

/** One question of the Picker: a native field and what the Picker shows with it. */
export interface AskQuestion {
	/**
	 * The native field. A choice: name, grouping, `multi`, `select`, `other`,
	 * `required`, option values. A text field: `type`, `multiline`, prefill,
	 * placeholder, and the rules a manual Submit checks.
	 */
	field: FormField;
	/** The question as one line of plain text, as native names it in answers and notes. */
	question: string;
	/** The tab label. */
	tab: string;
	/** A heading over the question (a fieldset legend or a host header). */
	title: string;
	/** What the question shows above its options. */
	context: AskContext[];
	/** The choice's options; none for a text field. */
	options: AskOption[];
}

/** A form as the Picker asks it. */
export interface AskForm {
	/** Equal for forms the Picker shows and answers the same way; Picker drafts match on it. */
	key: string;
	questions: AskQuestion[];
	/** `<input type="hidden">` pairs, submitted as they are. */
	hidden: [name: string, value: string][];
}

/** The answer state of one question. */
export interface AnswerState {
	/** Checked option indices. */
	checked: Set<number>;
	/** The Other answer; kept when Other is unpicked. */
	other: AnswerText | undefined;
	otherPicked: boolean;
	/** Notes by option index, kept whether or not the option is picked. */
	notes: Map<number, AnswerText>;
	/** A text field's text; it opens with the prefill. */
	text: AnswerText | undefined;
}

/** A Note on one option, picked or not. */
export interface AskNote {
	name: string;
	question: string;
	/** The option's label as plain text. */
	option: string;
	/** The option's submitted value. */
	value: string;
	text: string;
	picked: boolean;
}

/** An Other answer the user typed, kept apart from option values it may equal. */
export interface AskOtherAnswer {
	name: string;
	question: string;
	text: string;
}

/** One question's answer. */
export interface QuestionAnswer {
	name: string;
	question: string;
	/** The value native form data holds for this question; undefined when it holds none. */
	value: HtmlFormValue | undefined;
	/** Indices of the picked options, in option order. */
	picked: number[];
	/** The answer as text: picked option labels, then `Other: text`. */
	answer: string;
	/** The picked Other answer. */
	other: AnswerText | undefined;
	notes: AskNote[];
	/** Images of the Other answer, then of the Notes. */
	images: AskImage[];
}

/** A submitted Picker: native form data plus the Picker's extra channels. */
export interface AskFormAnswer {
	data: HtmlFormData;
	questions: QuestionAnswer[];
	submitNote: AnswerText | undefined;
	/** The deadline submitted the current answers; not the user's choice. */
	timedOut: boolean;
}

/** The outcome of reading an `ask` form. */
export type ReadForm =
	| { kind: "form"; form: AskForm }
	/** No named control: native ask answers this with its own error. */
	| { kind: "empty" };

/** Inline style to Markdown delimiters. */
const MARKDOWN_STYLE = { strong: "**", em: "*" } as const;

/**
 * Escape what Markdown would read as markup in model-written text. Only `]`
 * of the brackets: it alone breaks a link or image, and pi-tui's Markdown
 * drops an escaped `[`.
 */
function escapeMarkdown(text: string): string {
	return text
		.replace(/[\\`*_\]<>|~#]/g, "\\$&")
		.replace(/^(\s*)([-+=]|\d+[.)])(?=\s|$)/gm, (_, space: string, marker: string) =>
			marker.length === 1 ? `${space}\\${marker}` : `${space}${marker.slice(0, -1)}\\${marker.slice(-1)}`,
		);
}

/** Inline code with a fence longer than any backtick run inside it. */
function inlineCode(text: string): string {
	const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map(run => run[0].length));
	const fence = "`".repeat(longest + 1);
	const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
	return `${fence}${pad}${text}${pad}${fence}`;
}

/** Spans as inline Markdown; a hard break (`<br>`) stays a line break. */
function spansMarkdown(spans: readonly FormSpan[]): string {
	return spans
		.map(span => {
			if (span.style === "code") return inlineCode(span.text);
			const escaped = escapeMarkdown(span.text).replace(/\n/g, "\\\n");
			if (!span.style) return escaped;
			const mark = MARKDOWN_STYLE[span.style];
			const match = /^(\s*)(.*?)(\s*)$/s.exec(escaped);
			const [, lead = "", body = "", trail = ""] = match ?? [];
			return body ? `${lead}${mark}${body}${mark}${trail}` : escaped;
		})
		.join("");
}

function tableCell(spans: readonly FormSpan[]): string {
	return spansMarkdown(spans).replace(/\\\n/g, " ");
}

/** A context block as Markdown. */
function blockMarkdown(block: Exclude<FormBlock, { kind: "field" | "image" | "svg" }>): string {
	switch (block.kind) {
		case "text":
			return block.heading ? `### ${spansMarkdown(block.spans)}` : spansMarkdown(block.spans);
		case "list":
			return block.items
				.map((item, index) => `${block.ordered ? `${index + 1}.` : "-"} ${spansMarkdown(item)}`)
				.join("\n");
		case "pre": {
			const longest = Math.max(2, ...[...block.text.matchAll(/`+/g)].map(run => run[0].length));
			const fence = "`".repeat(longest + 1);
			return `${fence}\n${block.text}\n${fence}`;
		}
		case "table": {
			const width = Math.max(1, ...block.rows.map(row => row.length));
			const line = (row: readonly FormSpan[][]) =>
				`| ${Array.from({ length: width }, (_, column) => tableCell(row[column] ?? [])).join(" | ")} |`;
			const [head = [], ...body] = block.rows;
			return [line(head), `|${" --- |".repeat(width)}`, ...body.map(line)].join("\n");
		}
	}
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Context runs: consecutive Markdown blocks joined, pictures on their own. */
function contextOf(blocks: readonly FormBlock[]): AskContext[] {
	const context: AskContext[] = [];
	for (const block of blocks) {
		if (block.kind === "field") continue;
		if (block.kind === "image" || block.kind === "svg") {
			context.push(block);
			continue;
		}
		const text = blockMarkdown(block);
		const last = context.at(-1);
		if (last?.kind === "markdown") last.text += `\n\n${text}`;
		else context.push({ kind: "markdown", text });
	}
	return context;
}

/**
 * Read an `ask` form. Each named radio group, checkbox group, select, text
 * input, and textarea is a question; the context before it (and, for the last
 * one, after it) is shown with it.
 */
export function readHtmlForm(html: string): ReadForm {
	const parsed = parseHtmlForm(html);
	if (!parsed.fields.some(field => field.name)) return { kind: "empty" };
	return { kind: "form", form: { key: formKey(parsed), questions: htmlQuestions(parsed), hidden: parsed.hidden } };
}

/** What the Picker shows and submits, without layout whitespace: the parser already dropped it. */
function formKey(form: HtmlForm): string {
	return JSON.stringify(["html", form.sections, form.hidden]);
}

function htmlQuestions(form: HtmlForm): AskQuestion[] {
	const questions = fieldQuestions(form);
	const asked: AskQuestion[] = [];
	let pending: FormBlock[] = [];
	for (const section of form.sections) {
		const title = oneLine(spansText(section.title));
		const fields = section.blocks.filter(
			(block): block is Extract<FormBlock, { kind: "field" }> => block.kind === "field" && block.field.name !== "",
		);
		let first = true;
		for (const block of section.blocks) {
			if (block.kind !== "field" || !block.field.name) {
				if (block.kind !== "field") pending.push(block);
				continue;
			}
			const field = block.field;
			const question = questions.get(field) ?? field.name;
			const blocks = first && fields.length > 1 && title ? [titleBlock(section.title), ...pending] : pending;
			const own = spansText(field.label) ? [{ kind: "text" as const, spans: field.label, heading: false }] : [];
			let context = contextOf([...blocks, ...own]);
			if (!context.some(part => part.kind === "markdown")) {
				context = [{ kind: "markdown", text: escapeMarkdown(question) }, ...context];
			}
			asked.push({
				field,
				question,
				tab: fields.length === 1 && title ? title : field.name,
				title: fields.length === 1 ? title : "",
				context,
				options:
					field.kind === "choice"
						? field.options.map(option => ({
								label: option.label.length > 0 ? option.label : [{ text: option.value }],
								disabled: option.disabled,
								recommended: false,
							}))
						: [],
			});
			pending = [];
			first = false;
		}
	}
	const last = asked.at(-1);
	if (last && pending.length > 0) last.context.push(...contextOf(pending));
	return asked;
}

function titleBlock(title: FormSpan[]): FormBlock {
	return { kind: "text", spans: title, heading: true };
}

/** A host question's label as spans: backtick runs are inline code, as the host draws them. */
function labelSpans(label: string): FormSpan[] {
	return label.split(/(`[^`]+`)/).flatMap((piece): FormSpan[] => {
		if (piece === "") return [];
		if (piece.length > 2 && piece.startsWith("`") && piece.endsWith("`")) return [{ text: piece.slice(1, -1), style: "code" }];
		return [{ text: piece }];
	});
}

/**
 * Host askDialog questions as a Picker form. Each is a native choice field
 * named by its id whose option values are its labels, with Other, as the
 * host dialog offers.
 */
export function hostQuestionsForm(questions: readonly ExtensionAskDialogQuestion[]): AskForm {
	const asked = questions.map((question, index): AskQuestion => {
		const field: ChoiceField = {
			kind: "choice",
			name: question.id,
			multi: question.multi ?? false,
			select: false,
			other: true,
			label: [],
			options: question.options.map(option => ({
				value: option.label,
				label: [{ text: option.label }],
				checked: false,
				disabled: false,
			})),
			required: false,
		};
		const header = question.header?.trim() ?? "";
		return {
			field,
			question: question.question,
			tab: header || question.id || `Q${index + 1}`,
			title: header,
			context: [{ kind: "markdown", text: question.question }],
			options: question.options.map((option, optionIndex) => ({
				label: labelSpans(sanitizeCarriageReturns(option.label)),
				...(option.description?.trim() ? { description: option.description.trim() } : {}),
				...(option.preview?.trim() ? { preview: option.preview } : {}),
				disabled: false,
				recommended: question.recommended === optionIndex,
			})),
		};
	});
	const key = JSON.stringify([
		"host",
		questions.map(question => [question.id, question.question, question.options.map(option => option.label), question.multi ?? false]),
	]);
	return { key, questions: asked, hidden: [] };
}

/** An option's label as plain text. */
export function optionText(question: AskQuestion, index: number): string {
	const option = question.options[index];
	return option ? oneLine(spansText(option.label)) : "";
}

/** A fresh answer state: the form's checked options, the last checked radio winning as in a browser, or a text field's prefill. */
export function initialAnswer(question: AskQuestion): AnswerState {
	const field = question.field;
	const checked = new Set<number>();
	if (field.kind === "text") {
		const text = field.value ? { text: field.value, images: [] } : undefined;
		return { checked, other: undefined, otherPicked: false, notes: new Map(), text };
	}
	field.options.forEach((option, index) => {
		if (!option.checked) return;
		if (!field.multi) checked.clear();
		checked.add(index);
	});
	return { checked, other: undefined, otherPicked: false, notes: new Map(), text: undefined };
}

/** The row the cursor starts on: the first checked option, else the recommended one, else the first. */
export function initialCursor(question: AskQuestion, state: AnswerState): number {
	const [checked] = state.checked;
	if (checked !== undefined) return checked;
	const recommended = question.options.findIndex(option => option.recommended);
	return Math.max(0, recommended);
}

/** Pick option `index`; a single choice drops its other pick. Disabled options cannot be picked. */
export function pickOption(question: AskQuestion, state: AnswerState, index: number): boolean {
	if (question.field.kind !== "choice" || question.options[index]?.disabled !== false) return false;
	if (!question.field.multi) {
		state.checked.clear();
		state.otherPicked = false;
	}
	state.checked.add(index);
	return true;
}

/** Unpick option `index`. A single `<select>` always keeps one option, as native does. */
export function unpickOption(question: AskQuestion, state: AnswerState, index: number): boolean {
	if (question.field.kind !== "choice" || (question.field.select && !question.field.multi)) return false;
	return state.checked.delete(index);
}

/** Pick the Other answer; a single choice drops its picked option. */
export function pickOther(question: AskQuestion, state: AnswerState): void {
	if (question.field.kind !== "choice" || !question.field.other) return;
	if (!question.field.multi) state.checked.clear();
	state.otherPicked = true;
}

/** Save the Other answer; text picks it, no text unpicks it. */
export function setOther(question: AskQuestion, state: AnswerState, text: AnswerText | undefined): void {
	state.other = text;
	if (text) pickOther(question, state);
	else state.otherPicked = false;
}

export function setNote(state: AnswerState, index: number, text: AnswerText | undefined): void {
	if (text) state.notes.set(index, text);
	else state.notes.delete(index);
}

/** Save a text field's text; a one-line field drops line breaks, as a browser's input does. */
export function setText(question: AskQuestion, state: AnswerState, text: AnswerText | undefined): void {
	if (question.field.kind !== "text") return;
	if (text && !question.field.multiline) text = { ...text, text: text.text.replace(/\r\n|\r|\n/g, "") };
	state.text = text?.text ? text : undefined;
}

/** The picked Other answer, when it has text. */
function pickedOther(state: AnswerState): AnswerText | undefined {
	return state.otherPicked && state.other?.text.trim() ? state.other : undefined;
}

/** The value native form data holds for the question. */
export function questionValue(question: AskQuestion, state: AnswerState): HtmlFormValue | undefined {
	const field = question.field;
	if (field.kind === "text") return textValue(field, state.text?.text ?? "");
	return choiceValue(field, state.checked, pickedOther(state)?.text);
}

export function isAnswered(question: AskQuestion, state: AnswerState): boolean {
	const value = questionValue(question, state);
	return value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);
}

/** The first question a manual Submit refuses, with native's reason. */
export function firstInvalid(form: AskForm, states: readonly AnswerState[]): { index: number; error: string } | undefined {
	for (let index = 0; index < form.questions.length; index++) {
		const question = form.questions[index]!;
		const state = states[index];
		if (!state) continue;
		const error = fieldError(question.field, questionValue(question, state));
		if (error) return { index, error };
	}
	return undefined;
}

/** Picked option labels, then `Other: text`, or a text field's text, as the answer reads. */
export function answerParts(question: AskQuestion, state: AnswerState): string[] {
	if (question.field.kind === "text") {
		const value = questionValue(question, state);
		return value === undefined || value === "" ? [] : [String(value)];
	}
	const parts = question.field.options.flatMap((option, index) =>
		state.checked.has(index) && !option.disabled ? [optionText(question, index)] : [],
	);
	const other = pickedOther(state);
	if (other) parts.push(`${OTHER_LABEL}: ${oneLine(other.text)}`);
	return parts;
}

/** Every Note on the question, in option order, picked or not. */
function questionNotes(question: AskQuestion, state: AnswerState): AskNote[] {
	if (question.field.kind !== "choice") return [];
	return question.field.options.flatMap((option, index) => {
		const note = state.notes.get(index);
		if (!note) return [];
		return [
			{
				name: question.field.name,
				question: question.question,
				option: optionText(question, index),
				value: option.value,
				text: note.text,
				picked: state.checked.has(index),
			},
		];
	});
}

/** The answer as it stands: what Submit, a timeout, and the Picker btw see. */
export function formAnswer(
	form: AskForm,
	states: readonly AnswerState[],
	submitNote: AnswerText | undefined,
	timedOut: boolean,
): AskFormAnswer {
	const data: HtmlFormData = {};
	for (const [name, value] of form.hidden) data[name] = value;
	const questions = form.questions.map((question, index): QuestionAnswer => {
		const state = states[index] ?? initialAnswer(question);
		const value = questionValue(question, state);
		if (value !== undefined && question.field.name) data[question.field.name] = value;
		const field = question.field;
		const other = pickedOther(state);
		return {
			name: field.name,
			question: question.question,
			value,
			picked:
				field.kind === "choice"
					? field.options.flatMap((option, optionIndex) => (state.checked.has(optionIndex) && !option.disabled ? [optionIndex] : []))
					: [],
			answer: answerParts(question, state).join(", "),
			other,
			notes: questionNotes(question, state),
			images: [
				...(field.kind === "text" ? (state.text?.images ?? []) : []),
				...(other?.images ?? []),
				...[...state.notes.values()].flatMap(note => note.images),
			],
		};
	});
	return { data, questions, submitNote, timedOut };
}

/** Picked Other answers, by question. */
export function otherAnswers(answer: AskFormAnswer): AskOtherAnswer[] {
	return answer.questions.flatMap(question =>
		question.other ? [{ name: question.name, question: question.question, text: question.other.text }] : [],
	);
}

/** Every image of the answer, in question order, then the Submit note's. */
export function answerImages(answer: AskFormAnswer): AskImage[] {
	return [...answer.questions.flatMap(question => question.images), ...(answer.submitNote?.images ?? [])];
}

/** Images as content: each introduced by the label its text refers to, and the file it came from. */
export function imageContent(images: readonly AskImage[]): ({ type: "text"; text: string } | ImageContent)[] {
	return images.flatMap(({ label, image, source }) => [{ type: "text" as const, text: source ? `${label} ${source}` : label }, image]);
}
