/**
 * Integration check of `createGribbleSession` against the real pi SDK, offline: no prompt is
 * sent, so no model call happens. Verifies the allowlist/activation dance and the read-only
 * built-in tool set.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	ALL_PACK_TOOLS,
	BUILTIN_TOOLS,
	CORE_TOOLS,
	createGribbleSession,
	createModelRuntime,
	LOADER_TOOL,
} from "../src/index.js";
import { fakeBrowser, fakeProject, withTempDir } from "./agent-helpers.js";

describe("createGribbleSession", () => {
	it("registers every pack tool, activates only the core set, and never enables edit/write/bash", async () => {
		await withTempDir(async (dir) => {
			const agentDir = join(dir, "agent");
			await mkdir(agentDir, { recursive: true });
			const runtime = await createModelRuntime({ agentDir, env: {} });
			const anyModel = runtime.getModels()[0];
			if (!anyModel) throw new Error("pi ships no models; cannot run this test");

			const project = fakeProject({ dir });
			const gribble = await createGribbleSession({
				project,
				targetName: "",
				browser: fakeBrowser(),
				agentDir,
				ci: true,
				model: { model: anyModel },
				modelRuntime: runtime,
				env: {},
				runDir: join(dir, "run"),
				deterministicSummary: "- **links/broken** (1)",
			});
			try {
				const active = gribble.session.agent.state.tools.map((t) => t.name).sort();
				const expected = [...BUILTIN_TOOLS, ...CORE_TOOLS, "set_viewport"].sort();
				expect(active).toEqual(expected);
				expect(active).not.toContain("bash");
				expect(active).not.toContain("edit");
				expect(active).not.toContain("write");
				expect(active).toContain(LOADER_TOOL);

				const registered = gribble.session.getAllTools().map((t) => t.name);
				for (const name of ALL_PACK_TOOLS) {
					if (name === "screenshot") continue; // vision is off
					expect(registered, name).toContain(name);
				}
				expect(registered).not.toContain("screenshot");
				expect(gribble.session.agent.state.systemPrompt).toContain("# Gribble");
				expect(gribble.session.agent.state.systemPrompt).toContain("`finalize_report`");
				expect(gribble.state.deterministicSummary).toBe("- **links/broken** (1)");
			} finally {
				await gribble.dispose();
			}
		});
	});
});
