import { type Component, type DescribeContext, getKeybindings, type NativeNode, node, span, type TUI, text, truncateToWidth } from "@oh-my-pi/pi-tui";
import { theme } from "@oh-my-pi/pi-tui/theme";
import { hintsRow, hintText, type KeyHint, SCROLL_BOX_CSS, scrollBox } from "./ask-editor";
import { hasToolCalls, type SideQuestionTurn, SideQuestionTurnView } from "./side-question-view";

const PANEL_HEIGHT_RATIO = 0.4;

const SHEET_MESSAGE = `\x1b_tsp;s;${JSON.stringify({ name: "omp-tools-btw", css: SCROLL_BOX_CSS })}\x1b\\`;

export interface BtwPanelState {
	readonly turns: readonly SideQuestionTurn[];
	readonly toolsOpen: boolean;
	/** Changes on every thread update, so Tern scrolls to the end again. */
	readonly revision: number;
}

function panelHints(state: BtwPanelState): KeyHint[] {
	const esc = getKeybindings().getKeys("app.interrupt")[0] ?? "escape";
	if (state.turns.at(-1)?.status === "running") return [{ keys: [esc], label: "to cancel" }];
	const tools = state.turns.some(hasToolCalls);
	return [
		...(tools ? [{ keys: ["t"], label: state.toolsOpen ? "to fold tool calls" : "to show tool calls" }] : []),
		{ keys: [esc], label: "to close" },
	];
}

export class BtwPanel implements Component {
	readonly #tui: TUI;
	readonly #state: () => BtwPanelState;
	readonly #turns = new SideQuestionTurnView("Answering…");

	constructor(tui: TUI, state: () => BtwPanelState) {
		this.#tui = tui;
		this.#state = state;
	}

	invalidate(): void {
		this.#turns.invalidate();
	}

	render(width: number): string[] {
		const state = this.#state();
		const inner = Math.max(1, width - 2);
		const lines: string[] = [];
		let lastTurnStart = 0;
		for (const turn of state.turns) {
			if (lines.length > 0) lines.push("");
			lastTurnStart = lines.length;
			lines.push(...this.#turns.lines(turn, inner, state.toolsOpen));
		}
		const maxBody = Math.max(3, Math.floor(this.#rows() * PANEL_HEIGHT_RATIO) - 2);
		// The text panel cannot scroll: it shows the thread's end, or, with the
		// tool calls open, the last turn from its question so the calls show. The
		// marker line then takes the place of the blank line before that turn.
		const lastTurn = Math.max(0, lastTurnStart - 1);
		const start = state.toolsOpen ? Math.min(lastTurn, Math.max(0, lines.length - maxBody)) : lines.length - maxBody;
		const body = lines.length <= maxBody ? lines : this.#window(lines, Math.max(0, start), maxBody);
		const rule = theme.fg("dim", `─ /btw ${"─".repeat(Math.max(0, width - 7))}`.slice(0, Math.max(0, width)));
		const hints = theme.fg("dim", truncateToWidth(` ${hintText(panelHints(state))}`, width));
		return [rule, ...body.map(line => ` ${line}`), hints];
	}

	describe(cx: DescribeContext): NativeNode {
		// Sent with every describe: a sheet belongs to one surface (see ask-dialog.ts).
		if (cx.feature("styles")) this.#tui.terminal.write(SHEET_MESSAGE);
		const state = this.#state();
		const content: NativeNode = {
			...node(
				"col",
				{ gap: "sm" },
				state.turns.map((turn, index) => this.#turns.describe(turn, index, state.toolsOpen)),
			),
			reveal: { at: "end", n: state.revision },
		};
		const running = state.turns.at(-1)?.status === "running";
		// Inline in the dock with native /btw's role, so Tern styles it as that sheet.
		return node("col", { role: "omp.overlay.btw", gap: "sm" }, [
			node("row", { role: "omp.sheet.head", gap: "sm", align: "center" }, [
				...(running ? [node("spinner", {})] : []),
				text([span("/btw", "accent"), span(" side question · only you see the answers", "muted")], {
					truncate: "end",
					lines: 1,
				}),
			]),
			scrollBox(content, {
				lines: Math.max(3, Math.floor(this.#rows() * PANEL_HEIGHT_RATIO) - 2),
				fixed: false,
				key: "btw-thread",
				scroll: undefined,
			}),
			hintsRow(panelHints(state)),
		]);
	}

	#rows(): number {
		return this.#tui.terminal?.rows ?? process.stdout.rows ?? 40;
	}

	/** `size` lines from `start`, with a marker line for each hidden end. */
	#window(lines: readonly string[], start: number, size: number): string[] {
		const above = start > 0;
		const below = start + size < lines.length;
		const first = above ? start + 1 : start;
		const last = below ? start + size - 1 : start + size;
		return [
			...(above ? [theme.fg("dim", `↑ ${first} more lines`)] : []),
			...lines.slice(first, last),
			...(below ? [theme.fg("dim", `↓ ${lines.length - last} more lines`)] : []),
		];
	}
}
