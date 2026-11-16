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
	wrapTextWithAnsi,
} from "@oh-my-pi/pi-tui";
import { hintText, SCROLL_BOX_CSS, scrollBox } from "./ask-editor";

const PANEL_HEIGHT_RATIO = 0.4;
const CHECKING = "Checking...";

const SHEET_MESSAGE = `\x1b_tsp;s;${JSON.stringify({
	name: "omp-tools-english-coach",
	css: `${SCROLL_BOX_CSS}
	[data-role='omp-tools.english-coach.body'] { min-inline-size: 0; max-inline-size: 100%; font-family: var(--sans); white-space: pre-wrap; overflow-wrap: anywhere; }`,
})}\x1b\\`;

const CORRECTION = /^(- )(.+)( → )(.+)( \([^)]+\))$/;

/** The key that closes the panel: the first `app.interrupt` binding, else Escape. */
function closeKey(): string {
	return getKeybindings().getKeys("app.interrupt")[0] ?? "escape";
}

/** One body line with its labels muted; the spans join to the line's exact text. */
function styledLine(line: string): NativeNode {
	if (line.startsWith("Better: ")) return text([span("Better: ", "muted"), span(line.slice(8))], { wrap: "word" });
	const correction = CORRECTION.exec(line);
	if (!correction) return text(line, { wrap: "word" });
	const [, bullet, original, arrow, corrected, pattern] = correction;
	return text([span(bullet!, "muted"), span(original!, "muted"), span(arrow!, "muted"), span(corrected!), span(pattern!, "muted")], {
		wrap: "word",
	});
}

export class EnglishCoachPanel implements Component {
	constructor(
		readonly tui: TUI,
		readonly lines: () => readonly string[],
		readonly close: () => void,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const inner = Math.max(1, width);
		const body = this.lines().flatMap(line => wrapTextWithAnsi(line, inner));
		const maxBody = this.#maxBody();
		const title = `English coach · ${hintText([{ keys: [closeKey()], label: "to close" }])}`;
		return [truncateToWidth(title, inner), ...(body.length <= maxBody ? body : [
			...body.slice(0, maxBody - 1),
			truncateToWidth(`… ${body.length - maxBody + 1} more lines`, inner),
		])];
	}

	describe(cx: DescribeContext): NativeNode {
		if (cx.feature("styles")) this.tui.terminal.write(SHEET_MESSAGE);
		const lines = this.lines();
		const checking = lines.length === 1 && lines[0] === CHECKING;
		// Native /btw's role and no width of its own, so the panel spans the composer's measure as /btw does.
		return node("col", { role: "omp.overlay.btw", gap: "sm" }, [
			node("row", { role: "omp.sheet.head", gap: "sm", align: "center" }, [
				...(checking ? [node("spinner", {})] : []),
				text([span("English coach", "accent"), span(" · only you see this", "muted")], { truncate: "end", lines: 1 }),
				node("spacer", { grow: 1 }),
				node("row", { gap: "xs", align: "center", actions: { click: "close" }, title: "Close" }, [
					kbd(closeKey()),
					text([span("to close", "muted")]),
				], "close"),
			]),
			scrollBox(
				node("col", { role: "omp-tools.english-coach.body" }, lines.map(styledLine)),
				{ lines: this.#maxBody(), fixed: false, key: "english-coach-body", scroll: undefined },
			),
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
