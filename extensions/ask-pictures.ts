// Pictures an `ask` form shows (`<img>` and inline `<svg>`), drawn as native
// ask's form dialog draws them: rows through `Image` or `SvgFigure` in the
// classic TUI, an image blob in Tern. Display only: nothing here reaches the
// answer.
import { Image, measureRender, type NativeNode, node, span, type TUI, truncateToWidth } from "@oh-my-pi/pi-tui";
import { SvgFigure } from "@oh-my-pi/pi-tui/chat/svg-figure";
import { type FormMedia, isSvgMedia, loadFormImage, svgMedia } from "@oh-my-pi/pi-tui/html-form/media";
import { nativeImageNode } from "@oh-my-pi/pi-tui/native/blobs";
import { sanitizeCarriageReturns } from "@oh-my-pi/pi-tui/render";
import { theme } from "@oh-my-pi/pi-tui/theme";
import type { AskPicture } from "./ask-form";

/** Most rows one picture fills, and its share of the terminal (native form dialog values). */
const MAX_PICTURE_ROWS = 16;
const PICTURE_SHARE = 0.35;

type Slot =
	| { state: "loading" }
	| { state: "failed"; reason: string }
	| { state: "ready"; rows: Image | SvgFigure; native: NativeNode };

function pictureName(picture: AskPicture): string {
	const name = picture.alt || (picture.kind === "image" ? picture.src.slice(0, 80) : "drawing");
	return sanitizeCarriageReturns(name).replace(/\s+/g, " ");
}

export class AskPictures {
	readonly #tui: TUI;
	readonly #cwd: string;
	readonly #slots = new Map<AskPicture, Slot>();
	readonly #abort = new AbortController();
	/** Bumped whenever a picture lands or fails, so cached layouts redraw. */
	#version = 0;

	constructor(tui: TUI, cwd: string) {
		this.#tui = tui;
		this.#cwd = cwd;
	}

	get version(): number {
		return this.#version;
	}

	/** Rows of a picture in the classic TUI: its graphic once loaded, else one dim line saying why not. */
	rows(picture: AskPicture, width: number): string[] {
		const slot = this.#slot(picture);
		if (slot.state === "ready") {
			const rows = measureRender(() => slot.rows.render(width)).value;
			if (rows.length > 0) return [...rows];
		}
		return [theme.fg("dim", truncateToWidth(this.#note(picture, slot), width))];
	}

	/** The picture as a Tern node. */
	describe(picture: AskPicture): NativeNode {
		const slot = this.#slot(picture);
		if (slot.state === "ready") return slot.native;
		return node("text", { spans: [span(this.#note(picture, slot), "muted")], truncate: "end" });
	}

	/** A one-line stand-in for a picture that is loading, failed, or does not fit where it would be drawn. */
	placeholder(picture: AskPicture, width: number): string {
		return theme.fg("dim", truncateToWidth(`▣ ${pictureName(picture)}`, width));
	}

	dispose(): void {
		this.#abort.abort();
		for (const slot of this.#slots.values()) {
			if (slot.state !== "ready") continue;
			slot.rows.release();
			if (slot.rows instanceof SvgFigure) slot.rows.dispose();
		}
		this.#slots.clear();
	}

	#slot(picture: AskPicture): Slot {
		let slot = this.#slots.get(picture);
		if (slot) return slot;
		if (picture.kind === "svg") {
			slot = this.#ready(svgMedia(picture.markup), picture.alt || "drawing");
			this.#slots.set(picture, slot);
			return slot;
		}
		slot = { state: "loading" };
		this.#slots.set(picture, slot);
		const signal = this.#abort.signal;
		loadFormImage(picture.src, { cwd: this.#cwd, signal }).then(
			media => {
				if (!signal.aborted) this.#settle(picture, this.#ready(media, picture.alt || "image"));
			},
			(error: unknown) => {
				if (!signal.aborted) this.#settle(picture, { state: "failed", reason: error instanceof Error ? error.message : String(error) });
			},
		);
		return slot;
	}

	#settle(picture: AskPicture, slot: Slot): void {
		this.#slots.set(picture, slot);
		this.#changed();
	}

	#changed(): void {
		this.#version++;
		this.#tui.requestRender();
	}

	#ready(media: FormMedia, alt: string): Slot {
		const maxRows = this.#maxRows();
		const budget = this.#tui.imageBudget;
		const native = nativeImageNode(media.bytes, media.mime, { alt, max: { h: `${maxRows}lines` } });
		if (isSvgMedia(media)) {
			const figure = new SvgFigure({ budget, releaseSuperseded: true, maxRows: () => maxRows, onChange: () => this.#changed() });
			figure.update(new TextDecoder().decode(media.bytes), true);
			return { state: "ready", rows: figure, native };
		}
		const image = new Image(
			media.bytes.toBase64(),
			media.mime,
			{ fallbackColor: text => theme.fg("dim", text) },
			{ maxHeightCells: maxRows, filename: alt, budget, requestRender: () => this.#changed() },
		);
		return { state: "ready", rows: image, native };
	}

	#maxRows(): number {
		const termRows = this.#tui.terminal?.rows ?? process.stdout.rows ?? 40;
		return Math.max(4, Math.min(MAX_PICTURE_ROWS, Math.floor(termRows * PICTURE_SHARE)));
	}

	#note(picture: AskPicture, slot: Slot): string {
		const name = pictureName(picture);
		if (slot.state === "failed") return `▣ ${name} — couldn't load: ${sanitizeCarriageReturns(slot.reason)}`;
		return `▣ ${name}${slot.state === "loading" ? " — loading…" : ""}`;
	}
}
