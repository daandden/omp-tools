// Decides which new advisor concerns repeat a concern the agent was already
// woken for in this prompt cycle. The agent's answer to the earlier concern is
// already in its context, so waking it again for the same issue only restarts
// the advisor/agent argument.
//
// The primary check is one OMP judge call (TypeSafe Jev through the `judge`
// model role): every new concern is one Choice question over the same state,
// so the shared earlier concerns are billed once. The word-overlap check is
// the fallback when no native judge is configured or the call fails.
import type { ChoiceAnswer, Judge, JudgeOptions } from "@oh-my-pi/pi-ai";

/** Choice label for "no earlier concern raises this issue". */
const NO_MATCH = "none";
/** Share of shared words at or above which the fallback calls a concern a repeat. */
const WORD_OVERLAP_REPEAT = 0.5;

/** For each of `notes`, whether the judge matched it to one of `earlier`. */
export async function judgeRepeats(
	judge: Judge,
	notes: readonly string[],
	earlier: readonly string[],
	options?: JudgeOptions,
): Promise<boolean[]> {
	// "Same issue" alone lets Jev merge concerns of one kind about different
	// items (a missing line `alpha` vs a missing line `bravo`); asking for the
	// same specific problem that one fix resolves keeps those apart.
	const criteria: Record<string, string> = {};
	earlier.forEach((_, i) => {
		criteria[`c${i}`] = `\`earlier_concerns.c${i}\` points out the same specific problem`;
	});
	criteria[NO_MATCH] = "No earlier concern points out the same specific problem; fixing them would take different changes";
	const questions = Object.fromEntries(
		notes.map((_, i) => [
			`n${i}`,
			{
				type: "choice" as const,
				instructions: `Which concern in \`earlier_concerns\` points out the same specific problem as \`new_concerns.n${i}\`, so that one fix resolves both?`,
				criteria,
			},
		]),
	);
	const state = {
		earlier_concerns: Object.fromEntries(earlier.map((text, i) => [`c${i}`, text])),
		new_concerns: Object.fromEntries(notes.map((text, i) => [`n${i}`, text])),
	};
	const { answers } = await judge.judge({ state, questions }, options);
	return notes.map((_, i) => {
		const answer = answers[`n${i}`] as ChoiceAnswer | undefined;
		return answer?.type === "choice" && answer.choice !== NO_MATCH;
	});
}

/** Lower-case words, folded the way core's `normalizeAdvisorNote` folds notes. */
function words(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.normalize("NFKC")
			.split(/[^\p{L}\p{N}]+/u)
			.filter(Boolean),
	);
}

/** For each of `notes`, whether it shares at least half its words (Jaccard) with one of `earlier`. */
export function wordOverlapRepeats(notes: readonly string[], earlier: readonly string[]): boolean[] {
	const prior = earlier.map(words);
	return notes.map(note => {
		const current = words(note);
		return prior.some(other => {
			let shared = 0;
			for (const word of current) if (other.has(word)) shared++;
			const union = current.size + other.size - shared;
			return union > 0 && shared / union >= WORD_OVERLAP_REPEAT;
		});
	});
}
