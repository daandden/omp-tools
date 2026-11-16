export interface PreparedCoachPrompt {
	text: string;
	englishText: string;
	placeholders: { token: string; display: string }[];
}

export function prepareCoachPrompt(input: string, promptCommandNames: ReadonlySet<string>): PreparedCoachPrompt | undefined {
	const command = /^\/(\S*)(?:\s+([\s\S]*))?$/.exec(input.trimStart());
	if (command) {
		const name = command[1]!;
		if (name !== "btw" && !/^skill:.+/.test(name) && !promptCommandNames.has(name)) return undefined;
		input = command[2] ?? "";
	}
	if (!input.trim()) return undefined;
	const placeholders: PreparedCoachPrompt["placeholders"] = [];
	let prefix = "[[COACH_";
	while (input.includes(prefix)) prefix = prefix.replace("COACH", "COACH_");
	const protectedText = /^ {0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)|(`+)(?!`)[\s\S]*?(?<!`)\2(?!`)|\b[a-z][a-z\d+.-]*:\/\/[^\s<>`]+|(?:\b[A-Za-z]:[\\/]|\\\\|~?\/|\.{1,2}[\\/]|\b[\w.-]+[\\/])[^\s<>`]+|\b[\w-]+\.[a-zA-Z\d]{1,12}\b|\[\[COACH_+\d+\]\]/gim;
	let englishText = "";
	let text = "";
	let end = 0;
	for (let match = protectedText.exec(input); match; match = protectedText.exec(input)) {
		const start = match.index;
		let display = match[0];
		if (match[1]) {
			const fence = match[1];
			const closing = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[\\t ]*(?=\\r?$)`, "gm");
			closing.lastIndex = protectedText.lastIndex;
			const close = closing.exec(input);
			const body = input.slice(protectedText.lastIndex, close?.index ?? input.length);
			const count = body ? body.replace(/\r?\n$/, "").split(/\r?\n/).length : 0;
			display = `\n[code block, ${count} lines]\n`;
			protectedText.lastIndex = close ? closing.lastIndex : input.length;
		}
		const token = `${prefix}${placeholders.length + 1}]]`;
		text += input.slice(end, start) + token;
		englishText += `${input.slice(end, start)} `;
		end = protectedText.lastIndex;
		placeholders.push({ token, display });
	}
	text += input.slice(end);
	englishText += input.slice(end);
	return { text, englishText, placeholders };
}

export function restoreCoachReply(lines: string[], prompt: PreparedCoachPrompt): string[] {
	if (lines[0]?.startsWith("Better:")) {
		const tokens = lines[0].match(/\[\[COACH_+\d+\]\]/g) ?? [];
		if (tokens.length !== prompt.placeholders.length || tokens.some((token, index) => token !== prompt.placeholders[index]!.token)) {
			throw new Error("unreadable reply");
		}
	}
	const originals = new Map(prompt.placeholders.map(item => [item.token, item.display]));
	return lines.flatMap(line => line.replace(/\[\[COACH_+\d+\]\]/g, token => {
		const display = originals.get(token);
		if (display === undefined) throw new Error("unreadable reply");
		return display;
	}).split(/\r?\n/))
		.map(line => line.trimEnd()).filter(Boolean);
}
