/// <reference types="bun" />
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(process.argv[2] ?? (() => { throw new Error("Usage: bun english-coach-provider.ts RUN_DIR"); })());
const scenario = process.argv[3];
if (scenario) {
	const prompts = JSON.parse(readFileSync(`${dir}/prompts.json`, "utf8"));
	if (!(scenario in prompts)) throw new Error(`Unknown smoke scenario: ${scenario}`);
	const socket = `${readFileSync(`${dir}/tern/sock-dir`, "utf8").trim()}/ctl.sock`;
	const value = prompts[scenario].replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
	const result = Bun.spawnSync(["tern", "ctl", "--control", socket, "type", `"\x1b[200~${value}\x1b[201~"`]);
	process.stdout.write(result.stdout);
	process.stderr.write(result.stderr);
	process.exit(result.exitCode);
}
mkdirSync(`${dir}/data/agent`, { recursive: true });
mkdirSync(`${dir}/data/project`, { recursive: true });
const correction = "Better: It doesn't work.\nit not work → It doesn't work (Missing auxiliary verb)";
const mistakes = [
	["it not work in login page", "It doesn't work on the login page", "Auxiliary verb, preposition, missing article"],
	["user input wrong password", "A user enters the wrong password", "Missing article, subject-verb agreement"],
	["yesterday I find issue", "Yesterday I found an issue", "Past tense, missing article"],
	["she have same problem", "She has the same problem", "Subject-verb agreement, missing article"],
	["we needs more informations", "We need more information", "Subject-verb agreement, uncountable noun"],
	["please explain me error", "Please explain the error to me", "Verb construction, missing article"],
	["I am agree with solution", "I agree with the solution", "Unnecessary auxiliary verb, missing article"],
	["can you helps us", "Can you help us", "Base verb after modal"],
	["there is two buttons", "There are two buttons", "Plural subject-verb agreement"],
	["he didn't changed anything", "He didn't change anything", "Base verb after auxiliary"],
	["this are better then before", "This is better than before", "Demonstrative agreement, comparison"],
	["I look forward to hear", "I look forward to hearing", "Gerund after preposition"],
];
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/chat/completions") {
			return new Response("Not found", { status: 404 });
		}
		const body = await request.json() as Record<string, any>;
		appendFileSync(`${dir}/requests.jsonl`, `${JSON.stringify({ at: Date.now(), ...body })}\n`);
		const prompt = body.messages.findLast((message: any) => message.role === "user")?.content ?? "";
		let reply = body.model === "side" ? "Local Side question answer." : "Local main answer.";
		if (body.model === "tiny") {
			await Bun.sleep(1200);
			if (prompt.includes("login page")) {
				reply = `Better: ${mistakes.map(([, corrected]) => corrected).join(". ")}.\n${mistakes.map(([original, corrected, pattern]) => `${original} → ${corrected} (${pattern})`).join("\n")}`;
			} else if (prompt.includes("[[COACH_")) {
				reply = `Better: It doesn't work. ${prompt.match(/\[\[COACH_+\d+\]\]/g)?.join(" ") ?? ""}\nit not work → It doesn't work (Missing auxiliary verb)`;
			} else reply = prompt.includes("it not work") ? correction : "No mistakes";
		}
		const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null) =>
			`data: ${JSON.stringify({ id: "coach-smoke", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
		return new Response(chunk({ role: "assistant", content: reply }) + chunk({}, "stop") +
			`data: ${JSON.stringify({ id: "coach-smoke", choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\ndata: [DONE]\n\n`,
			{ headers: { "content-type": "text/event-stream" } });
	},
});
const models = ["main", "tiny", "side"].map(id => ({
	id, name: id, reasoning: false, input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096,
}));
await Bun.write(`${dir}/provider.ts`, `export default function(pi) {
	pi.registerProvider("coach-smoke", { baseUrl: "http://127.0.0.1:${server.port}/v1", apiKey: "local-only", api: "openai-completions", models: ${JSON.stringify(models)} });
}`);
await Bun.write(`${dir}/smoke-config.yml`, `advisor:\n  enabled: false\nmarketplace:\n  autoUpdate: off\ncompaction:\n  enabled: false\nretry:\n  enabled: false\n  modelFallback: false\nmodelRoles:\n  default: coach-smoke/main\n  smol: coach-smoke/side\n  tiny: coach-smoke/tiny\n  slow: coach-smoke/main\n  plan: coach-smoke/main\n`);
await Bun.write(`${dir}/prompts.json`, JSON.stringify({
	mistakes: mistakes.map(([original]) => original).join("; "),
	correct: "This works correctly.",
	over: "Please check this sentence. ".repeat(400),
	fence: `it not work\n\`\`\`ts\n${Array.from({ length: 500 }, (_, i) => `const value${i} = ${i};`).join("\n")}\n\`\`\``,
	btw: "/btw why it not work?",
	model: "/model coach-smoke/main",
}, null, 2));
console.log(`ready: http://127.0.0.1:${server.port} run ${dir}`);
