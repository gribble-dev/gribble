#!/usr/bin/env node
/**
 * Proves the gate half of Gribble installs and runs without the AI review runtime.
 *
 * `@earendil-works/pi-*` are optional peer dependencies (see `packages/core/src/pi.ts`), and no
 * package manager installs those on its own. This packs the published packages, installs them
 * into a throwaway project where the pi packages are therefore absent, and checks that:
 *
 *   - nothing under `@earendil-works/` made it onto disk;
 *   - `gribble --help`, `gribble explain <rule>` and `gribble audit --mode gate` against the
 *     fixture site all work;
 *   - `gribble audit --mode review` and `gribble login` fail with the install command rather
 *     than a module-resolution stack trace.
 *
 * It prints the installed package count so the win is measurable. Run it after `pnpm build`:
 *
 *   node scripts/verify-gate-only-install.mjs
 *
 * Playwright browsers are not downloaded; the run reuses whatever cache the repository already
 * populated with `pnpm exec playwright install chromium`.
 */
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSiteServer } from "../packages/core/test/fixtures/serve-site.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGES = ["@gribble/core", "@gribble/skills", "gribble"];
const RULE = "links/broken";

const failures = [];

function check(label, ok, detail) {
	console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
	if (!ok) {
		failures.push(label);
		if (detail) console.log(detail.replace(/^/gm, "        "));
	}
}

function run(command, args, opts = {}) {
	try {
		const stdout = execFileSync(command, args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			...opts,
		});
		return { code: 0, stdout, stderr: "" };
	} catch (err) {
		return {
			code: typeof err.status === "number" ? err.status : 1,
			stdout: err.stdout ?? "",
			stderr: err.stderr ?? String(err.message ?? err),
		};
	}
}

/** `pnpm pack` each published package and return the tarball paths, keyed by package name. */
function packAll(into) {
	const tarballs = {};
	for (const name of PACKAGES) {
		const before = new Set(readdirSync(into));
		const packed = run("pnpm", ["--filter", name, "pack", "--pack-destination", into], {
			cwd: REPO_ROOT,
		});
		if (packed.code !== 0) throw new Error(`pnpm pack ${name} failed:\n${packed.stderr}`);
		const created = readdirSync(into).filter((f) => f.endsWith(".tgz") && !before.has(f));
		if (created.length !== 1) throw new Error(`pnpm pack ${name} produced ${created.length} tarballs`);
		tarballs[name] = join(into, created[0]);
	}
	return tarballs;
}

/** Every package name present under `node_modules`, nested ones included. */
function installedPackages(nodeModules) {
	const found = new Set();
	const walk = (dir, scope) => {
		if (!existsSync(dir)) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
			if (entry.name === ".bin" || (entry.name.startsWith(".") && !entry.name.startsWith("@"))) continue;
			const full = join(dir, entry.name);
			if (!scope && entry.name.startsWith("@")) {
				walk(full, entry.name);
				continue;
			}
			const name = scope ? `${scope}/${entry.name}` : entry.name;
			if (existsSync(join(full, "package.json"))) found.add(name);
			walk(join(full, "node_modules"), undefined);
		}
	};
	walk(nodeModules, undefined);
	return found;
}

async function main() {
	const work = mkdtempSync(join(tmpdir(), "gribble-gate-only-"));
	const tarballDir = join(work, "tarballs");
	const project = join(work, "project");
	mkdirSync(tarballDir);
	mkdirSync(join(project, ".gribble"), { recursive: true });

	const site = createSiteServer();
	await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${site.address().port}`;

	try {
		const tarballs = packAll(tarballDir);

		// `gribble` depends on `@gribble/core` by version, which also exists on npm; the overrides
		// force the freshly packed workspace copies so this tests the working tree, not the release.
		const local = Object.fromEntries(PACKAGES.map((name) => [name, `file:${tarballs[name]}`]));
		writeFileSync(
			join(project, "package.json"),
			`${JSON.stringify(
				{
					name: "gate-only-consumer",
					private: true,
					version: "0.0.0",
					type: "module",
					dependencies: local,
					overrides: local,
				},
				null,
				2,
			)}\n`,
		);
		writeFileSync(
			join(project, ".gribble", "gribble.yaml"),
			`target:\n  url: ${url}\n  routes: ["/"]\nallowed_origins: [127.0.0.1]\n`,
		);
		writeFileSync(join(project, ".gribble", "rules.yaml"), `rules:\n  ${RULE}: error\n`);

		const env = {
			...process.env,
			CI: "1",
			// The audited project is not a git repository and never needs its own browser download.
			PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
			GRIBBLE_HOME: join(work, "home"),
		};

		// No `--omit=optional`: that would also drop sharp's platform binaries. npm skips an
		// *optional peer* on its own, which is exactly the situation under test.
		const install = run("npm", ["install", "--no-audit", "--no-fund"], {
			cwd: project,
			env,
		});
		if (install.code !== 0) throw new Error(`npm install failed:\n${install.stderr}`);

		const packages = installedPackages(join(project, "node_modules"));
		const pi = [...packages].filter((name) => name.startsWith("@earendil-works/"));
		check("no @earendil-works package is installed", pi.length === 0, pi.join("\n"));
		console.log(`\n      npm install gribble -> ${packages.size} packages\n`);

		const bin = join(project, "node_modules", "gribble", "dist", "bin.js");
		const gribble = (args) => run(process.execPath, [bin, ...args], { cwd: project, env });

		const help = gribble(["--help"]);
		check("gribble --help", help.code === 0 && help.stdout.includes("audit"), help.stderr);

		const explain = gribble(["explain", RULE]);
		check(`gribble explain ${RULE}`, explain.code === 0 && explain.stdout.includes(RULE), explain.stderr);

		const gate = gribble(["audit", "--mode", "gate", "--ci"]);
		check("gribble audit --mode gate", gate.code === 0, `${gate.stdout}\n${gate.stderr}`);

		const report = join(project, ".gribble", "runs", "latest.json");
		check(
			"the gate run wrote a report",
			existsSync(report) && JSON.parse(readFileSync(report, "utf8")).mode === "gate",
		);

		// The version must be the pinned one from the pnpm catalog, not a bare package name.
		const expected = JSON.parse(
			readFileSync(join(project, "node_modules", "gribble", "package.json"), "utf8"),
		).peerDependencies["@earendil-works/pi-ai"];
		const wants = (result) =>
			result.code !== 0 &&
			result.stderr.includes("The AI review runtime is not installed") &&
			result.stderr.includes(`@earendil-works/pi-ai@${expected}`) &&
			result.stderr.includes(`@earendil-works/pi-coding-agent@${expected}`) &&
			!result.stderr.includes("Unexpected error");

		const review = gribble(["audit", "--mode", "review", "--ci"]);
		check("gribble audit --mode review names the missing packages", wants(review), review.stderr);

		const login = gribble(["login", "anthropic"]);
		check("gribble login names the missing packages", wants(login), login.stderr);
	} finally {
		await new Promise((resolve) => site.close(resolve));
		rmSync(work, { recursive: true, force: true });
	}

	if (failures.length > 0) {
		console.error(`\n${failures.length} check(s) failed.`);
		process.exitCode = 1;
	} else {
		console.log("\nGate-only install works without the review runtime.");
	}
}

await main();
