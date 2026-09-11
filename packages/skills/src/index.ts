import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Version of the shipped `skills/gribble/SKILL.md`.
 *
 * Kept in sync with the package version and with the `metadata.version` field in the
 * SKILL.md frontmatter; `test/skill-md.test.ts` fails when the three drift apart.
 */
export const SKILL_VERSION = "0.1.0";

/** Name of the skill directory and of the skill itself. */
export const SKILL_NAME = "gribble";

/** Coding agents that can host the Gribble skill. */
export type AgentKind = "agents" | "claude" | "cursor" | "pi";

/** Every known agent kind, in the order Gribble presents them. */
export const AGENT_KINDS: readonly AgentKind[] = ["agents", "claude", "cursor", "pi"];

/** Human-readable labels, used by `gribble init` prompts. */
export const AGENT_LABELS: Record<AgentKind, string> = {
	agents: "Agent Skills (.agents/skills, used by pi and others)",
	claude: "Claude Code (.claude/skills)",
	cursor: "Cursor (.cursor/skills)",
	pi: "pi (.agents/skills)",
};

/** Directory each agent kind reads skills from, relative to the repository root. */
const AGENT_SKILL_DIRS: Record<AgentKind, string> = {
	agents: ".agents/skills",
	claude: ".claude/skills",
	cursor: ".cursor/skills",
	pi: ".agents/skills",
};

/** What `installSkill` did to one target file. */
export type InstallStatus = "installed" | "updated" | "unchanged";

export interface InstallResult {
	kind: AgentKind;
	path: string;
	status: InstallStatus;
}

export interface InstallSkillOptions {
	/** Overwrite a locally modified SKILL.md that already carries the current version. */
	force?: boolean;
}

const SKILL_FILE_URL = new URL("../skills/gribble/SKILL.md", import.meta.url);

let cachedSource: Promise<string> | undefined;

/**
 * Contents of the `SKILL.md` shipped inside this package.
 *
 * Resolved relative to this module, so it works from `src/` during development and from
 * `dist/` once published — both sit one level below the package root.
 */
export function skillSource(): Promise<string> {
	if (!cachedSource) {
		cachedSource = readFile(SKILL_FILE_URL, "utf8").catch((cause: unknown) => {
			cachedSource = undefined;
			throw new Error(
				`@gribble/skills: could not read the bundled SKILL.md at ${fileURLToPath(SKILL_FILE_URL)}`,
				{ cause },
			);
		});
	}
	return cachedSource;
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Detect which coding agents are set up in a repository.
 *
 * `.claude/` -> claude, `.pi/` -> pi, `.cursor/` -> cursor, `AGENTS.md` or `.agents/` -> agents.
 * The result is ordered by {@link AGENT_KINDS} and contains no duplicates.
 */
export async function detectAgents(repoRoot: string): Promise<AgentKind[]> {
	const markers: Record<AgentKind, string[]> = {
		agents: [".agents", "AGENTS.md"],
		claude: [".claude"],
		cursor: [".cursor"],
		pi: [".pi"],
	};
	const found: AgentKind[] = [];
	for (const kind of AGENT_KINDS) {
		const hits = await Promise.all(markers[kind].map((marker) => exists(join(repoRoot, marker))));
		if (hits.some(Boolean)) found.push(kind);
	}
	return found;
}

/** Absolute path of the SKILL.md for one agent kind. */
export function skillTargetPath(repoRoot: string, kind: AgentKind): string {
	const dir = AGENT_SKILL_DIRS[kind];
	if (!dir) throw new Error(`@gribble/skills: unknown agent kind "${kind}"`);
	return join(repoRoot, dir, SKILL_NAME, "SKILL.md");
}

/**
 * Read the `version` recorded in the frontmatter of an installed SKILL.md.
 *
 * Accepts both `metadata.version` and a top-level `version:` line. Returns `undefined`
 * when the file is missing, has no frontmatter, or records no version.
 */
export async function installedSkillVersion(path: string): Promise<string | undefined> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch {
		return undefined;
	}
	return parseFrontmatterVersion(text);
}

/** Extract the frontmatter version from SKILL.md text. Exported for tests and tooling. */
export function parseFrontmatterVersion(text: string): string | undefined {
	const frontmatter = extractFrontmatter(text);
	if (frontmatter === undefined) return undefined;
	let inMetadata = false;
	for (const rawLine of frontmatter.split("\n")) {
		const line = rawLine.replace(/\s+$/, "");
		if (!line || line.trimStart().startsWith("#")) continue;
		const indented = /^\s/.test(line);
		if (!indented) inMetadata = /^metadata\s*:/.test(line);
		if (indented && !inMetadata) continue;
		const match = /^\s*version\s*:\s*(.+)$/.exec(line);
		if (match?.[1]) return unquote(match[1].trim());
	}
	return undefined;
}

function extractFrontmatter(text: string): string | undefined {
	const normalized = text.replace(/^\uFEFF/, "");
	if (!/^---\r?\n/.test(normalized)) return undefined;
	const end = normalized.indexOf("\n---", 4);
	if (end === -1) return undefined;
	return normalized.slice(normalized.indexOf("\n") + 1, end);
}

function unquote(value: string): string {
	const quoted = /^(["'])(.*)\1$/.exec(value);
	return quoted?.[2] ?? value;
}

/**
 * Write `skills/gribble/SKILL.md` into every requested agent directory.
 *
 * - missing file -> `installed`
 * - identical content -> `unchanged` (nothing written)
 * - different content at another version (or `force`) -> `updated`
 * - different content at the current version -> `unchanged`, left alone unless `force`
 *
 * `agents` and `pi` share `.agents/skills`; when both are requested the second one reports
 * the state of the file the first one wrote.
 */
export async function installSkill(
	repoRoot: string,
	kinds: AgentKind[],
	opts: InstallSkillOptions = {},
): Promise<InstallResult[]> {
	const source = await skillSource();
	const results: InstallResult[] = [];
	for (const kind of kinds) {
		const path = skillTargetPath(repoRoot, kind);
		results.push({ kind, path, status: await writeSkillFile(path, source, opts.force === true) });
	}
	return results;
}

async function writeSkillFile(path: string, source: string, force: boolean): Promise<InstallStatus> {
	let current: string | undefined;
	try {
		current = await readFile(path, "utf8");
	} catch {
		current = undefined;
	}

	if (current === undefined) {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, source, "utf8");
		return "installed";
	}
	if (current === source) return "unchanged";

	const currentVersion = parseFrontmatterVersion(current);
	if (!force && currentVersion === SKILL_VERSION) return "unchanged";

	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, source, "utf8");
	return "updated";
}
