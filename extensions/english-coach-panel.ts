import {
	type Component,
	type DescribeContext,
	getKeybindings,
	kbd,
	type NativeNode,
	type NativeUiEvent,
	node,
	span,
	text,
	truncateToWidth,
	type TUI,
	visibleWidth,
	wrapTextWithAnsi,
} from "@oh-my-pi/pi-tui";
import { theme } from "@oh-my-pi/pi-tui/theme";
import { keyLabel, SCROLL_BOX_CSS, scrollBox } from "./ask-editor";
import type { CoachCorrection, CoachMistake, CoachSegment } from "./english-coach-diff";
import { sheetMessage } from "./tern-theme";

const PANEL_HEIGHT_RATIO = 0.4;

// pi-wire is not a direct dependency; take its types from the builders.
type TspSpan = ReturnType<typeof span>;
type TspPropNode = NonNullable<NonNullable<Parameters<typeof node<"text">>[1]>["hovercard"]>;

// Removed and added words sit on soft tinted chips so their edges show; a
// change that explains itself on hover shows a help cursor and brightens.
const SHEET_CSS = `${SCROLL_BOX_CSS}
[data-role='omp-tools.english-coach.body'] { min-inline-size: 0; max-inline-size: 100%; font-family: var(--sans); white-space: pre-wrap; overflow-wrap: anywhere; }
[data-role='omp-tools.english-coach.diff'] { line-height: 1.75; }
[data-role='omp-tools.english-coach.diff'] :is(.sf-t-del, .sf-t-ins) { padding: 1px 2px; border-radius: 4px; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
[data-role='omp-tools.english-coach.diff'] .sf-t-del { background: color-mix(in oklch, var(--sf-c-del) 11%, transparent); text-decoration-color: color-mix(in oklch, var(--sf-c-del) 70%, transparent); }
[data-role='omp-tools.english-coach.diff'] .sf-t-ins { background: color-mix(in oklch, var(--sf-c-ins) 13%, transparent); }
[data-role='omp-tools.english-coach.diff'] .sf-t-success { color: var(--sf-c-ins); font-weight: 600; }
[data-role='omp-tools.english-coach.change'] { cursor: help; }
[data-role='omp-tools.english-coach.change']:hover .sf-t-del { background: color-mix(in oklch, var(--sf-c-del) 24%, transparent); }
[data-role='omp-tools.english-coach.change']:hover .sf-t-ins { background: color-mix(in oklch, var(--sf-c-ins) 26%, transparent); }
[data-role='omp-tools.english-coach.unplaced'] { margin-top: 6px; gap: 3px; }`;

/** What the panel shows: a running check, a clean prompt, a one-line note, or a marked-up correction. */
export type CoachView =
	| { kind: "checking" }
	| { kind: "clean" }
	| { kind: "note"; text: string }
	| { kind: "correction"; correction: CoachCorrection };

/** The words after the title: what the check found. */
function status(view: CoachView): string | undefined {
	switch (view.kind) {
		case "checking":
			return "checking…";
		case "clean":
			return "no mistakes";
		case "correction": {
			const count = view.correction.mistakes.length;
			return `${count} ${count === 1 ? "fix" : "fixes"}`;
		}
		case "note":
			return undefined;
	}
}

/** The key that closes the panel: the first `app.interrupt` binding, else Escape. */
function closeKey(): string {
	return getKeybindings().getKeys("app.interrupt")[0] ?? "escape";
}

/** One mistake as a line: original → corrected (pattern). */
function mistakeSpans(mistake: CoachMistake): TspSpan[] {
	return [
		span(mistake.original, "muted"),
		span(" → ", "dim"),
		span(mistake.corrected, "strong"),
		span(` (${mistake.pattern})`, "muted"),
	];
}

/** Classic has no pointer, so it lists each mistake below the prompt. */
function classicMistake(mistake: CoachMistake): string {
	return `${theme.fg("muted", `- ${mistake.original}`)}${theme.fg("dim", " → ")}${mistake.corrected}${theme.fg("muted", ` (${mistake.pattern})`)}`;
}

/** One change as the hover shows it: what it removed and what it added. */
type Change = { removed: string; added: string };

function changeOf(segments: readonly CoachSegment[]): Change {
	const join = (kinds: readonly CoachSegment["kind"][]) =>
		segments.filter(segment => kinds.includes(segment.kind)).map(segment => segment.text.trim()).join(" ");
	return { removed: join(["del"]), added: join(["ins", "punct"]) };
}

function changeText({ removed, added }: Change): string {
	return removed && added ? `${removed} → ${added}` : added ? `+ ${added}` : `− ${removed}`;
}

/** The card a change shows on hover: that change alone, then why, in the coach's language (one line per reported mistake it fixes). */
function hovercard({ removed, added }: Change, patterns: readonly string[]): TspPropNode {
	const fix = removed && added
		? [span(removed, "del"), span(" → ", "dim"), span(added, "ins")]
		: added ? [span("+ ", "dim"), span(added, "ins")] : [span(removed, "del")];
	return {
		k: "col",
		p: { gap: "xs" },
		c: [
			{ k: "text", p: { spans: fix, wrap: "word" } },
			...patterns.map((pattern): TspPropNode => ({ k: "text", p: { spans: [span(pattern)], wrap: "word" } })),
		],
	};
}

/** Edge spaces as no-break spaces: a line's pieces are separate boxes, and a box's trailing space would hang with no width. */
function keepEdges(spans: TspSpan[]): TspSpan[] {
	const first = spans[0];
	const last = spans.at(-1);
	if (first) first.t = first.t.replace(/^\s+/, space => "\u00a0".repeat(space.length));
	if (last) last.t = last.t.replace(/\s+$/, space => "\u00a0".repeat(space.length));
	return spans;
}

/**
 * A correction line as inline pieces, so each change can carry its own
 * hover: kept text one word per piece (so the line still wraps by word), and
 * each explained change one piece. Spaces end the piece before them, so no
 * wrapped line starts with one.
 */
function ternLine(line: readonly CoachSegment[], mistakes: readonly CoachMistake[], key: string): NativeNode {
	const pieces: { spans: TspSpan[]; note?: { change: Change; patterns: string[] } }[] = [];
	for (let index = 0; index < line.length;) {
		const segment = line[index]!;
		if (segment.change !== undefined && segment.mistakes?.length) {
			const own: CoachSegment[] = [];
			for (; index < line.length && line[index]!.change === segment.change; index++) own.push(line[index]!);
			pieces.push({
				spans: own.map(part => span(part.text, SPAN_TOKENS[part.kind])),
				note: { change: changeOf(own), patterns: segment.mistakes.map(mistake => mistakes[mistake]!.pattern) },
			});
			continue;
		}
		for (const word of segment.text.match(/\S+\s*|\s+/g) ?? []) {
			const piece = { spans: [span(word, SPAN_TOKENS[segment.kind])] };
			if (/^\s+$/.test(word) && pieces.length > 0) pieces.at(-1)!.spans.push(...piece.spans);
			else pieces.push(piece);
		}
		index++;
	}
	return node("row", { wrap: true, gap: "none", align: "baseline" }, pieces.map(({ spans, note }, index) =>
		node("text", {
			spans: keepEdges(spans),
			wrap: "word",
			...(note
				? {
					role: "omp-tools.english-coach.change",
					title: `${changeText(note.change)}: ${note.patterns.join("; ")}`,
					hovercard: hovercard(note.change, note.patterns),
				}
				: {}),
		}, undefined, String(index))), key);
}

/** Tern: the prompt with hover explanations, then any mistake no change carries. */
function ternCorrection(correction: CoachCorrection): NativeNode[] {
	const placed = new Set(correction.lines.flat().flatMap(segment => segment.mistakes ?? []));
	const unplaced = correction.mistakes.filter((_, index) => !placed.has(index));
	return [
		node("col", { role: "omp-tools.english-coach.diff" }, correction.lines.map((line, index) =>
			ternLine(line, correction.mistakes, `line:${index}`))),
		...(unplaced.length > 0
			? [node("col", { role: "omp-tools.english-coach.unplaced" }, unplaced.map(mistake =>
				text(mistakeSpans(mistake), { wrap: "word" })))]
			: []),
	];
}

const SPAN_TOKENS: Record<CoachSegment["kind"], string | undefined> = {
	same: undefined,
	del: "del",
	ins: "ins",
	punct: "success",
	protected: "dim",
};

function classicSegment(segment: CoachSegment): string {
	switch (segment.kind) {
		case "same":
			return segment.text;
		case "del":
			return theme.fg("toolDiffRemoved", theme.strikethrough(segment.text));
		case "ins":
		case "punct":
			return theme.fg("toolDiffAdded", segment.text);
		case "protected":
			return theme.fg("dim", segment.text);
	}
}

export class EnglishCoachPanel implements Component {
	constructor(
		readonly tui: TUI,
		readonly view: () => CoachView,
		readonly close: () => void,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const inner = Math.max(1, width);
		const view = this.view();
		const state = status(view);
		const title = `${theme.fg("accent", "English coach")}${state ? theme.fg("muted", ` · ${state}`) : ""}`;
		const close = theme.fg("dim", keyLabel(closeKey()));
		const gap = inner - visibleWidth(title) - visibleWidth(close);
		const head = gap >= 2 ? `${title}${" ".repeat(gap)}${close}` : truncateToWidth(title, inner);
		const body = view.kind === "note"
			? wrapTextWithAnsi(theme.fg("muted", view.text), inner)
			: view.kind === "correction"
				? [
					...view.correction.lines.flatMap(line => wrapTextWithAnsi(line.map(classicSegment).join(""), inner)),
					...view.correction.mistakes.flatMap(mistake => wrapTextWithAnsi(classicMistake(mistake), inner)),
				]
				: [];
		const maxBody = this.#maxBody();
		return [head, ...(body.length <= maxBody ? body : [
			...body.slice(0, maxBody - 1),
			theme.fg("dim", truncateToWidth(`… ${body.length - maxBody + 1} more lines`, inner)),
		])];
	}

	describe(cx: DescribeContext): NativeNode {
		if (cx.feature("styles")) this.tui.terminal.write(sheetMessage("omp-tools-english-coach", SHEET_CSS));
		const view = this.view();
		const state = status(view);
		const body: NativeNode[] = view.kind === "note"
			? [text([span(view.text, "muted")], { wrap: "word" })]
			: view.kind === "correction"
				? ternCorrection(view.correction)
				: [];
		// Native /btw's role and no width of its own, so the panel spans the composer's measure as /btw does.
		return node("col", { role: "omp.overlay.btw", gap: "xs" }, [
			node("row", { role: "omp.sheet.head", gap: "sm", align: "center" }, [
				...(view.kind === "checking" ? [node("spinner", {})] : []),
				node("text", {
					spans: [span("English coach", "accent"), ...(state ? [span(` · ${state}`, "muted")] : [])],
					truncate: "end",
					lines: 1,
					role: "omp-tools.english-coach.title",
				}),
				node("spacer", { grow: 1 }),
				node("row", { align: "center", actions: { click: "close" }, title: "Close" }, [kbd(closeKey())], "close"),
			]),
			...(body.length > 0
				? [scrollBox(
					node("col", { role: "omp-tools.english-coach.body" }, body),
					{ lines: this.#maxBody(), fixed: false, key: "english-coach-body", scroll: undefined },
				)]
				: []),
		]);
	}

	handleNativeEvent(event: NativeUiEvent): void {
		if (event.type === "action" && event.act === "close") this.close();
	}

	#maxBody(): number {
		const rows = this.tui.terminal?.rows ?? process.stdout.rows ?? 40;
		return Math.max(1, Math.floor(rows * PANEL_HEIGHT_RATIO) - 1);
	}
}
