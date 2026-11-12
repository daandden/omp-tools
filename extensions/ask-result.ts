// The model sees only the content, never details, so every channel is labeled there.
import type { AgentToolResult, AskToolDetails } from "@oh-my-pi/pi-coding-agent";
import type { OptionNote } from "@oh-my-pi/pi-tui/html-form/data";
import {
	type AskFormAnswer,
	type AskNote,
	type AskOtherAnswer,
	answerImages,
	imageContent,
	otherAnswers,
} from "./ask-form";

export interface AskResultDetails extends AskToolDetails {
	unpickedNotes?: OptionNote[];
	other?: AskOtherAnswer[];
	submitNote?: string;
}

function optionNote({ name, question, option, value, text }: AskNote): OptionNote {
	return { name, question, option, value, text };
}

/** `label: text`, or `label:` then indented lines when the text spans several lines. */
function labeledBlock(indent: string, label: string, text: string): string[] {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	if (lines.length === 1) return [`${indent}${label}: ${lines[0]}`];
	return [`${indent}${label}:`, ...lines.map(line => `${indent}  ${line}`)];
}

export function formatAskAnswer(answer: AskFormAnswer): string {
	const lines = [
		answer.timedOut
			? "No answer before the timeout; submitted the form's current values automatically (not the user's choice; not validated, so required fields may be empty and values may break their bounds or pattern):"
			: "User answers:",
		JSON.stringify(answer.data, null, 2),
	];
	const notes = answer.questions.flatMap(question => question.notes);
	if (notes.length > 0) {
		lines.push("Option notes:");
		for (const note of notes) {
			const picked = note.picked ? "" : " (not picked)";
			const label = `- ${note.question}: ${note.option} [${note.name}=${JSON.stringify(note.value)}]${picked}`;
			lines.push(...labeledBlock("", label, note.text));
		}
	}
	const other = otherAnswers(answer);
	if (other.length > 0) {
		lines.push("Other answers (typed by the user, not a listed option):");
		for (const item of other) lines.push(...labeledBlock("", `- ${item.question} [${item.name}]`, item.text));
	}
	if (answer.submitNote) lines.push(...labeledBlock("", "Note on all answers", answer.submitNote.text));
	return lines.join("\n");
}

export function askToolResult(answer: AskFormAnswer): AgentToolResult<AskResultDetails> {
	const notes = answer.questions.flatMap(question => question.notes);
	const picked = notes.filter(note => note.picked).map(optionNote);
	const unpicked = notes.filter(note => !note.picked).map(optionNote);
	const other = otherAnswers(answer);
	const details: AskResultDetails = {
		answers: answer.questions.map(({ name, question, answer: text }) => ({ name, question, answer: text })),
		...(picked.length > 0 ? { notes: picked } : {}),
		...(unpicked.length > 0 ? { unpickedNotes: unpicked } : {}),
		...(other.length > 0 ? { other } : {}),
		...(answer.submitNote ? { submitNote: answer.submitNote.text } : {}),
		...(answer.timedOut ? { timedOut: true } : {}),
	};
	return {
		content: [{ type: "text", text: formatAskAnswer(answer) }, ...imageContent(answerImages(answer))],
		details,
	};
}
