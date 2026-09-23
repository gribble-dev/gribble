import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserSession, FlowReplay, ProjectContext } from "../src/index.js";
import {
	AgentState,
	BROWSER_TOOLS,
	browserPack,
	FLOW_TOOLS,
	flowsPack,
	launchBrowser,
	replayFlow,
} from "../src/index.js";
import { fakePi } from "./agent-helpers.js";
import {
	type FixtureSite,
	hasChromium,
	makeProject,
	SKIP_BROWSER_REASON,
	startFixtureSite,
} from "./browser-helpers.js";

const VISAS_NAME =
	"Visas and entry Pick your passport to see whether you can enter China visa-free, use the 240-hour transit rule or need a visa, and what to have ready at the border.";
const SAVE_NAME =
	"Save this guide to your offline reading list so it stays available on the ship, in the harbor and anywhere without signal";

describe.skipIf(!hasChromium())(`recorded replay selectors (${SKIP_BROWSER_REASON})`, () => {
	let site: FixtureSite;
	let browser: BrowserSession;
	let dir: string;
	let project: ProjectContext;

	beforeAll(async () => {
		site = await startFixtureSite();
		dir = await mkdtemp(join(tmpdir(), "gribble-recording-"));
		project = await makeProject({ url: site.url, targetDir: dir });
		browser = await launchBrowser({ project, headless: true });
	}, 60_000);

	afterAll(async () => {
		await browser?.close();
		await site?.close();
		await rm(dir, { recursive: true, force: true });
	});

	it("names elements the way Playwright does: untruncated, without aria-hidden text", async () => {
		const page = await browser.newPage();
		await page.goto(`${site.url}/cards.html`);
		const snapshot = await page.snapshot({ includeDom: false });
		const visas = snapshot.interactive.find((e) => e.href === "/guides/visas");
		expect(visas?.name).toBe(VISAS_NAME);
		expect(snapshot.interactive.find((e) => e.href === "/guides/money")?.name).toBe("Money");
		const save = snapshot.interactive.find((e) => e.name.startsWith("Save this guide"));
		expect(save?.name).toBe(SAVE_NAME);
		expect(SAVE_NAME.length).toBeGreaterThan(120);
		// Playwright's exact role match agrees with the recorded name.
		expect(await page.matchSelector?.(`role=link[name="${VISAS_NAME}"]`, visas?.ref)).toEqual({
			count: 1,
			sameElement: true,
		});
		expect(await page.matchSelector?.(`role=button[name="${SAVE_NAME}"]`, save?.ref)).toEqual({
			count: 1,
			sameElement: true,
		});
		expect(await page.matchSelector?.("role=link[name=", visas?.ref)).toEqual({
			count: 0,
			sameElement: false,
		});
		await page.close();
	});

	it("records selectors that resolve to exactly the clicked element and replays them", async () => {
		const state = new AgentState({
			project,
			targetName: "",
			browser,
			env: {},
			runDir: join(dir, "runs", "test"),
		});
		const h = fakePi();
		await h.load(browserPack(state));
		await h.load(flowsPack(state));
		try {
			// Exploration left the browser on another page; the flow navigates first (#34).
			await h.call(BROWSER_TOOLS.navigate, { url: "/about.html" });
			await h.call(FLOW_TOOLS.flowStart, { name: "guide" });
			await h.call(BROWSER_TOOLS.navigate, { url: "/cards.html" });
			const snap = await h.call<{ interactive: Array<{ ref: string; name: string; href?: string }> }>(
				BROWSER_TOOLS.pageSnapshot,
				{},
			);
			const refOf = (pick: (e: { name: string; href?: string }) => boolean) =>
				`ref=${snap.details.interactive.find(pick)?.ref}`;
			const shares = snap.details.interactive.filter((e) => e.name === "Share");
			expect(shares).toHaveLength(2);

			const save = await h.call<{ selector: string }>(BROWSER_TOOLS.click, {
				target: refOf((e) => e.name === SAVE_NAME),
			});
			expect(save.details.selector).toBe(`role=button[name="${SAVE_NAME}"]`);
			const share = await h.call<{ selector: string }>(BROWSER_TOOLS.click, {
				target: `ref=${shares[1]?.ref}`,
			});
			// `role=button[name="Share"]` matches both buttons, so the structural path is kept.
			expect(share.details.selector).toBe("body > main > button:nth-of-type(3)");
			const visas = await h.call<{ selector: string }>(BROWSER_TOOLS.click, {
				target: refOf((e) => e.href === "/guides/visas"),
			});
			expect(visas.details.selector).toBe('a[href="/guides/visas"]');

			const end = await h.call<{ replay?: string }>(FLOW_TOOLS.flowEnd, { name: "guide", ok: true });
			const sidecar = join(dir, ".gribble", "flows", "guide.replay.json");
			expect(end.details.replay).toBe(sidecar);
			const replay = JSON.parse(await readFile(sidecar, "utf8")) as FlowReplay;
			expect(replay.startUrl).toBe("/");
			expect(replay.steps).toEqual([
				{ action: "navigate", url: "/cards.html" },
				{ action: "click", selector: `role=button[name="${SAVE_NAME}"]` },
				{ action: "click", selector: "body > main > button:nth-of-type(3)" },
				{ action: "click", selector: 'a[href="/guides/visas"]' },
			]);

			const result = await replayFlow({
				flow: { name: "guide", file: join(dir, ".gribble", "flows", "guide.md"), description: "" },
				replay,
				browser,
				project,
				targetName: "",
				env: {},
				stepTimeoutMs: 3_000,
			});
			expect(result.error).toBeUndefined();
			expect(result).toMatchObject({ ok: true, steps: 4 });
		} finally {
			await state.closePages();
		}
	}, 60_000);
});
