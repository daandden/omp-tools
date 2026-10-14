import {
	getKeybindings,
	Markdown,
	matchesKey,
	md,
	type NativeChild,
	type NativeNode,
	node,
	replaceTabs,
	span,
	text,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@oh-my-pi/pi-tui";
import { getMarkdownTheme, theme } from "@oh-my-pi/pi-tui/theme";
import { formatNumber } from "@oh-my-pi/pi-utils";
import type { SideQuestionCallbacks, SideQuestionToolCall } from "./side-question";

/** One question and its answer, as the /btw panel and the Picker btw view show it. */
export interface SideQuestionTurn {
	question: string;
	answer: string;
	status: "running" | "complete" | "cancelled" | "error";
	error?: string;
	tools: SideQuestionToolCall[];
	/** Tokens this answer's requests wrote to the cache again instead of reading them. */
	cacheMissTokens?: number;
}

export function newTurn(question: string): SideQuestionTurn {
	return { question, answer: "", status: "running", tools: [] };
}

/**
 * Streams one answer into `turn` and settles its status; `changed` runs after
 * every update. A turn already marked cancelled keeps that status. Never rejects.
 */
export async function answerInto(
	turn: SideQuestionTurn,
	run: (callbacks: SideQuestionCallbacks) => Promise<string>,
	changed: () => void,
): Promise<void> {
	try {
		const answer = await run({
			onText: answerText => {
				if (turn.status !== "running") return;
				turn.answer = answerText;
				changed();
			},
			onToolCall: call => {
				if (turn.status !== "running") return;
				const index = turn.tools.findIndex(known => known.id === call.id);
				if (index < 0) turn.tools.push({ ...call });
				else turn.tools[index] = { ...call };
				changed();
			},
			onCacheMiss: tokens => {
				turn.cacheMissTokens = (turn.cacheMissTokens ?? 0) + tokens;
				changed();
			},
		});
		if (turn.status === "running") {
			turn.answer = answer;
			turn.status = "complete";
		}
	} catch (error) {
		if (turn.status === "running") {
			turn.status = "error";
			turn.error = error instanceof Error ? error.message : String(error);
		}
	}
	changed();
}

/** The interrupt key, as the editor reads it (raw Escape when unbound). */
export function isInterruptKey(data: string): boolean {
	const keybindings = getKeybindings();
	if (keybindings.getKeys("app.interrupt").length > 0) return keybindings.matches(data, "app.interrupt");
	return matchesKey(data, "escape") || matchesKey(data, "esc");
}

const STATUS_NOTE: Record<SideQuestionToolCall["status"], string> = {
	running: " …",
	done: "",
	error: " (failed)",
	blocked: " (refused: not read-only)",
};

function summary(calls: readonly SideQuestionToolCall[]): string {
	const refused = calls.filter(call => call.status === "blocked").length;
	const running = calls.some(call => call.status === "running");
	return [
		`${calls.length} tool call${calls.length === 1 ? "" : "s"}`,
		...(refused > 0 ? [`${refused} refused`] : []),
		...(running ? ["running"] : []),
	].join(" · ");
}

function callLine(call: SideQuestionToolCall): string {
	return `${call.name}${call.target ? ` ${call.target}` : ""}${STATUS_NOTE[call.status]}`;
}

function errorText(turn: SideQuestionTurn): string {
	return `Error: ${replaceTabs(turn.error ?? "Failed").replace(/\s+/g, " ").trim()}`;
}

/** OMP's cache-miss marker label, `⊘ cache miss · 214.4k tokens`. */
function cacheMissLabel(tokens: number): string {
	const icon = theme.icon.cacheMiss;
	return `${icon ? `${icon} ` : ""}cache miss ${theme.sep.dot.trim()} ${formatNumber(tokens)} tokens`;
}

/** Draws turns in both renderers; `runningLabel` is the line under an answer still running. */
export class SideQuestionTurnView {
	readonly #runningLabel: string;
	#markdown = new WeakMap<SideQuestionTurn, { source: string; markdown: Markdown }>();

	constructor(runningLabel: string) {
		this.#runningLabel = runningLabel;
	}

	invalidate(): void {
		this.#markdown = new WeakMap();
	}

	/** Classic lines for one turn: the question, the tool-call fold, the answer, and its status. */
	lines(turn: SideQuestionTurn, width: number, toolsOpen: boolean): string[] {
		const lines = wrapTextWithAnsi(replaceTabs(turn.question).trim(), Math.max(1, width - 2)).map(
			(line, index) => `${theme.fg("accent", index === 0 ? "› " : "  ")}${theme.fg("muted", line)}`,
		);
		if (turn.tools.length > 0) {
			lines.push(theme.fg("dim", truncateToWidth(`${toolsOpen ? "▾" : "▸"} ${summary(turn.tools)}`, width)));
			if (toolsOpen) {
				for (const call of turn.tools) lines.push(theme.fg("dim", truncateToWidth(`  ${callLine(call)}`, width)));
			}
		}
		if (turn.answer.trim()) lines.push(...this.#answerMarkdown(turn).render(width));
		if (turn.cacheMissTokens) {
			const label = cacheMissLabel(turn.cacheMissTokens);
			lines.push(truncateToWidth(`${theme.fg("dim", "─".repeat(10))} ${theme.fg("muted", label)}`, width));
		}
		if (turn.status === "running") lines.push(theme.fg("dim", this.#runningLabel));
		else if (turn.status === "cancelled") lines.push(theme.fg("warning", "Cancelled"));
		else if (turn.status === "error") lines.push(...wrapTextWithAnsi(theme.fg("error", errorText(turn)), width));
		return lines;
	}

	/** Tern node for one turn; the tool calls are a section the user opens by clicking its head. */
	describe(turn: SideQuestionTurn, index: number, toolsOpen: boolean): NativeNode {
		const children: NativeChild[] = [
			text([span("› ", "accent"), span(replaceTabs(turn.question).trim(), "muted")], { wrap: "word" }),
		];
		if (turn.tools.length > 0) {
			children.push(
				node(
					"section",
					{ collapsible: true, collapsed: !toolsOpen },
					[
						node("text", { spans: [span(summary(turn.tools), "dim")] }, undefined, "head"),
						node(
							"col",
							{},
							turn.tools.map(call =>
								node("text", { spans: [span(callLine(call), "dim")], wrap: "word" }, undefined, call.id),
							),
						),
					],
					`tools${index}`,
				),
			);
		}
		if (turn.answer.trim()) children.push(md(turn.answer, { stream: turn.status === "running" }));
		if (turn.cacheMissTokens) children.push(text([span(cacheMissLabel(turn.cacheMissTokens), "muted")]));
		if (turn.status === "running") {
			children.push(node("spinner", { style: "dots", label: [span(this.#runningLabel, "dim")] }));
		} else if (turn.status === "cancelled") {
			children.push(text([span("Cancelled", "warning")]));
		} else if (turn.status === "error") {
			children.push(text([span(errorText(turn), "error")], { wrap: "word" }));
		}
		return node("col", { gap: "xs" }, children, `turn${index}`);
	}

	#answerMarkdown(turn: SideQuestionTurn): Markdown {
		const cached = this.#markdown.get(turn);
		if (cached?.source === turn.answer) return cached.markdown;
		const markdown = new Markdown(turn.answer, 0, 0, getMarkdownTheme(), { color: value => theme.fg("text", value) });
		this.#markdown.set(turn, { source: turn.answer, markdown });
		return markdown;
	}
}
