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
// The close key floats over the frame's bottom-right corner on the panel's
// own colour, covering whatever text lies under it. The overlay role pads
// 16px above and 18px below (Tern 0.9.26), and the last line's descent adds
// about 3px more under the glyphs, so the panel trims its bottom padding to
// show the same space below the text as above it.
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
[data-role='omp-tools.english-coach.unplaced'] { margin-top: 6px; gap: 3px; }
[data-role='omp-tools.english-coach.frame'] { position: relative; }
[data-role='omp-tools.english-coach.close'] { position: absolute; right: 0; bottom: 0; padding-left: 6px; background: var(--raise); }
.sf-col.sf-col[data-role='omp.overlay.btw']:has([data-role='omp-tools.english-coach.frame']) { padding-bottom: 13px; }`;

/** What the panel shows: a running check, a clean prompt, a one-line note, or a marked-up correction. */
export type CoachView =
	| { kind: "checking" }
	| { kind: "clean" }
	| { kind: "note"; text: string }
	| { kind: "correction"; correction: CoachCorrection };

/** The one line a view without a correction shows. */
function notice(view: Exclude<CoachView, { kind: "correction" }>): string {
	switch (view.kind) {
		case "checking":
			return "Checking…";
		case "clean":
			return "No mistakes";
		case "note":
			return view.text;
	}
}

/** Tern: that line, after a spinner while the check runs. */
function ternNotice(view: Exclude<CoachView, { kind: "correction" }>): NativeNode {
	const line = text([span(notice(view), "muted")], { wrap: "word" });
	return view.kind === "checking" ? node("row", { gap: "sm", align: "center" }, [node("spinner", {}), line]) : line;
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
		const body = view.kind === "correction"
			? [
				...view.correction.lines.flatMap(line => wrapTextWithAnsi(line.map(classicSegment).join(""), inner)),
				...view.correction.mistakes.flatMap(mistake => wrapTextWithAnsi(classicMistake(mistake), inner)),
			]
			: wrapTextWithAnsi(theme.fg("muted", notice(view)), inner);
		const maxLines = this.#maxLines();
		const lines = body.length <= maxLines ? body : [
			...body.slice(0, maxLines - 1),
			theme.fg("dim", truncateToWidth(`… ${body.length - maxLines + 1} more lines`, inner)),
		];
		// The close key overlays the right end of the last line, cutting off any text there.
		const close = keyLabel(closeKey());
		const room = inner - visibleWidth(close) - 1;
		const last = room >= 0
			? `${truncateToWidth(lines.at(-1) ?? "", room, "", true)} ${theme.fg("dim", close)}`
			: theme.fg("dim", truncateToWidth(close, inner));
		return [...lines.slice(0, -1), last];
	}

	describe(cx: DescribeContext): NativeNode {
		if (cx.feature("styles")) this.tui.terminal.write(sheetMessage("omp-tools-english-coach", SHEET_CSS));
		const view = this.view();
		const body = view.kind === "correction" ? ternCorrection(view.correction) : [ternNotice(view)];
		// Native /btw's role and no width of its own, so the panel spans the composer's measure as /btw does.
		// The sheet floats the close key over the frame's bottom-right corner; unstyled, it follows the body.
		return node("col", { role: "omp.overlay.btw" }, [
			node("col", { role: "omp-tools.english-coach.frame" }, [
				scrollBox(
					node("col", { role: "omp-tools.english-coach.body" }, body),
					{ lines: this.#maxLines(), fixed: false, key: "english-coach-body", scroll: undefined },
				),
				node(
					"row",
					{ role: "omp-tools.english-coach.close", align: "center", actions: { click: "close" }, title: "Close" },
					[kbd(closeKey())],
					"close",
				),
			]),
		]);
	}

	handleNativeEvent(event: NativeUiEvent): void {
		if (event.type === "action" && event.act === "close") this.close();
	}

	/** The panel's share of the terminal rows. */
	#maxLines(): number {
		const rows = this.tui.terminal?.rows ?? process.stdout.rows ?? 40;
		return Math.max(1, Math.floor(rows * PANEL_HEIGHT_RATIO));
	}
}
