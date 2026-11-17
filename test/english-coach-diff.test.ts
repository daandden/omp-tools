import { expect, test } from "bun:test";
import { coachCorrection } from "../extensions/english-coach-diff";
import { prepareCoachPrompt } from "../extensions/english-coach-prompt";

const mistake = { original: "word", corrected: "Word", pattern: "Capitalization" };

test.each([
	["a short prompt", "it fail in src/first.ts and `call()` at https://x.example/a", (text: string) => text.replace("it fail", "It fails")],
	["a prompt too long for a full diff", `${"word ".repeat(1100)}src/first.ts ${"word ".repeat(1100)}\`call()\``, (text: string) => text.replaceAll("word", "Word")],
])("each protected marker shows once in %s", (_kind, input, correct) => {
	const prompt = prepareCoachPrompt(input, new Set())!;
	const correction = coachCorrection(prompt, correct(prompt.text), [mistake]);
	const shown = correction.lines.flat().filter(part => part.kind === "protected").map(part => part.text);
	expect(shown).toEqual(prompt.placeholders.map(item => item.display.trim()));
	expect(correction.lines.flat().some(part => part.text.includes("[[COACH_"))).toBe(false);
});

test("a rewrite with other placeholders than the prompt is refused", () => {
	const prompt = prepareCoachPrompt("it fail from src/first.ts to src/second.ts", new Set())!;
	expect(() => coachCorrection(prompt, prompt.text.replace("[[COACH_1]]", "[[COACH_9]]"), [mistake])).toThrow("unreadable reply");
});

test.each([
	["cat saw dog", "a cat saw a dog", [["cat", "a cat"], ["dog", "a dog"]], [["a", [0]], ["a", [1]]]],
	["dog saw cat and dog", "dog saw a cat and a dog", [["cat", "a cat"], ["and dog", "and a dog"]], [["a", [0]], ["a", [1]]]],
	[
		"user input wrong password",
		"A user enters the wrong password.",
		[["user", "A user"], ["input", "enters"]],
		[["A", [0]], ["input", [1]], ["enters the", [1]], [".", []]],
	],
	[
		"yesterday I find issue",
		"Yesterday I found an issue",
		[["yesterday I find", "Yesterday I found"], ["find issue", "found an issue"]],
		[["find", [0, 1]], ["found an", [0, 1]]],
	],
] as const)("each change in %j explains the mistakes at its own place", (input, rewrite, pairs, expected) => {
	const mistakes = pairs.map(([original, corrected], index) => ({ original, corrected, pattern: `p${index}` }));
	const correction = coachCorrection(prepareCoachPrompt(input, new Set())!, rewrite, mistakes);
	const changes = correction.lines.flat().filter(part => part.kind !== "same" && part.kind !== "protected");
	expect(changes.map(part => [part.text, part.mistakes])).toEqual(expected.map(([text, indices]) => [text, [...indices]]));
});
