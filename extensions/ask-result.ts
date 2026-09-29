// Model-facing text for answers from the Markdown ask picker. The model sees
// only this text (result `details` never reach it), so every part is labeled,
// compactly: picked options (with a short description, which otherwise lives
// only in the model's own tool call), `Other` text, notes and the option they
// are attached to, and unanswered questions.
import type { ExtensionAskDialogQuestion } from "@oh-my-pi/pi-coding-agent";
import type { MarkdownAskResultItem } from "./ask-dialog";

/** Longest question title repeated in the result; the full text is in the tool call. */
const MAX_TITLE_LENGTH = 100;
/** Longest option description repeated next to a picked option. */
const MAX_DESCRIPTION_LENGTH = 80;

function flatten(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function clip(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** First non-empty line of the question, without a Markdown heading marker. */
function questionTitle(question: string): string {
	const line = question.split("\n").find(candidate => candidate.trim() !== "") ?? "";
	return clip(flatten(line.replace(/^\s*#{1,6}\s+/, "")), MAX_TITLE_LENGTH);
}

/** `label (description)`, the description clipped to its first sentence and a length cap. */
function optionText(question: ExtensionAskDialogQuestion, label: string): string {
	const description = flatten(question.options.find(option => option.label === label)?.description ?? "");
	if (!description) return label;
	const firstSentence = description.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? description;
	return `${label} (${clip(firstSentence.replace(/[.!?]$/, ""), MAX_DESCRIPTION_LENGTH)})`;
}

/** `label: text`, or `label:` then indented lines when the text spans several lines. */
function labeledBlock(indent: string, label: string, text: string): string[] {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	if (lines.length === 1) return [`${indent}${label}: ${lines[0]}`];
	return [`${indent}${label}:`, ...lines.map(line => `${indent}  ${line}`)];
}

function isAnswered(answer: MarkdownAskResultItem | undefined): boolean {
	return (answer?.selectedOptions.length ?? 0) > 0 || answer?.customInput !== undefined;
}

function answerLines(question: ExtensionAskDialogQuestion, answer: MarkdownAskResultItem | undefined, indent: string): string[] {
	const lines: string[] = [];
	const selected = answer?.selectedOptions ?? [];
	if (selected.length > 0) {
		const label = answer?.timedOut ? "Selected (auto, timed out)" : "Selected";
		lines.push(`${indent}${label}: ${selected.map(option => optionText(question, option)).join(", ")}`);
	}
	if (answer?.customInput !== undefined) lines.push(...labeledBlock(indent, "Other", answer.customInput));
	if (answer?.note) {
		lines.push(...labeledBlock(indent, `Note (${answer.noteFor ?? "Other"})`, answer.note));
	}
	if (lines.length === 0) lines.push(`${indent}Unanswered`);
	return lines;
}

/** Labeled result text for every question, in order. */
export function formatAskAnswers(
	questions: readonly ExtensionAskDialogQuestion[],
	answers: readonly MarkdownAskResultItem[],
): string {
	if (questions.length === 1) {
		const [question] = questions;
		return question ? ["User's answer:", ...answerLines(question, answers[0], "")].join("\n") : "";
	}
	const answered = questions.filter((_, index) => isAnswered(answers[index])).length;
	const lines = [`User answered ${answered}/${questions.length}:`];
	questions.forEach((question, index) => {
		lines.push(`- ${question.id}: ${questionTitle(question.question)}${question.multi ? " [multi]" : ""}`);
		lines.push(...answerLines(question, answers[index], "  "));
	});
	return lines.join("\n");
}
