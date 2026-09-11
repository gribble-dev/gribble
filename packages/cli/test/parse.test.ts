import { describe, expect, it } from "vitest";
import type { AuditOptionsWithModel } from "../src/deps.js";
import { run } from "../src/index.js";
import { project, report, resolution, testIo } from "./helpers.js";

function captureAudit() {
	const calls: AuditOptionsWithModel[] = [];
	const io = testIo();
	const overrides = {
		context: io.context,
		loadProject: async () => project(),
		runAudit: async (options: AuditOptionsWithModel) => {
			calls.push(options);
			return report([]);
		},
		createModelRuntime: async () => {
			throw new Error("runtime should not be created in gate mode");
		},
		git: { info: async () => ({}), changedFiles: async () => [] },
	};
	return { calls, io, overrides };
}

describe("argument parsing", () => {
	it("prints help and exits 0", async () => {
		const io = testIo();
		const code = await run(["--help"], { context: io.context });
		expect(code).toBe(0);
		expect(io.stdout.text).toContain("Usage: gribble");
		expect(io.stdout.text).toContain("audit");
		expect(io.stdout.text).toContain("baseline");
	});

	it("prints the version for `version` and `--version`", async () => {
		const a = testIo();
		expect(await run(["version"], { context: a.context, version: "9.9.9" })).toBe(0);
		expect(a.stdout.text.trim()).toBe("9.9.9");
		const b = testIo();
		expect(await run(["--version"], { context: b.context, version: "9.9.9" })).toBe(0);
		expect(b.stdout.text.trim()).toBe("9.9.9");
	});

	it("rejects an unknown command with exit 2", async () => {
		const io = testIo();
		expect(await run(["frobnicate"], { context: io.context })).toBe(2);
		expect(io.stderr.text).toContain("unknown command");
	});

	it("rejects an invalid --mode with exit 2", async () => {
		const io = testIo();
		expect(await run(["audit", "--mode", "bogus"], { context: io.context })).toBe(2);
		expect(io.stderr.text).toContain("expected one of gate, review, all");
	});

	it("passes audit flags through to runAudit", async () => {
		const { calls, overrides } = captureAudit();
		const code = await run(
			[
				"audit",
				"--mode",
				"gate",
				"--ci",
				"--routes",
				"/,/pricing, /blog/[slug]",
				"--update-baseline",
				"--env",
				"preview",
			],
			overrides,
		);
		expect(code).toBe(0);
		expect(calls).toHaveLength(1);
		const call = calls[0]!;
		expect(call.mode).toBe("gate");
		expect(call.ci).toBe(true);
		expect(call.updateBaseline).toBe(true);
		expect(call.routes).toEqual(["/", "/pricing", "/blog/[slug]"]);
		expect(call.model).toBeUndefined();
		expect(call.project.config.target.url).toBe("http://localhost:3000");
	});

	it("defaults to --mode all and resolves a model first", async () => {
		const { calls, overrides, io } = captureAudit();
		const code = await run(["audit", "--json"], {
			...overrides,
			createModelRuntime: async () => ({}) as never,
			readSettingsModel: async () => undefined,
			resolveModel: async () => resolution("prov", "model-x"),
		});
		expect(code).toBe(0);
		expect(calls[0]?.mode).toBe("all");
		expect(calls[0]?.model?.model.id).toBe("model-x");
		// --json: report on stdout, everything else on stderr
		expect(JSON.parse(io.stdout.text).version).toBe(1);
		expect(io.stderr.text).toContain("gribbles are nibbling");
	});

	it("`baseline update` runs a gate audit with updateBaseline", async () => {
		const { calls, overrides } = captureAudit();
		expect(await run(["baseline", "update"], overrides)).toBe(0);
		expect(calls[0]?.mode).toBe("gate");
		expect(calls[0]?.updateBaseline).toBe(true);
	});

	it("`--all` audits every discovered target and prints an array in --ci mode", async () => {
		const { calls, overrides, io } = captureAudit();
		const code = await run(["audit", "--all", "--ci", "--mode", "gate"], {
			...overrides,
			findGribbleDirs: async () => [
				`${io.context.cwd}/apps/web/.gribble`,
				`${io.context.cwd}/apps/docs/.gribble`,
			],
			loadProject: async ({ target }) => project({ targetName: target }),
		});
		expect(code).toBe(0);
		expect(calls.map((c) => c.project.targetName)).toEqual(["apps/web", "apps/docs"]);
		const parsed = JSON.parse(io.stdout.text);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed).toHaveLength(2);
	});

	it("`--changed` forwards git base and changed files", async () => {
		const { calls, overrides } = captureAudit();
		await run(["audit", "--mode", "gate", "--changed"], {
			...overrides,
			git: {
				info: async () => ({ commit: "abc", branch: "feat", baseCommit: "base", baseRef: "origin/main" }),
				changedFiles: async () => ["src/routes/pricing.tsx"],
			},
		});
		expect(calls[0]?.changedFiles).toEqual(["src/routes/pricing.tsx"]);
		expect(calls[0]?.git).toEqual({ commit: "abc", branch: "feat", baseCommit: "base", remote: undefined });
	});

	it("`explain` prints the rule and exits 2 for an unknown one", async () => {
		const ok = testIo();
		expect(await run(["explain", "links/broken"], { context: ok.context })).toBe(0);
		expect(ok.stdout.text).toContain("links/broken");
		expect(ok.stdout.text).toContain("Fix:");
		const bad = testIo();
		expect(await run(["explain", "links/nope"], { context: bad.context })).toBe(2);
		expect(bad.stdout.text).toContain('Unknown rule "links/nope"');
	});
});
