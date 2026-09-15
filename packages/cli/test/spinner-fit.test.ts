import { describe, expect, it } from "vitest";
import { fitSpinnerMessage } from "../src/prompts.js";

describe("fitSpinnerMessage", () => {
	const message = "reviewing (55/200 steps · 1.2M/2.0M tokens · $3.25)";

	it("leaves a message alone when it fits with the spinner's frame and dots", () => {
		expect(fitSpinnerMessage(message, 80)).toBe(message);
		expect(fitSpinnerMessage(message, message.length + 7)).toBe(message);
	});

	it("truncates a message that would wrap once clack adds its frame and dots", () => {
		const fitted = fitSpinnerMessage(message, 55);
		expect(fitted).toBe("reviewing (55/200 steps · 1.2M/2.0M tokens · $3…");
		expect(fitted.length + 7).toBeLessThanOrEqual(55);
	});

	it("assumes 80 columns when the stream has none, and never truncates to nothing", () => {
		expect(fitSpinnerMessage("x".repeat(100), undefined)).toHaveLength(73);
		expect(fitSpinnerMessage(message, 4)).toBe(message);
	});
});
