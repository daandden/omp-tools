import { expect, test } from "bun:test";
import { readClipboardPaste } from "../extensions/ask-images";

test("clipboard paste over SSH asks the user to paste from their terminal", async () => {
	const keys = ["SSH_CONNECTION", "SSH_TTY", "SSH_CLIENT"] as const;
	const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
	try {
		for (const key of keys) delete process.env[key];
		for (const key of keys) {
			process.env[key] = key === "SSH_TTY" ? "/dev/pts/7" : "192.0.2.1 12345 192.0.2.2 22";
			expect(await readClipboardPaste(process.cwd())).toEqual({
				error: "Clipboard here belongs to the SSH host — use your terminal's paste shortcut to paste from your machine",
			});
			delete process.env[key];
		}
	} finally {
		for (const key of keys) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	}
});
