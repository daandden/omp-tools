// Deferred advisor notes, read from OMP's advisor transcript. While the
// agent's run continues, OMP holds nits and concerns in a private in-memory
// list and sends them only at the final answer. Extensions cannot reach that
// list, but OMP logs each advisor message to `<session dir>/__advisor.jsonl`
// (`__advisor.<slug>.jsonl` for a named advisor) as it finalizes, and a
// deferred note shows there as an `advise` tool result with OMP's deferred
// acknowledgment and the note in `details`. This file format is private to
// OMP (checked in 18.10.4): an update can change it, and then no note is found.
import * as fs from "node:fs";
import * as path from "node:path";
import { escapeXmlAttribute, escapeXmlText } from "@oh-my-pi/pi-utils";
import type { AdvisorNote } from "@oh-my-pi/pi-tui/chat/messages";

/** Event-bus channel that the Picker emits on after an answer (Submit or timeout). */
export const PICKER_ANSWERED = "omp-tools:picker-answered";

export interface PickerAnswered {
	/** The session whose Picker was answered. */
	sessionFile: string | undefined;
}

/** OMP's `ADVISOR_ACK_DEFERRED`: the `advise` result for a note held until the final answer. */
const DEFERRED_ACK = "Queued for the end of the turn. Do not re-raise.";
/** OMP's `ADVISOR_GUIDANCE`, part of every `<advisory>` element. */
const ADVISOR_GUIDANCE = "weigh, don't blindly obey";
const TRANSCRIPT_NAME = /^__advisor(\..+)?\.jsonl$/;

/** Byte size of each advisor transcript of a session; a run's deferred notes are appended after these. */
export type TranscriptSizes = ReadonlyMap<string, number>;

function transcriptFiles(sessionFile: string | undefined): string[] {
	if (!sessionFile?.endsWith(".jsonl")) return [];
	const dir = sessionFile.slice(0, -".jsonl".length);
	try {
		return fs
			.readdirSync(dir)
			.filter(name => TRANSCRIPT_NAME.test(name))
			.map(name => path.join(dir, name));
	} catch {
		return [];
	}
}

export function transcriptSizes(sessionFile: string | undefined): TranscriptSizes {
	const sizes = new Map<string, number>();
	for (const file of transcriptFiles(sessionFile)) {
		try {
			sizes.set(file, fs.statSync(file).size);
		} catch {}
	}
	return sizes;
}

function readFrom(file: string, offset: number): string {
	const fd = fs.openSync(file, "r");
	try {
		const length = fs.fstatSync(fd).size - offset;
		if (length <= 0) return "";
		const buffer = Buffer.alloc(length);
		fs.readSync(fd, buffer, 0, length, offset);
		return buffer.toString("utf8");
	} finally {
		fs.closeSync(fd);
	}
}

interface TranscriptEntry {
	message?: {
		role?: string;
		toolName?: string;
		content?: { type?: string; text?: string }[];
		details?: { note?: unknown; severity?: unknown; advisor?: unknown };
	};
}

/**
 * Concerns that OMP deferred after `sizes` was taken, in transcript order,
 * one per note text. Synchronous, so a caller can queue them before the tool
 * that waits on the user returns.
 */
export function readDeferredConcerns(sessionFile: string | undefined, sizes: TranscriptSizes): AdvisorNote[] {
	const notes = new Map<string, AdvisorNote>();
	for (const file of transcriptFiles(sessionFile)) {
		let text: string;
		try {
			text = readFrom(file, sizes.get(file) ?? 0);
		} catch {
			continue;
		}
		for (const line of text.split("\n")) {
			if (!line.includes(DEFERRED_ACK)) continue;
			let entry: TranscriptEntry;
			try {
				entry = JSON.parse(line);
			} catch {
				// The recorder can be mid-write on the last line.
				continue;
			}
			const message = entry.message;
			if (message?.role !== "toolResult" || message.toolName !== "advise") continue;
			if (!message.content?.some(part => part.type === "text" && part.text === DEFERRED_ACK)) continue;
			const { note, severity, advisor } = message.details ?? {};
			if (severity !== "concern" || typeof note !== "string" || notes.has(note)) continue;
			notes.set(note, typeof advisor === "string" ? { note, severity, advisor } : { note, severity });
		}
	}
	return [...notes.values()];
}

/** The agent-facing body of an advisor card, as OMP's `formatAdvisorBatchContent` builds it. */
export function formatAdvisories(notes: readonly AdvisorNote[]): string {
	return notes
		.map(n => {
			const severity = n.severity ? ` severity="${n.severity}"` : "";
			const who = n.advisor ? ` advisor="${escapeXmlAttribute(n.advisor)}"` : "";
			return `<advisory${who}${severity} guidance="${ADVISOR_GUIDANCE}">\n${escapeXmlText(n.note)}\n</advisory>`;
		})
		.join("\n");
}
