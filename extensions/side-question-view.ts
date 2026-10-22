import {
	card,
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

/** Text from one assistant message, or the tool calls made between two messages. */
export type SideQuestionPart = { type: "text"; text: string } | { type: "tools"; calls: SideQuestionToolCall[] };

/** One question and its answer, as the /btw panel and the Picker btw view show it. */
export interface SideQuestionTurn {
	question: string;
	/** The answer's text and tool calls, in the order they happened. */
	parts: SideQuestionPart[];
	status: "running" | "complete" | "cancelled" | "error";
	error?: string;
	/** Tokens this answer's requests wrote to the cache again instead of reading them. */
	cacheMissTokens?: number;
}

export function newTurn(question: string): SideQuestionTurn {
	return { question, parts: [], status: "running" };
}

export function hasToolCalls(turn: SideQuestionTurn): boolean {
	return turn.parts.some(part => part.type === "tools");
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
	// A new message's text goes in a new part, so it never replaces an earlier message's text.
	let newMessage = true;
	try {
		const answer = await run({
			onMessageStart: () => {
				newMessage = true;
			},
			onText: text => {
				if (turn.status !== "running") return;
				const last = turn.parts.at(-1);
				if (!newMessage && last?.type === "text") last.text = text;
				else turn.parts.push({ type: "text", text });
				newMessage = false;
				changed();
			},
			onToolCall: call => {
				if (turn.status !== "running") return;
				for (const part of turn.parts) {
					if (part.type !== "tools") continue;
					const index = part.calls.findIndex(known => known.id === call.id);
					if (index < 0) continue;
					part.calls[index] = { ...call };
					changed();
					return;
				}
				const last = turn.parts.at(-1);
				if (last?.type === "tools") last.calls.push({ ...call });
				else turn.parts.push({ type: "tools", calls: [{ ...call }] });
				changed();
			},
			onCacheMiss: tokens => {
				turn.cacheMissTokens = (turn.cacheMissTokens ?? 0) + tokens;
				changed();
			},
		});
		if (turn.status === "running") {
			// The final message's text shows even when the provider streamed none of it.
			const streamed = !newMessage && turn.parts.at(-1)?.type === "text";
			if (answer && !streamed) turn.parts.push({ type: "text", text: answer });
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
};

function summary(calls: readonly SideQuestionToolCall[]): string {
	const running = calls.some(call => call.status === "running");
	return [`${calls.length} tool call${calls.length === 1 ? "" : "s"}`, ...(running ? ["running"] : [])].join(" · ");
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
	#markdown = new WeakMap<SideQuestionPart, { source: string; markdown: Markdown }>();
	#questions = new WeakMap<SideQuestionTurn, Markdown>();

	constructor(runningLabel: string) {
		this.#runningLabel = runningLabel;
	}

	invalidate(): void {
		this.#markdown = new WeakMap();
		this.#questions = new WeakMap();
	}

	/** Classic lines for one turn: the question, its text and tool-call folds in order, and its status. */
	lines(turn: SideQuestionTurn, width: number, toolsOpen: boolean): string[] {
		const lines = [...this.#questionMarkdown(turn).render(width)];
		for (const part of turn.parts) {
			if (part.type === "text") {
				if (part.text.trim()) lines.push(...this.#partMarkdown(part).render(width));
				continue;
			}
			lines.push(theme.fg("dim", truncateToWidth(`${toolsOpen ? "▾" : "▸"} ${summary(part.calls)}`, width)));
			if (toolsOpen) {
				for (const call of part.calls) lines.push(theme.fg("dim", truncateToWidth(`  ${callLine(call)}`, width)));
			}
		}
		if (turn.cacheMissTokens) {
			const label = cacheMissLabel(turn.cacheMissTokens);
			lines.push(truncateToWidth(`${theme.fg("dim", "─".repeat(10))} ${theme.fg("muted", label)}`, width));
		}
		if (turn.status === "running") lines.push(theme.fg("dim", this.#runningLabel));
		else if (turn.status === "cancelled") lines.push(theme.fg("warning", "Cancelled"));
		else if (turn.status === "error") lines.push(...wrapTextWithAnsi(theme.fg("error", errorText(turn)), width));
		return lines;
	}

	/** Tern node for one turn; each group of tool calls is a section the user opens by clicking its head. */
	describe(turn: SideQuestionTurn, index: number, toolsOpen: boolean): NativeNode {
		const children: NativeChild[] = [
			card({ role: "omp.user", tone: "user" }, [md(replaceTabs(turn.question).trim())]),
		];
		const lastPart = turn.parts.length - 1;
		turn.parts.forEach((part, partIndex) => {
			if (part.type === "text") {
				if (part.text.trim()) {
					children.push(md(part.text, { stream: turn.status === "running" && partIndex === lastPart }));
				}
				return;
			}
			children.push(
				node(
					"section",
					{ collapsible: true, collapsed: !toolsOpen },
					[
						node("text", { spans: [span(summary(part.calls), "dim")] }, undefined, "head"),
						node(
							"col",
							{},
							part.calls.map(call =>
								node("text", { spans: [span(callLine(call), "dim")], wrap: "word" }, undefined, call.id),
							),
						),
					],
					`tools${index}-${partIndex}`,
				),
			);
		});
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

	#questionMarkdown(turn: SideQuestionTurn): Markdown {
		const cached = this.#questions.get(turn);
		if (cached) return cached;
		const markdown = new Markdown(replaceTabs(turn.question).trim(), 1, 1, getMarkdownTheme(), {
			bgColor: value => theme.bg("userMessageBg", value),
			color: value => theme.fgOnBg("userMessageText", "userMessageBg", value),
		});
		markdown.setIgnoreTight(true);
		this.#questions.set(turn, markdown);
		return markdown;
	}

	#partMarkdown(part: SideQuestionPart & { type: "text" }): Markdown {
		const cached = this.#markdown.get(part);
		if (cached?.source === part.text) return cached.markdown;
		const markdown = new Markdown(part.text, 0, 0, getMarkdownTheme(), { color: value => theme.fg("text", value) });
		this.#markdown.set(part, { source: part.text, markdown });
		return markdown;
	}
}
