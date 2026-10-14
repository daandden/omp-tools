import { describe, expect, test } from "bun:test";

const { parseBtwQuestion } = await import("../extensions/btw");

describe("parseBtwQuestion", () => {
	test("takes the question after /btw", () => {
		expect(parseBtwQuestion("/btw why is the picker slow?")).toBe("why is the picker slow?");
	});

	test("keeps every line of a multi-line question", () => {
		expect(parseBtwQuestion("/btw   first line\nsecond line  ")).toBe("first line\nsecond line");
	});

	test("takes a question that starts on the next line", () => {
		expect(parseBtwQuestion("/btw\nwhat changed?")).toBe("what changed?");
	});

	test("leaves bare /btw to native /btw, which opens its history", () => {
		expect(parseBtwQuestion("/btw")).toBeUndefined();
		expect(parseBtwQuestion("/btw   ")).toBeUndefined();
		expect(parseBtwQuestion("/btw why")).toBe("why");
	});

	test("leaves other commands and plain messages alone", () => {
		expect(parseBtwQuestion("/btwx why")).toBeUndefined();
		expect(parseBtwQuestion("/bt why")).toBeUndefined();
		expect(parseBtwQuestion("btw why")).toBeUndefined();
		expect(parseBtwQuestion(" /btw why")).toBeUndefined();
		expect(parseBtwQuestion("/btw why")).toBe("why");
	});
});
