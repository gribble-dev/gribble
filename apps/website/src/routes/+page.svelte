<script lang="ts">
	import ChatDemo from "$lib/ChatDemo.svelte";
	import Critter, { type CritterName } from "$lib/Critter.svelte";
	import Mascot from "$lib/Mascot.svelte";
	import PrComment from "$lib/PrComment.svelte";
	import PromptCard from "$lib/PromptCard.svelte";
	import { site } from "$lib/site";

	const setupPrompt = "Set up Gribble in this project by following https://gribble.dev/setup.md";

	const asks = [
		{
			prompt: "Fix the new Gribble findings on this branch and verify with gate.",
			result: "Reads the report, works in severity order, re-runs the deterministic gate to prove it.",
			href: "/docs/skills",
			link: "Working with your agent",
		},
		{
			prompt: "Add a flow for password reset: request the link, open it, set a new password, land signed in.",
			result: "Writes a plain-English flow the review walks, then gate replays for free.",
			href: "/docs/flows",
			link: "Flows",
		},
		{
			prompt: "Our buttons must be at least 44px tall. Make Gribble enforce that.",
			result: "Knows a mechanical rule belongs in rules.yaml, not in prose.",
			href: "/docs/configuration/rules-yaml",
			link: "rules.yaml",
		},
		{
			prompt: "Every error message should say what to do next. Teach Gribble our house style.",
			result: "Knows a judgement call belongs in guidelines.md, for the review to read.",
			href: "/docs/guidelines",
			link: "Guidelines",
		},
		{
			prompt: "Run Gribble on every pull request. Gate blocks the merge, review only comments.",
			result: "Adds the GitHub Action workflow and tells you which secret to create.",
			href: "/docs/ci-github-action",
			link: "CI and the GitHub Action",
		},
		{
			prompt: "Why does Gribble still report the /signup contrast issue? I didn't touch that page.",
			result: "Explains new versus existing findings and the baseline — and does not silence it.",
			href: "/docs/concepts/baseline",
			link: "Baseline",
		},
	];

	const crew: Array<{ name: CritterName; critter: string; family: string; checks: string; rules: string[] }> = [
		{
			name: "crab",
			critter: "Hermit crab",
			family: "Links and network",
			checks: "Broken links, failed requests, console errors.",
			rules: ["links/broken", "network/console-errors"],
		},
		{
			name: "puffer",
			critter: "Pufferfish",
			family: "SEO and markup",
			checks: "Titles, descriptions, canonicals, valid HTML.",
			rules: ["seo/meta-description", "html/duplicate-ids"],
		},
		{
			name: "starfish",
			critter: "Starfish",
			family: "Accessibility",
			checks: "axe, labels, contrast, focus, touch targets.",
			rules: ["a11y/form-labels", "a11y/touch-target"],
		},
		{
			name: "jelly",
			critter: "Jellyfish",
			family: "Performance",
			checks: "Lighthouse budgets and regressions against main.",
			rules: ["perf/regression"],
		},
		{
			name: "snail",
			critter: "Sea snail",
			family: "UI rules",
			checks: "Overlap, overflow at 390 px, clipped text, tokens.",
			rules: ["ui/overlap", "ui/horizontal-overflow"],
		},
		{
			name: "urchin",
			critter: "Sea urchin",
			family: "Security",
			checks: "HTTPS, headers, mixed content, leaked secrets.",
			rules: ["security/headers", "security/exposed-secrets"],
		},
		{
			name: "fish",
			critter: "Clownfish",
			family: "Flows",
			checks: "Replays journeys the review already walked.",
			rules: ["flows/replay"],
		},
		{
			name: "octopus",
			critter: "Octopus",
			family: "Review",
			checks: "An AI agent walks your flows and reads your guidelines.",
			rules: ["review/copy", "review/flow-coverage"],
		},
	];

	const docLinks = [
		{ href: "/docs/agent-setup", title: "Agent setup guide", blurb: "What your agent does when you hand it setup.md." },
		{ href: "/docs/skills", title: "Working with your agent", blurb: "The requests that work, and why." },
		{
			href: "/docs/concepts/gate-and-review",
			title: "Gate and review",
			blurb: "The deterministic half and the judgement half.",
		},
		{ href: "/docs/flows", title: "Flows", blurb: "Describe a user journey in plain Markdown." },
		{
			href: "/docs/configuration/rules-reference",
			title: "Rules reference",
			blurb: "Every rule, its options and its fix.",
		},
		{ href: "/docs/ci-github-action", title: "CI and GitHub Action", blurb: "Wire it into pull requests." },
	];
</script>

<svelte:head>
	<title>Gribble — Tiny bugs that find your bugs before you ship.</title>
	<meta name="description" content={site.description} />
	<meta property="og:title" content="Gribble — Tiny bugs that find your bugs before you ship." />
	<meta property="og:description" content={site.description} />
	<meta property="og:image" content="{site.url}/favicon.svg" />
</svelte:head>

<section class="hero">
	<div class="wrap hero-grid">
		<div class="hero-copy">
			<p class="eyebrow">AI website audits, before you ship</p>
			<h1>Tiny bugs that find your bugs <span class="nowrap">before you ship.</span></h1>
			<p class="subline">
				Gribble walks your site on localhost, in the pull request and in CI, and points every finding at the file
				that caused it. You don't have to learn the config. Your coding agent reads it for you.
			</p>

			<PromptCard
				prompt={setupPrompt}
				label="Paste this into your coding agent"
				size="large"
				note="It installs, configures and runs a first audit, then asks you which model to use."
			/>

			<div class="cta">
				<a class="button" href="/docs/agent-setup">What the agent will do</a>
				<a class="button ghost" href="#by-hand">Install by hand</a>
			</div>
		</div>

		<div class="hero-demo">
			<Mascot size={84} wiggle class="peek" title="A gribble, the tiny sea bug that chews holes in ships" />
			<ChatDemo />
		</div>
	</div>
	<svg class="wave" viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden="true">
		<path d="M0 34 C180 6 360 6 540 30 C720 54 900 56 1080 32 C1260 8 1350 14 1440 26 L1440 60 L0 60 Z" />
	</svg>
</section>

<section class="band water" aria-labelledby="just-ask">
	<div class="wrap">
		<div class="section-head">
			<h2 id="just-ask">Once it's in, just ask</h2>
			<p class="lede">
				Setup installs a skill file that teaches your agent where the report lives, what every field means, how to
				verify a fix, and which file a new rule belongs in. So ordinary sentences work.
			</p>
		</div>
		<ul class="asks">
			{#each asks as ask (ask.href)}
				<li class="ask">
					<p class="ask-prompt">{ask.prompt}</p>
					<p class="ask-result">{ask.result}</p>
					<a class="ask-link" href={ask.href}>{ask.link}<span aria-hidden="true"> →</span></a>
				</li>
			{/each}
		</ul>
	</div>
</section>

<section class="band" aria-labelledby="crew">
	<div class="wrap">
		<div class="section-head">
			<h2 id="crew">Meet the crew</h2>
			<p class="lede">
				Eight families of checks, one tide-pool critter each. Seven run as plain code, fast enough to block a merge.
				The octopus is the AI reviewer, and it only ever comments.
			</p>
		</div>
		<ul class="crew">
			{#each crew as member (member.name)}
				<li class="member" class:ai={member.name === "octopus"}>
					<Critter name={member.name} size={60} />
					<div class="member-text">
						<h3>{member.family}</h3>
						<p class="member-kind">{member.critter}</p>
						<p>{member.checks}</p>
						<p class="rules">
							{#each member.rules as rule (rule)}
								<a href={`/rules/${rule}`}><code>{rule}</code></a>
							{/each}
						</p>
					</div>
				</li>
			{/each}
		</ul>
		<p class="aside">
			Every rule, its options and its fix: <a href="/docs/configuration/rules-reference">rules reference</a>.
		</p>
	</div>
</section>

<section class="band sunken" aria-labelledby="pr-example">
	<div class="wrap pr-grid">
		<div>
			<h2 id="pr-example">What it leaves on your pull request</h2>
			<p class="lede">
				One summary comment, updated in place on every run. Findings that map to source get inline review comments;
				when one disappears, its comment is edited to <em>patched</em> and the thread is resolved.
			</p>
			<p class="lede">
				Everything is a diff against the <a href="/docs/concepts/baseline">baseline</a> on main. New holes are
				reported, known ones are counted, patched ones are celebrated.
			</p>
			<PromptCard prompt="Add the Gribble GitHub Action to this repository." />
			<p class="aside">
				The comment is a mock-up of a real summary. See <a href="/docs/concepts/findings">Findings</a> for the
				anatomy of one.
			</p>
		</div>
		<PrComment />
	</div>
</section>

<section class="band" aria-labelledby="gate-vs-review">
	<div class="wrap">
		<div class="section-head">
			<h2 id="gate-vs-review">Two speeds, one report</h2>
			<p class="lede">Only one of them is allowed to block a merge.</p>
		</div>
		<div class="two-up">
			<article class="card">
				<p class="card-tag">No model, no tokens</p>
				<h3>Gate: deterministic and blocking</h3>
				<p>
					Crawlers, checkers and replayed flows: broken links, failed requests, missing meta, duplicate ids, axe
					violations, Lighthouse budgets, mixed content. Fast enough for every push, strict enough to fail the
					build, and the loop your agent uses to prove a fix.
				</p>
				<p class="foot"><code>gribble audit --mode gate</code></p>
			</article>
			<article class="card alt">
				<p class="card-tag">Bring your own model</p>
				<h3>Review: judgement, advisory</h3>
				<p>
					An agent browses the site like an irritable reviewer: confusing copy, dead ends, layout that breaks at
					390&nbsp;px, guideline violations, journeys that silently do nothing. Findings carry a confidence score,
					are capped by your <code>review/*</code> severities, and never block on their own.
				</p>
				<p class="foot"><code>gribble audit --mode review</code></p>
			</article>
		</div>
		<p class="aside">
			<code>gribble audit</code> runs both. Read <a href="/docs/concepts/gate-and-review">Gate and review</a> for the
			whole story.
		</p>
	</div>
</section>

<section class="band sunken" aria-labelledby="by-hand" id="by-hand">
	<div class="wrap hand-grid">
		<div>
			<h2>Prefer the keyboard?</h2>
			<p class="lede">
				Everything your agent does is a plain CLI. Install it as a devDependency, the way you would ESLint or
				Playwright, so CI and your laptop agree on the version.
			</p>
			<p class="aside">
				npm, yarn and bun work too. <code>gate</code> installs no model runtime; <code>review</code> needs
				<a href="/docs/getting-started#the-review-runtime-is-optional">two more packages</a>. The full walkthrough is
				in <a href="/docs/getting-started">Getting started</a>.
			</p>
		</div>
		<pre class="terminal"><code><span class="c"># in the app you want audited</span>
pnpm add -D gribble
pnpm exec gribble install   <span class="c"># Playwright's Chromium</span>
pnpm exec gribble init      <span class="c"># writes .gribble/</span>
pnpm exec gribble audit     <span class="c"># let the gribbles chew on it</span></code></pre>
	</div>
</section>

<section class="band" aria-labelledby="docs-entry">
	<div class="wrap">
		<h2 id="docs-entry">Documentation</h2>
		<ul class="doc-grid">
			{#each docLinks as link (link.href)}
				<li>
					<a href={link.href}>
						<span class="doc-title">{link.title}</span>
						<span class="doc-blurb">{link.blurb}</span>
					</a>
				</li>
			{/each}
		</ul>
		<p class="aside">
			For agents: <a href="/setup.md">/setup.md</a>, <a href="/llms.txt">/llms.txt</a>,
			<a href="/llms-full.txt">/llms-full.txt</a>, and every page as raw Markdown at <code>/docs/&lt;page&gt;.md</code>.
		</p>
	</div>
</section>

<style>
	.wrap {
		max-width: var(--page-max);
		margin: 0 auto;
		padding: 0 var(--space-4);
	}

	/* ---------- hero ---------- */
	.hero {
		position: relative;
		padding-top: var(--space-12);
		background:
			radial-gradient(60% 70% at 92% 10%, var(--hero-glow) 0%, transparent 70%),
			var(--bg);
	}

	.hero-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--space-12);
		align-items: start;
		padding-bottom: var(--space-16);
	}

	.hero-copy {
		padding-top: var(--space-6);
	}

	.eyebrow {
		display: inline-block;
		margin-bottom: var(--space-4);
		padding: 0.2rem 0.8rem;
		border: 2px solid var(--outline);
		border-radius: var(--radius-pill);
		background: var(--shell);
		color: var(--kelp);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 0.88rem;
	}

	h1 {
		margin-bottom: var(--space-4);
	}

	.nowrap {
		white-space: nowrap;
	}

	.subline {
		font-size: clamp(1.05rem, 0.98rem + 0.35vw, 1.2rem);
		color: var(--text-muted);
		max-width: 46ch;
		margin-bottom: var(--space-6);
	}

	.cta {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.button.ghost {
		background: transparent;
		box-shadow: none;
		border-color: var(--border-strong);
	}

	.button.ghost:hover {
		border-color: var(--outline);
		transform: none;
	}

	.hero-demo {
		position: relative;
		/* Room for the gribble to stand on the top edge of the chat card. */
		padding-top: 80px;
		min-width: 0;
	}

	.hero-demo :global(.peek) {
		position: absolute;
		top: 0;
		right: var(--space-8);
		z-index: 1;
		transform: rotate(8deg);
	}

	.wave {
		display: block;
		width: 100%;
		height: 48px;
		fill: var(--bg-water);
		margin-bottom: -1px;
	}

	/* ---------- bands ---------- */
	.band {
		padding: var(--space-16) 0;
	}

	.band.water {
		background: var(--bg-water);
	}

	.band.sunken {
		background: var(--bg-sunken);
	}

	.section-head {
		max-width: 62ch;
		margin-bottom: var(--space-8);
	}

	.lede {
		color: var(--text-muted);
		font-size: 1.05rem;
	}

	.section-head .lede {
		margin-bottom: 0;
	}

	.aside {
		color: var(--text-muted);
		font-size: 0.94rem;
		margin: var(--space-6) 0 0;
	}

	/* ---------- asks ---------- */
	.asks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-6);
	}

	.ask {
		display: grid;
		grid-template-rows: 1fr auto auto;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-4) var(--space-4);
		background: var(--bg-raised);
		border: 2px solid var(--outline);
		border-radius: var(--radius-lg) var(--radius-lg) var(--radius-lg) 6px;
		box-shadow: var(--sticker-shadow);
	}

	.ask-prompt {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 500;
		font-size: 1.12rem;
		line-height: 1.35;
	}

	.ask-prompt::before {
		content: "“";
		color: var(--coral);
		font-weight: 700;
		margin-right: 0.08em;
	}

	.ask-prompt::after {
		content: "”";
		color: var(--coral);
		font-weight: 700;
		margin-left: 0.04em;
	}

	.ask-result {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.93rem;
		padding-top: var(--space-3);
		border-top: 2px dashed var(--border);
	}

	.ask-link {
		font-weight: 650;
		font-size: 0.93rem;
		justify-self: start;
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}

	/* ---------- crew ---------- */
	.crew {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-4);
	}

	.member {
		display: grid;
		gap: var(--space-3);
		align-content: start;
		padding: var(--space-4);
		border-radius: var(--radius-lg);
		background: var(--bg-raised);
		border: 1.5px solid var(--border);
	}

	.member.ai {
		background: var(--accent-soft);
		border: 2px dashed var(--outline);
	}

	/* The faint label does not reach 4.5:1 on the coral wash. */
	.member.ai .member-kind {
		color: var(--text-muted);
	}

	.member h3 {
		margin: 0;
		font-size: 1.12rem;
	}

	.member-text p {
		margin: 0;
		font-size: 0.93rem;
		color: var(--text-muted);
	}

	.member-text {
		display: grid;
		gap: var(--space-1);
	}

	.member-text .member-kind {
		font-size: 0.8rem;
		color: var(--text-faint);
		font-family: var(--font-display);
		font-weight: 500;
		margin-bottom: var(--space-1);
	}

	.rules {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
		margin-top: var(--space-2) !important;
	}

	.rules a {
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		min-height: 32px;
	}

	.rules code {
		font-size: 0.76rem;
		color: var(--accent);
	}

	/* ---------- PR ---------- */
	.pr-grid {
		display: grid;
		grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
		gap: var(--space-12);
		align-items: start;
	}

	.pr-grid :global(.prompt-card) {
		margin-top: var(--space-6);
	}

	/* ---------- gate / review ---------- */
	.two-up {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-6);
	}

	.card {
		padding: var(--space-6);
		border-radius: var(--radius-lg);
		border: 2px solid var(--outline);
		background: var(--bg-raised);
		box-shadow: var(--sticker-shadow);
		display: flex;
		flex-direction: column;
	}

	.card.alt {
		background: var(--bg-water);
	}

	.card-tag {
		align-self: flex-start;
		margin-bottom: var(--space-3);
		padding: 0.1rem 0.7rem;
		border-radius: var(--radius-pill);
		background: var(--shell);
		color: var(--kelp);
		border: 1.5px solid var(--outline);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 0.8rem;
	}

	.card.alt .card-tag {
		background: var(--critter-lilac);
	}

	.card .foot {
		margin: auto 0 0;
		padding-top: var(--space-3);
	}

	/* ---------- by hand ---------- */
	.hand-grid {
		display: grid;
		grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
		gap: var(--space-12);
		align-items: center;
	}

	.terminal {
		margin: 0;
		background: var(--kelp);
		color: var(--on-kelp);
		border: 2px solid var(--outline);
		box-shadow: var(--sticker-shadow);
		font-size: 0.95rem;
		padding: var(--space-6);
		/* Wraps instead of scrolling, so it needs no keyboard focus stop. */
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.terminal .c {
		color: var(--on-kelp-comment);
	}

	/* ---------- docs ---------- */
	.doc-grid {
		list-style: none;
		margin: var(--space-6) 0 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-4);
	}

	.doc-grid a {
		display: grid;
		gap: var(--space-1);
		height: 100%;
		padding: var(--space-4);
		border: 1.5px solid var(--border-strong);
		border-radius: var(--radius);
		background: var(--bg-raised);
		text-decoration: none;
		color: var(--text);
		transition:
			border-color 120ms ease,
			transform 120ms ease;
	}

	.doc-grid a:hover {
		border-color: var(--outline);
		transform: translateY(-2px);
	}

	.doc-title {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 1.08rem;
		color: var(--accent);
	}

	.doc-blurb {
		color: var(--text-muted);
		font-size: 0.93rem;
	}

	/* ---------- responsive ---------- */
	@media (max-width: 1000px) {
		.hero-grid,
		.pr-grid,
		.hand-grid {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--space-8);
		}

		.asks,
		.doc-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.crew {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 620px) {
		.hero {
			padding-top: var(--space-8);
		}

		.asks,
		.doc-grid,
		.two-up {
			grid-template-columns: minmax(0, 1fr);
		}

		.crew {
			grid-template-columns: minmax(0, 1fr);
		}

		.member {
			grid-template-columns: auto minmax(0, 1fr);
			align-items: start;
		}

		.band {
			padding: var(--space-12) 0;
		}

		.nowrap {
			white-space: normal;
		}
	}
</style>
