import type { PreparedCoachPrompt } from "./english-coach-prompt";

/**
 * One run of a correction line: kept text, removed or added words,
 * punctuation that replaced other punctuation, or protected text. The parts
 * of one change (and the space between a removal and its replacement) share
 * `change`, and carry the indices of the reported mistakes that explain it.
 */
export interface CoachSegment {
	kind: "same" | "del" | "ins" | "punct" | "protected";
	text: string;
	change?: number;
	mistakes?: number[];
}

export interface CoachMistake {
	original: string;
	corrected: string;
	pattern: string;
}

export interface CoachCorrection {
	/** The prompt as the user wrote it, changed words marked in place, split at line breaks. */
	lines: CoachSegment[][];
	/** Each reported mistake, in reply order, with placeholders shown as their protected text. */
	mistakes: CoachMistake[];
}

/** Product of the two token counts above which the changed middle shows as one removal and one addition. */
const MAX_DIFF_CELLS = 4_000_000;
const TOKEN = /[\p{L}\p{N}_'’]+|\s+|[^\s\p{L}\p{N}_'’]/gu;
const PLACEHOLDER = /^\[\[COACH_+\d+\]\]$/;
/** Splits a text into prose and the placeholders between it (odd indices). */
const SPLIT = /(\[\[COACH_+\d+\]\])/;
const WORD = /[\p{L}\p{N}]/u;

function tokens(text: string): string[] {
	return text.match(TOKEN) ?? [];
}

/**
 * Whitespace of any kind matches: the rewrite is one line, the prompt may not
 * be. Case never counts: the coach does not correct capitalization, so a
 * word that differs only in case is kept as the user wrote it.
 */
function same(a: string, b: string): boolean {
	return a === b || a.toLowerCase() === b.toLowerCase() || (/^\s+$/.test(a) && /^\s+$/.test(b));
}

type Op = { kind: "same"; a: string; b: string } | { kind: "del"; a: string } | { kind: "ins"; b: string };

/** Token edit script from `a` to `b`: common ends trimmed, then a longest common subsequence. */
function diff(a: string[], b: string[]): Op[] {
	let start = 0;
	while (start < a.length && start < b.length && same(a[start]!, b[start]!)) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && same(a[endA - 1]!, b[endB - 1]!)) {
		endA--;
		endB--;
	}
	const head: Op[] = a.slice(0, start).map((token, index) => ({ kind: "same", a: token, b: b[index]! }));
	const tail: Op[] = a.slice(endA).map((token, index) => ({ kind: "same", a: token, b: b[endB + index]! }));
	const midA = a.slice(start, endA);
	const midB = b.slice(start, endB);
	const n = midA.length;
	const m = midB.length;
	if (n * m > MAX_DIFF_CELLS) {
		return [...head, ...midA.map(token => ({ kind: "del", a: token }) as Op), ...midB.map(token => ({ kind: "ins", b: token }) as Op), ...tail];
	}
	// lengths[i * (m + 1) + j]: the LCS length of midA[i..] and midB[j..].
	const lengths = new Uint32Array((n + 1) * (m + 1));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lengths[i * (m + 1) + j] = same(midA[i]!, midB[j]!)
				? lengths[(i + 1) * (m + 1) + j + 1]! + 1
				: Math.max(lengths[(i + 1) * (m + 1) + j]!, lengths[i * (m + 1) + j + 1]!);
		}
	}
	const middle: Op[] = [];
	let i = 0;
	let j = 0;
	while (i < n || j < m) {
		if (i < n && j < m && same(midA[i]!, midB[j]!)) middle.push({ kind: "same", a: midA[i++]!, b: midB[j++]! });
		else if (j < m && (i === n || lengths[i * (m + 1) + j + 1]! >= lengths[(i + 1) * (m + 1) + j]!)) middle.push({ kind: "ins", b: midB[j++]! });
		else middle.push({ kind: "del", a: midA[i++]! });
	}
	return [...head, ...middle, ...tail];
}

/** Lowercase words only, for matching a changed run against a reported mistake. */
function words(text: string): string {
	return ` ${(text.toLowerCase().match(/[\p{L}\p{N}'’]+/gu) ?? []).join(" ")} `;
}

type Range = { start: number; end: number };

/**
 * Where each mistake's original stands in the prompt, matched case-insensitively
 * with any whitespace between its words. Mistakes come in text order, so each
 * search starts after the previous match's start, then from the top.
 */
function mistakeRanges(text: string, mistakes: readonly CoachMistake[]): (Range | undefined)[] {
	let cursor = 0;
	return mistakes.map(mistake => {
		const parts = mistake.original.trim().split(/\s+/).filter(Boolean);
		if (parts.length === 0) return undefined;
		const pattern = new RegExp(parts.map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "giu");
		pattern.lastIndex = cursor;
		let match = pattern.exec(text);
		if (!match) {
			pattern.lastIndex = 0;
			match = pattern.exec(text);
		}
		if (!match) return undefined;
		cursor = match.index + 1;
		return { start: match.index, end: match.index + match[0].length };
	});
}

/**
 * The mistakes a changed run belongs to: every mistake whose original
 * overlaps the run's place in the prompt, as when the model reports
 * overlapping fixes for one diff run. Without one, the best of a mistake only
 * whitespace away, then one whose original and corrected text contain the
 * run's words; ties go to the earlier mistake. Punctuation alone has none.
 */
function mistakesFor(
	text: string,
	run: Range,
	removed: string,
	added: string,
	mistakes: readonly CoachMistake[],
	ranges: readonly (Range | undefined)[],
): number[] {
	const del = words(removed);
	const ins = words(added);
	if (!del.trim() && !ins.trim()) return [];
	const inside = ranges.flatMap((range, index) =>
		range !== undefined && (run.start === run.end
			? range.start <= run.start && run.start <= range.end
			: range.start < run.end && run.start < range.end)
			? [index]
			: []);
	if (inside.length > 0) return inside;
	const covers = (whole: string, part: string) => part.trim() !== "" && words(whole).includes(part);
	const near = (a: number, b: number) => /^\s*$/.test(text.slice(Math.min(a, b), Math.max(a, b)));
	let best: number | undefined;
	let bestScore = 0;
	mistakes.forEach((mistake, index) => {
		const range = ranges[index];
		const both = (!del.trim() || covers(mistake.original, del)) && (!ins.trim() || covers(mistake.corrected, ins));
		const either = covers(mistake.original, del) || covers(mistake.corrected, ins);
		const beside = range !== undefined && (near(run.end, range.start) || near(range.end, run.start));
		const score = (beside ? 4 : 0) + (both ? 2 : either ? 1 : 0);
		if (score > bestScore) {
			best = index;
			bestScore = score;
		}
	});
	return best === undefined ? [] : [best];
}

/**
 * The correction as the prompt the user wrote with the rewrite's changes
 * marked word by word, plus the reported mistakes with placeholders shown as
 * their protected text. The prose between placeholders is diffed piece by
 * piece, so each placeholder shows its protected text once; line breaks come
 * from the prompt. Throws unless both texts hold the same placeholders in the
 * same order.
 */
export function coachCorrection(prompt: PreparedCoachPrompt, rewrite: string, mistakes: readonly CoachMistake[]): CoachCorrection {
	const shown = new Map(prompt.placeholders.map(item => [item.token, item.display.trim()]));
	const display = (text: string) => text.replace(/\[\[COACH_+\d+\]\]/g, token => shown.get(token) ?? token);
	const before = prompt.text.split(SPLIT);
	const after = rewrite.split(SPLIT);
	if (before.length !== after.length || before.some((part, index) => index % 2 === 1 && part !== after[index])) {
		throw new Error("unreadable reply");
	}
	const ops = before.flatMap((part, index): Op[] =>
		index % 2 === 1 ? [{ kind: "same", a: part, b: part }] : diff(tokens(part), tokens(after[index]!)));
	const segments: CoachSegment[] = [];
	const push = (kind: CoachSegment["kind"], text: string, change?: { id: number; mistakes: number[] }) => {
		if (!text) return;
		const last = segments.at(-1);
		if (last?.kind === kind && last.change === change?.id) last.text += text;
		else segments.push(change === undefined ? { kind, text } : { kind, text, change: change.id, mistakes: change.mistakes });
	};
	let changes = 0;
	const ranges = mistakeRanges(prompt.text, mistakes);
	// Offset in the prompt text: kept and removed text advance it; added text does not.
	let at = 0;
	for (let index = 0; index < ops.length;) {
		const op = ops[index]!;
		if (op.kind === "same") {
			if (PLACEHOLDER.test(op.a)) push("protected", shown.get(op.a) ?? op.a);
			else push("same", op.a);
			at += op.a.length;
			index++;
			continue;
		}
		// One changed run: word changes joined across the whitespace between them; a punctuation change stands alone.
		let removed = "";
		let added = "";
		let end = index;
		for (; end < ops.length; end++) {
			const next = ops[end]!;
			if (next.kind === "del") removed += next.a;
			else if (next.kind === "ins") added += next.b;
			else if (/^\s+$/.test(next.a) && ops[end + 1] !== undefined && ops[end + 1]!.kind !== "same" && WORD.test(removed + added)) {
				removed += next.a;
				added += next.b;
			} else break;
		}
		index = end;
		const run = { start: at + removed.match(/^\s*/)![0].length, end: at + removed.trimEnd().length };
		if (run.end < run.start) run.end = run.start;
		at += removed.length;
		const del = removed.trim();
		const ins = added.trim();
		if (!del && !ins) {
			push("same", removed || added);
			continue;
		}
		const outer = del ? removed : added;
		push("same", outer.match(/^\s*/)![0]);
		const change = { id: changes++, mistakes: mistakesFor(prompt.text, run, del, ins, mistakes, ranges) };
		if (del && ins && !WORD.test(del + ins)) {
			// Punctuation swapped for punctuation reads best as the new mark alone.
			push("punct", ins, change);
		} else {
			push("del", del, change);
			// A space keeps replaced words apart.
			if (del && ins) push("same", " ", change);
			push("ins", ins, change);
		}
		push("same", outer.match(/\s*$/)![0]);
	}
	const lines: CoachSegment[][] = [[]];
	for (const segment of segments) {
		segment.text.split(/\r?\n/).forEach((part, index) => {
			if (index > 0) lines.push([]);
			if (part) lines.at(-1)!.push({ ...segment, text: part });
		});
	}
	return {
		lines: lines.filter(line => line.some(part => part.text.trim())),
		mistakes: mistakes.map(mistake => ({
			original: display(mistake.original),
			corrected: display(mistake.corrected),
			pattern: display(mistake.pattern),
		})),
	};
}
