import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fakeContext, imagesOf, loadTool, outputPathsOf, textOf } from "./support";

const apiKey = process.env.OPENAI_API_KEY;
const live = process.env.OMP_TOOLS_LIVE_IMAGES === "1" && Boolean(apiKey);
const TIMEOUT_MS = 5 * 60 * 1000;

let savedFiles: string[] = [];

afterEach(() => {
	for (const file of savedFiles) fs.rmSync(file, { force: true });
	savedFiles = [];
});

async function run(params: Record<string, unknown>) {
	const tool = await loadTool({ imageGenerationMode: "openai" });
	const result = await tool.execute("live", params, undefined, undefined, fakeContext({ credentials: { openai: apiKey } }));
	savedFiles.push(...outputPathsOf(result));
	return result;
}

describe.skipIf(!live)("GPT Image 2.6 Sunburst, live", () => {
	test(
		"generates a still image with complexity",
		async () => {
			const result = await run({ prompt: "A red apple on a white table.", quality: "low", size: "1024x1024", complexity: "low" });

			const [image] = imagesOf(result);
			expect(image?.mimeType).toBe("image/webp");
			expect(result.details).toMatchObject({ requested: { model: "gpt-image-2.6-sunburst", complexity: "low" } });
		},
		TIMEOUT_MS,
	);

	test(
		"generates an SVG with the default SVG author and reports its usage",
		async () => {
			const result = await run({ prompt: "A flat logo: one blue circle on white.", quality: "low", output_format: "svg" });

			const [saved] = outputPathsOf(result);
			expect(path.extname(saved ?? "")).toBe(".svg");
			expect(await Bun.file(saved ?? "").text()).toContain("<svg");
			expect(imagesOf(result)).toHaveLength(0);
			expect(textOf(result)).toContain(saved ?? "missing");
			expect(result.details).toMatchObject({ svgUsage: { model: expect.stringContaining("gpt-6.1-sol") } });
		},
		TIMEOUT_MS,
	);

	test(
		"generates an animated GIF",
		async () => {
			const result = await run({
				prompt: "A small red ball bounces once and returns to its starting point. The camera stays still.",
				quality: "low",
				size: "512x512",
				output_format: "gif",
				frame_count: 2,
				frame_duration_ms: 200,
			});

			const [image] = imagesOf(result);
			expect(image?.mimeType).toBe("image/gif");
			expect(path.extname(outputPathsOf(result)[0] ?? "")).toBe(".gif");
		},
		TIMEOUT_MS,
	);
});
