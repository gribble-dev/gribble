import { describe, expect, it } from "vitest";
import { buildLoginPrompt, buildLoginSystemPrompt, buildSystemPrompt } from "../src/index.js";
import { fakeProject } from "./agent-helpers.js";

describe("login prompts", () => {
	it("names the profile, the allowed origins and the secret_env rule", () => {
		const project = fakeProject();
		const system = buildLoginSystemPrompt({ config: project.config, profile: "user" });
		expect(system).toContain('"user" user');
		expect(system).toContain("`localhost`");
		expect(system).toContain("`*.vercel.app`");
		expect(system).toContain("secret_env");
		expect(system).toContain("flow_end");
	});

	it("lists credential variable names and the flow body", () => {
		const prompt = buildLoginPrompt({
			flow: { name: "login", file: "/x/login.md", description: "1. Open /login\n2. Sign in" },
			envNames: ["GRIBBLE_USER_EMAIL", "GRIBBLE_USER_PASSWORD"],
			targetUrl: "http://localhost:3000",
		});
		expect(prompt).toContain("`GRIBBLE_USER_EMAIL`, `GRIBBLE_USER_PASSWORD`");
		expect(prompt).toContain("1. Open /login\n2. Sign in");
		expect(prompt).toContain('flow_start({ name: "login" })');
	});

	it("the system prompt still names the tools the packs register", () => {
		const project = fakeProject();
		const system = buildSystemPrompt({ guidelines: "", config: project.config, vision: false });
		for (const tool of [
			"page_snapshot",
			"screenshot",
			"map_dom_to_source",
			"add_finding",
			"finalize_report",
		]) {
			expect(system).toContain(`\`${tool}\``);
		}
	});
});
