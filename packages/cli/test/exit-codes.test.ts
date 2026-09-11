import { ConfigError } from "@gribble/core";
import { describe, expect, it } from "vitest";
import { run } from "../src/index.js";
import { finding, project, report, testIo } from "./helpers.js";

function base(io: ReturnType<typeof testIo>) {
	return {
		context: io.context,
		loadProject: async () => project(),
		git: { info: async () => ({}), changedFiles: async () => [] },
	};
}

describe("exit codes", () => {
	it("0 when the gate passes", async () => {
		const io = testIo();
		const code = await run(["audit", "--mode", "gate"], { ...base(io), runAudit: async () => report([]) });
		expect(code).toBe(0);
		expect(io.stdout.text).toContain("The gribbles went hungry. Ship it.");
	});

	it("1 when the gate fails", async () => {
		const io = testIo();
		const failing = report([
			finding({
				rule: "links/broken",
				route: "/pricing",
				title: "/docs/plans returns 404",
				severity: "error",
			}),
		]);
		const code = await run(["audit", "--mode", "gate"], { ...base(io), runAudit: async () => failing });
		expect(code).toBe(1);
		expect(io.stdout.text).toContain("patching before you sail");
	});

	it("2 on a ConfigError from core, with the message and a hint", async () => {
		const io = testIo();
		const code = await run(["audit", "--mode", "gate"], {
			...base(io),
			loadProject: async () => {
				throw new ConfigError("no .gribble/gribble.yaml in /repo", { file: ".gribble/gribble.yaml" });
			},
		});
		expect(code).toBe(2);
		expect(io.stderr.text).toContain("error: .gribble/gribble.yaml: no .gribble/gribble.yaml in /repo");
		expect(io.stderr.text).toContain("gribble init");
	});

	it("2 on a model auth error (matched by name), with the login hint", async () => {
		const io = testIo();
		class ModelAuthError extends Error {
			override name = "ModelAuthError";
		}
		const code = await run(["audit"], {
			...base(io),
			createModelRuntime: async () => ({}) as never,
			readSettingsModel: async () => undefined,
			resolveModel: async () => {
				throw new ModelAuthError(
					"Model prov/x needs credentials for prov. Run `gribble login prov` or set PROV_API_KEY.",
				);
			},
			runAudit: async () => report([]),
		});
		expect(code).toBe(2);
		expect(io.stderr.text).toContain("needs credentials for prov");
		expect(io.stderr.text).toContain("gribble login");
	});

	it("2 when a prompt would be needed without a terminal", async () => {
		const io = testIo();
		const code = await run(["login"], {
			context: io.context,
			createModelRuntime: async () =>
				({
					getProviders: () => [
						{ id: "prov", name: "Prov", auth: { apiKey: { name: "k", login: async () => ({}) } } },
					],
					checkAuth: async () => undefined,
				}) as never,
		});
		expect(code).toBe(2);
		expect(io.stderr.text).toContain("needs a terminal");
	});

	it("3 on an unexpected crash, with the stack only in --verbose", async () => {
		const quiet = testIo();
		const boom = async () => {
			throw new Error("kaboom");
		};
		expect(await run(["audit", "--mode", "gate"], { ...base(quiet), runAudit: boom })).toBe(3);
		expect(quiet.stderr.text).toContain("Unexpected error. kaboom");
		expect(quiet.stderr.text).not.toMatch(/\n\s+at /);

		const loud = testIo();
		expect(await run(["--verbose", "audit", "--mode", "gate"], { ...base(loud), runAudit: boom })).toBe(3);
		expect(loud.stderr.text).toContain("kaboom");
		expect(loud.stderr.text).toMatch(/\n\s+at /);
	});

	it("--ci keeps stdout for the report only, even when the gate fails", async () => {
		const io = testIo({ env: { CI: "true" } });
		const failing = report([
			finding({ rule: "links/broken", route: "/", title: "dead", severity: "critical" }),
		]);
		const code = await run(["audit", "--ci", "--mode", "gate"], {
			...base(io),
			runAudit: async () => failing,
		});
		expect(code).toBe(1);
		const parsed = JSON.parse(io.stdout.text);
		expect(parsed.summary.gate).toBe("fail");
		expect(io.stderr.text).toContain("nibbling");
		expect(io.stderr.text).not.toMatch(/\[[0-9;]*m/);
	});
});
