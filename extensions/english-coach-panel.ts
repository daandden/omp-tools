import { type Component, type DescribeContext, type NativeNode, node, text, truncateToWidth, type TUI, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import { SCROLL_BOX_CSS, scrollBox } from "./ask-editor";

const PANEL_HEIGHT_RATIO = 0.4;

const SHEET_MESSAGE = `\x1b_tsp;s;${JSON.stringify({
	name: "omp-tools-english-coach",
	css: `${SCROLL_BOX_CSS}
	[data-role='omp-tools.english-coach.body'] { min-inline-size: 0; max-inline-size: 100%; white-space: pre-wrap; overflow-wrap: anywhere; }`,
})}\x1b\\`;

export class EnglishCoachPanel implements Component {
	constructor(readonly tui: TUI, readonly lines: () => readonly string[]) {}

	invalidate(): void {}

	render(width: number): string[] {
		const inner = Math.max(1, width);
		const body = this.lines().flatMap(line => wrapTextWithAnsi(line, inner));
		const maxBody = this.#maxBody();
		return [truncateToWidth("English coach", inner), ...(body.length <= maxBody ? body : [
			...body.slice(0, maxBody - 1),
			truncateToWidth(`… ${body.length - maxBody + 1} more lines`, inner),
		])];
	}

	describe(cx: DescribeContext): NativeNode {
		if (cx.feature("styles")) this.tui.terminal.write(SHEET_MESSAGE);
		return node("col", {
			role: "omp.overlay.btw", gap: "sm", min: { w: 1 }, max: { w: 1 },
		}, [
			text("English coach", { role: "omp.sheet.head" }),
			scrollBox(
				node("col", { role: "omp-tools.english-coach.body" }, this.lines().map(line => text(line, { wrap: "word" }))),
				{ lines: this.#maxBody(), fixed: false, key: "english-coach-body", scroll: undefined },
			),
		]);
	}

	#maxBody(): number {
		const rows = this.tui.terminal?.rows ?? process.stdout.rows ?? 40;
		return Math.max(1, Math.floor(rows * PANEL_HEIGHT_RATIO) - 1);
	}
}
