import type { ImageContent } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { TUI } from "@oh-my-pi/pi-tui";
import { prompt } from "@oh-my-pi/pi-utils";
import btwPrompt from "./btw.md" with { type: "text" };
import { BtwPanel } from "./btw-panel";
import { LazySideQuestionThread, sideQuestionsAvailable } from "./side-question";
import { answerInto, hasToolCalls, isInterruptKey, newTurn, type SideQuestionTurn } from "./side-question-view";

const WIDGET_KEY = "omp-tools.btw";
const BTW_COMMAND = /^\/btw(?:\s+([\s\S]*))?$/;

/** The question of a `/btw <question>` line; `undefined` for bare `/btw` (native history) and anything else. */
export function parseBtwQuestion(text: string): string | undefined {
	const question = BTW_COMMAND.exec(text)?.[1]?.trim();
	return question || undefined;
}

class BtwCycle {
	readonly #ctx: ExtensionContext;
	readonly #thread: LazySideQuestionThread;
	#turns: SideQuestionTurn[] = [];
	#followUpsEnded = false;
	#abort: AbortController | undefined;
	#toolsOpen = false;
	#revision = 0;
	#shown = false;
	#tui: TUI | undefined;
	readonly #stopKeys: () => void;

	constructor(ctx: ExtensionContext) {
		this.#ctx = ctx;
		this.#thread = new LazySideQuestionThread(ctx);
		this.#stopKeys = ctx.ui.onTerminalInput(data => this.#handleKey(data));
	}

	ask(question: string, images?: ImageContent[]): void {
		if (this.#running()) {
			this.#ctx.ui.notify("Wait for the side question's answer, or press Esc to cancel it.", "warning");
			return;
		}
		if (this.#followUpsEnded) this.#endThread();
		const turn = newTurn(question);
		this.#turns.push(turn);
		const abort = new AbortController();
		this.#abort = abort;
		this.#show();
		void answerInto(
			turn,
			async callbacks =>
				(await this.#thread.get()).ask(prompt.render(btwPrompt, { question }), callbacks, abort.signal, images),
			() => this.#render(),
		).then(() => {
			if (this.#abort === abort) this.#abort = undefined;
			if (this.#followUpsEnded) this.#thread.dispose();
		});
	}

	mainPrompt(): void {
		if (this.#running()) {
			this.#followUpsEnded = true;
			return;
		}
		this.#endThread();
		this.#hide();
	}

	dispose(): void {
		this.#abort?.abort();
		this.#endThread();
		this.#hide();
		this.#stopKeys();
	}

	#running(): SideQuestionTurn | undefined {
		const last = this.#turns.at(-1);
		return last?.status === "running" ? last : undefined;
	}

	#cancel(): void {
		const running = this.#running();
		if (running) running.status = "cancelled";
		this.#abort?.abort();
		this.#abort = undefined;
		this.#render();
	}

	#endThread(): void {
		this.#thread.dispose();
		this.#turns = [];
		this.#followUpsEnded = false;
		this.#toolsOpen = false;
	}

	#handleKey(data: string): { consume: boolean } | undefined {
		if (!this.#shown || this.#ctx.ui.getEditorText().trim()) return undefined;
		if (isInterruptKey(data)) {
			if (this.#running()) this.#cancel();
			else this.#hide();
			return { consume: true };
		}
		if (data === "t" && this.#turns.some(hasToolCalls)) {
			this.#toolsOpen = !this.#toolsOpen;
			this.#render();
			return { consume: true };
		}
		return undefined;
	}

	#show(): void {
		if (this.#shown) {
			this.#render();
			return;
		}
		this.#shown = true;
		this.#ctx.ui.setWidget(
			WIDGET_KEY,
			tui => {
				this.#tui = tui;
				return new BtwPanel(tui, () => ({
					turns: this.#turns,
					toolsOpen: this.#toolsOpen,
					revision: this.#revision,
				}));
			},
			{ placement: "aboveEditor" },
		);
	}

	#hide(): void {
		if (!this.#shown) return;
		this.#shown = false;
		this.#tui = undefined;
		this.#ctx.ui.setWidget(WIDGET_KEY, undefined);
	}

	#render(): void {
		this.#revision++;
		this.#tui?.requestRender();
	}
}

export default function btw(pi: ExtensionAPI) {
	let cycle: BtwCycle | undefined;
	const end = () => {
		cycle?.dispose();
		cycle = undefined;
	};

	pi.on("input", (event, ctx) => {
		if (event.source !== "interactive" || ctx.mode !== "tui" || !ctx.hasUI) return undefined;
		const question = parseBtwQuestion(event.text);
		if (question === undefined || !sideQuestionsAvailable(ctx)) return undefined;
		cycle ??= new BtwCycle(ctx);
		cycle.ask(question, event.images);
		return { handled: true };
	});
	pi.on("before_agent_start", () => {
		cycle?.mainPrompt();
	});
	pi.on("session_switch", end);
	pi.on("session_branch", end);
	pi.on("session_tree", end);
	pi.on("session_shutdown", end);
}
