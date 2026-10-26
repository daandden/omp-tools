import type { ExtensionAskDialogQuestion } from "@oh-my-pi/pi-coding-agent";
import { sanitizeCarriageReturns } from "@oh-my-pi/pi-tui/render";

export const OTHER_OPTION = "Other (type your own)";
/** Native reserved action rows; option labels must disambiguate against them. */
export const RESERVED_LABELS = [OTHER_OPTION, "Chat about this", "Next →"];

export function sanitizeQuestions(questions: readonly ExtensionAskDialogQuestion[]): ExtensionAskDialogQuestion[] {
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

export function nativeRejects(questions: readonly ExtensionAskDialogQuestion[]): boolean {
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
