import { describe, expect, it } from "vitest";
import { InputError, parseInputs } from "../src/inputs.js";

function getter(values: Record<string, string>): (name: string) => string {
	return (name) => values[name] ?? "";
}

describe("parseInputs", () => {
	it("applies the defaults from action.yml", () => {
		const inputs = parseInputs(getter({ "github-token": "t" }));
		expect(inputs).toEqual({
			mode: "all",
			workingDirectory: "",
			all: false,
			updateBaseline: false,
			comment: true,
			maxComments: 5,
			failOn: "error",
			githubToken: "t",
			reportArtifact: true,
		});
	});

	it("parses every input", () => {
		const inputs = parseInputs(
			getter({
				mode: "gate",
				"working-directory": "./apps/web/",
				target: "apps/web",
				environment: "preview",
				"update-baseline": "true",
				comment: "false",
				"max-comments": "12",
				"fail-on": "warn",
				"github-token": "tok",
				"report-artifact": "False",
			}),
		);
		expect(inputs.mode).toBe("gate");
		expect(inputs.workingDirectory).toBe("apps/web");
		expect(inputs.target).toBe("apps/web");
		expect(inputs.environment).toBe("preview");
		expect(inputs.updateBaseline).toBe(true);
		expect(inputs.comment).toBe(false);
		expect(inputs.maxComments).toBe(12);
		expect(inputs.failOn).toBe("warn");
		expect(inputs.reportArtifact).toBe(false);
	});

	it("treats '.' as the repository root", () => {
		expect(parseInputs(getter({ "working-directory": "." })).workingDirectory).toBe("");
	});

	it("rejects invalid enums and numbers", () => {
		expect(() => parseInputs(getter({ mode: "yolo" }))).toThrow(InputError);
		expect(() => parseInputs(getter({ "fail-on": "sometimes" }))).toThrow(/fail-on/);
		expect(() => parseInputs(getter({ "max-comments": "-1" }))).toThrow(/max-comments/);
		expect(() => parseInputs(getter({ "max-comments": "many" }))).toThrow(/max-comments/);
		expect(() => parseInputs(getter({ comment: "yes" }))).toThrow(/comment/);
	});

	it("is case-insensitive for enums", () => {
		expect(parseInputs(getter({ mode: "Review", "fail-on": "NONE" }))).toMatchObject({
			mode: "review",
			failOn: "none",
		});
	});

	it("rejects all + target together", () => {
		expect(() => parseInputs(getter({ all: "true", target: "apps/web" }))).toThrow(/cannot be combined/);
	});

	it("allows max-comments 0", () => {
		expect(parseInputs(getter({ "max-comments": "0" })).maxComments).toBe(0);
	});
});
