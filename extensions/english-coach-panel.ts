import { type Component, type DescribeContext, type NativeNode, node, text, type TUI } from "@oh-my-pi/pi-tui";

const SHEET_MESSAGE = `\x1b_tsp;s;${JSON.stringify({
	name: "omp-tools-english-coach",
	css: "[data-role='omp-tools.english-coach.body'] { min-inline-size: 0; white-space: pre-wrap; overflow-wrap: anywhere; }",
})}\x1b\\`;

export class EnglishCoachPanel implements Component {
	constructor(readonly tui: TUI, readonly lines: () => readonly string[]) {}

	invalidate(): void {}

	render(_width: number): string[] {
		return ["English coach", ...this.lines()];
	}

	describe(cx: DescribeContext): NativeNode {
		// OMP 18.20.3's native overlay role reserves the composer dock's height.
		if (cx.feature("styles")) this.tui.terminal.write(SHEET_MESSAGE);
		return node("col", { role: "omp.overlay.btw", gap: "sm" }, [
			text("English coach", { role: "omp.sheet.head" }),
			node("col", { role: "omp-tools.english-coach.body" }, this.lines().map(line => text(line))),
		]);
	}
}
