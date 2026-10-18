import { describe, expect, test } from "bun:test";
import { numberImagesByAppearance } from "../extensions/picker-btw";

const image = (data: string) => ({ type: "image" as const, mimeType: "image/png", data });

describe("numberImagesByAppearance", () => {
	test("numbers the images the question still mentions, in text order", () => {
		const result = numberImagesByAppearance("compare [Image #3] with [Image #2]", [
			{ label: "[Image #1]", image: image("one") },
			{ label: "[Image #2]", image: image("two") },
			{ label: "[Image #3]", image: image("three") },
		]);
		expect(result.text).toBe("compare [Image #1] with [Image #2]");
		expect(result.images.map(item => item.data)).toEqual(["three", "two"]);
	});

	test("leaves typed labels that name no pasted image as they are", () => {
		const result = numberImagesByAppearance("what is [Image #9]?", [{ label: "[Image #4]", image: image("four") }]);
		expect(result).toEqual({ text: "what is [Image #9]?", images: [] });
	});
});
