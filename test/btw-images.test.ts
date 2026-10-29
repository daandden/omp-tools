import { beforeAll, expect, test } from "bun:test";
import type { ImageContent } from "@oh-my-pi/pi-ai";
import { Settings, type ExtensionAPI, type ExtensionContext, type InputEvent } from "@oh-my-pi/pi-coding-agent";
import type { Component, TUI } from "@oh-my-pi/pi-tui";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import btw from "../extensions/btw";
import { sideQuestionFixture } from "./helpers/side-question-session";
import { encodePng } from "./support";

beforeAll(async () => {
	await Settings.init({ inMemory: true });
	await initTheme();
});

test("registered /btw input sends images to the model and keeps them for follow-ups without accepting overlap", async () => {
	const first: ImageContent = {
		type: "image", mimeType: "image/png", data: Buffer.from(encodePng(6, 3, () => [255, 0, 0, 255])).toString("base64"),
	};
	const second: ImageContent = {
		type: "image", mimeType: "image/png", data: Buffer.from(encodePng(3, 6, () => [0, 0, 255, 255])).toString("base64"),
	};
	const fixture = await sideQuestionFixture({
		async reply(body) {
			const urls = body.messages.flatMap((message: any) => Array.isArray(message.content)
				? message.content.filter((part: any) => part.type === "image_url").map((part: any) => part.image_url.url)
				: []);
			const seen = await Promise.all(urls.map(async (url: string) => {
				const bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
				const image = await new Bun.Image(bytes).metadata();
				if (image.width === image.height * 2) return "first";
				if (image.height === image.width * 2) return "second";
				return `unexpected ${image.width}x${image.height}`;
			}));
			const priorAnswer = body.messages.some((message: any) => message.role === "assistant" && message.content === "received first; prior answer=false");
			return `received ${seen.join(", ") || "no images"}; prior answer=${priorAnswer}`;
		},
	});
	const handlers = new Map<string, (event: any, ctx: ExtensionContext) => unknown>();
	btw({ on(event: string, handler: (event: any, ctx: ExtensionContext) => unknown) { handlers.set(event, handler); } } as ExtensionAPI);
	let panel: Component | undefined;
	const warnings: string[] = [];
	const tui = { terminal: { rows: 100, columns: 160, write() {} }, requestRender() {} } as unknown as TUI;
	const ctx = {
		...fixture.ctx,
		mode: "tui", hasUI: true,
		ui: {
			onTerminalInput: () => () => {},
			getEditorText: () => "",
			notify: (message: string) => warnings.push(message),
			setWidget: (_key: string, factory: ((tui: TUI) => Component) | undefined) => { panel = factory?.(tui); },
		},
	} as unknown as ExtensionContext;
	const input = (text: string, images?: ImageContent[], source: InputEvent["source"] = "interactive") =>
		handlers.get("input")!({ type: "input", text, images, source }, ctx);
	const answer = async () => {
		for (let attempt = 0; attempt < 250; attempt++) {
			const rendered = panel?.render(160).join("\n") ?? "";
			if (rendered.includes("to close")) return rendered;
			await Bun.sleep(20);
		}
		throw new Error(`Side question did not finish: ${panel?.render(160).join("\n")}`);
	};
	try {
		expect(input("/btw", [first])).toBeUndefined();
		expect(input("/btw native RPC", [first], "rpc")).toBeUndefined();
		expect(fixture.requests).toHaveLength(0);
		expect(input("/btw inspect the first image", [first])).toEqual({ handled: true });
		expect(input("/btw overlapping image must not replace the first", [second])).toEqual({ handled: true });
		expect(await answer()).toContain("received first; prior answer=false");
		expect(warnings).toEqual(["Wait for the side question's answer, or press Esc to cancel it."]);
		expect(fixture.requests).toHaveLength(1);
		expect(input("/btw compare with the second image", [second])).toEqual({ handled: true });
		expect(await answer()).toContain("received first, second; prior answer=true");
		expect(fixture.requests).toHaveLength(2);
		expect(JSON.stringify(fixture.requests[1])).not.toContain("overlapping image must not replace the first");
	} finally {
		handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx);
		await fixture.dispose();
	}
}, 30_000);
