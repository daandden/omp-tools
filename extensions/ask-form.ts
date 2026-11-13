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

export interface AskImage extends PastedImage {
	label: string;
}

export interface AnswerText {
	text: string;
	images: AskImage[];
}

export type AskPicture = Extract<FormBlock, { kind: "image" | "svg" }>;

export type AskContext = { kind: "markdown"; text: string } | AskPicture;

export interface AskOption {
	label: FormSpan[];
	description?: string;
	preview?: string;
	disabled: boolean;
	recommended: boolean;
}

export interface AskQuestion {
	field: FormField;
	question: string;
	tab: string;
	title: string;
	context: AskContext[];
	options: AskOption[];
}

export interface AskForm {
	key: string;
	questions: AskQuestion[];
	hidden: [name: string, value: string][];
}

export interface AnswerState {
	checked: Set<number>;
	other: AnswerText | undefined;
	otherPicked: boolean;
	notes: Map<number, AnswerText>;
	text: AnswerText | undefined;
}

export interface AskNote {
	name: string;
	question: string;
	option: string;
	value: string;
	text: string;
	picked: boolean;
}

export interface AskOtherAnswer {
	name: string;
	question: string;
	text: string;
}

export interface QuestionAnswer {
	name: string;
	question: string;
	value: HtmlFormValue | undefined;
	picked: number[];
	answer: string;
	other: AnswerText | undefined;
	notes: AskNote[];
	images: AskImage[];
}

export interface AskFormAnswer {
	data: HtmlFormData;
	questions: QuestionAnswer[];
	submitNote: AnswerText | undefined;
	timedOut: boolean;
}

export type ReadForm =
	| { kind: "form"; form: AskForm }
	| { kind: "empty" };

const MARKDOWN_STYLE = { strong: "**", em: "*" } as const;

function escapeMarkdown(text: string): string {
	return text
		.replace(/[\\`*_\]<>|~#]/g, "\\$&")
		.replace(/^(\s*)([-+=]|\d+[.)])(?=\s|$)/gm, (_, space: string, marker: string) =>
			marker.length === 1 ? `${space}\\${marker}` : `${space}${marker.slice(0, -1)}\\${marker.slice(-1)}`,
		);
}

function inlineCode(text: string): string {
	const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map(run => run[0].length));
	const fence = "`".repeat(longest + 1);
	const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
	return `${fence}${pad}${text}${pad}${fence}`;
}

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

export function readHtmlForm(html: string): ReadForm {
	const parsed = parseHtmlForm(html);
	if (!parsed.fields.some(field => field.name)) return { kind: "empty" };
	return { kind: "form", form: { key: formKey(parsed), questions: htmlQuestions(parsed), hidden: parsed.hidden } };
}

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
								recommended: option.checked,
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

function labelSpans(label: string): FormSpan[] {
	return label.split(/(`[^`]+`)/).flatMap((piece): FormSpan[] => {
		if (piece === "") return [];
		if (piece.length > 2 && piece.startsWith("`") && piece.endsWith("`")) return [{ text: piece.slice(1, -1), style: "code" }];
		return [{ text: piece }];
	});
}

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

export function optionText(question: AskQuestion, index: number): string {
	const option = question.options[index];
	return option ? oneLine(spansText(option.label)) : "";
}

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

export function initialCursor(question: AskQuestion, state: AnswerState): number {
	const [checked] = state.checked;
	if (checked !== undefined) return checked;
	const recommended = question.options.findIndex(option => option.recommended);
	return Math.max(0, recommended);
}

export function pickOption(question: AskQuestion, state: AnswerState, index: number): boolean {
	if (question.field.kind !== "choice" || question.options[index]?.disabled !== false) return false;
	if (!question.field.multi) {
		state.checked.clear();
		state.otherPicked = false;
	}
	state.checked.add(index);
	return true;
}

export function unpickOption(question: AskQuestion, state: AnswerState, index: number): boolean {
	if (question.field.kind !== "choice" || (question.field.select && !question.field.multi)) return false;
	return state.checked.delete(index);
}

export function pickOther(question: AskQuestion, state: AnswerState): void {
	if (question.field.kind !== "choice" || !question.field.other) return;
	if (!question.field.multi) state.checked.clear();
	state.otherPicked = true;
}

export function setOther(question: AskQuestion, state: AnswerState, text: AnswerText | undefined): void {
	state.other = text;
	if (text) pickOther(question, state);
	else state.otherPicked = false;
}

export function setNote(state: AnswerState, index: number, text: AnswerText | undefined): void {
	if (text) state.notes.set(index, text);
	else state.notes.delete(index);
}

export function setText(question: AskQuestion, state: AnswerState, text: AnswerText | undefined): void {
	if (question.field.kind !== "text") return;
	if (text && !question.field.multiline) text = { ...text, text: text.text.replace(/\r\n|\r|\n/g, "") };
	state.text = text?.text ? text : undefined;
}

function pickedOther(state: AnswerState): AnswerText | undefined {
	return state.otherPicked && state.other?.text.trim() ? state.other : undefined;
}

export function questionValue(question: AskQuestion, state: AnswerState): HtmlFormValue | undefined {
	const field = question.field;
	if (field.kind === "text") return textValue(field, state.text?.text ?? "");
	return choiceValue(field, state.checked, pickedOther(state)?.text);
}

export function isAnswered(question: AskQuestion, state: AnswerState): boolean {
	const value = questionValue(question, state);
	return value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);
}

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

export function questionNotes(question: AskQuestion, state: AnswerState): AskNote[] {
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

export function otherAnswers(answer: AskFormAnswer): AskOtherAnswer[] {
	return answer.questions.flatMap(question =>
		question.other ? [{ name: question.name, question: question.question, text: question.other.text }] : [],
	);
}

export function answerImages(answer: AskFormAnswer): AskImage[] {
	return [...answer.questions.flatMap(question => question.images), ...(answer.submitNote?.images ?? [])];
}

export function imageContent(images: readonly AskImage[]): ({ type: "text"; text: string } | ImageContent)[] {
	return images.flatMap(({ label, image, source }) => [{ type: "text" as const, text: source ? `${label} ${source}` : label }, image]);
}
