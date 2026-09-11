<script lang="ts">
	import Mascot from "$lib/Mascot.svelte";
	import PrComment from "$lib/PrComment.svelte";
	import { site } from "$lib/site";

	const steps = [
		{
			command: "pnpm add -D gribble",
			caption: "Install the CLI in the app you want audited."
		},
		{
			command: "pnpm exec gribble init",
			caption: "Writes .gribble/ — config, rules, guidelines and a first flow."
		},
		{
			command: "pnpm exec gribble audit",
			caption: "Starts your dev server, walks the site, reports what it chewed through."
		}
	];

	const docLinks = [
		{ href: "/docs/getting-started", title: "Getting started", blurb: "From install to a first clean run." },
		{
			href: "/docs/concepts/gate-and-review",
			title: "Gate and review",
			blurb: "The deterministic half and the judgement half."
		},
		{
			href: "/docs/configuration/gribble-yaml",
			title: "gribble.yaml",
			blurb: "Targets, budgets, viewports, environments."
		},
		{
			href: "/docs/configuration/rules-reference",
			title: "Rules reference",
			blurb: "Every rule, its options and its fix."
		},
		{ href: "/docs/flows", title: "Flows", blurb: "Describe a user journey in plain Markdown." },
		{ href: "/docs/ci-github-action", title: "CI and GitHub Action", blurb: "Wire it into pull requests." }
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
	<div class="hero-inner">
		<div class="hero-copy">
			<p class="eyebrow">AI website audit, at development time</p>
			<h1>Tiny bugs that find your bugs before you ship.</h1>
			<p class="subline">Let the gribbles chew on it before your users do.</p>
			<div class="cta">
				<a class="button primary" href="/docs/getting-started">Get started</a>
				<a class="button" href={site.github} rel="noreferrer noopener">View on GitHub</a>
			</div>
			<p class="hint">
				MIT licensed. Node 22+. Runs on your machine and in CI — no crawler, no production traffic.
			</p>
		</div>
		<div class="hero-art">
			<Mascot size={180} title="A gribble, the tiny sea bug that chews holes in ships" />
		</div>
	</div>
</section>

<section class="band" aria-labelledby="what-it-is">
	<div class="wrap">
		<h2 id="what-it-is">A code reviewer for your website, not a rank tracker</h2>
		<div class="prose">
			<p>
				Gribble is an audit agent that runs while the site is still on <code>localhost</code> — before the
				pull request, inside CI, ahead of the release. It starts your dev server, walks your routes and your
				flows, and reports broken links, dead ends, console errors, accessibility problems, SEO gaps,
				performance regressions and violations of your own written guidelines.
			</p>
			<p>
				Tools like Ahrefs and Lighthouse-as-a-service point at a site that is already live: the damage has
				shipped and the report lands in a dashboard. Gribble points at the build you have not merged yet, and
				traces every finding back to a file and a component so the fix is a diff, not a ticket.
			</p>
		</div>
		<ul class="pills">
			<li>Runs against localhost or a preview deploy</li>
			<li>Findings carry source locations, not screenshots alone</li>
			<li>A baseline on main, so you review the diff</li>
			<li>Your house style lives in <code>guidelines.md</code></li>
		</ul>
	</div>
</section>

<section class="band alt" aria-labelledby="install">
	<div class="wrap">
		<h2 id="install">Three steps to your first audit</h2>
		<ol class="steps">
			{#each steps as step, index (step.command)}
				<li>
					<span class="step-number" aria-hidden="true">{index + 1}</span>
					<pre><code>{step.command}</code></pre>
					<p>{step.caption}</p>
				</li>
			{/each}
		</ol>
		<p class="aside">
			npm, yarn and bun work too — swap the package manager. The full walkthrough lives in
			<a href="/docs/getting-started">Getting started</a>.
		</p>
	</div>
</section>

<section class="band" aria-labelledby="pr-example">
	<div class="wrap">
		<h2 id="pr-example">What it leaves on your pull request</h2>
		<p class="lede">
			One summary comment, updated in place on every run. Findings that map to source get inline review
			comments; the rest are folded into the summary. When a finding disappears, its comment is edited to
			<em>patched</em> and the thread is resolved.
		</p>
		<PrComment />
		<p class="aside">
			The example above is a mock-up of a real summary comment. See
			<a href="/docs/concepts/findings">Findings</a> for the anatomy of one.
		</p>
	</div>
</section>

<section class="band alt" aria-labelledby="gate-vs-review">
	<div class="wrap">
		<h2 id="gate-vs-review">Gate and review: two speeds, one report</h2>
		<div class="two-up">
			<article class="card">
				<h3>Gate — deterministic, cheap, blocking</h3>
				<p>
					Crawlers, checkers and replayed flows. No model involved: broken links, failed requests, missing
					meta, duplicate ids, axe violations, Lighthouse budgets, mixed content. Fast enough to run on every
					push, strict enough to fail the build.
				</p>
				<p class="foot"><code>gribble audit --mode gate</code></p>
			</article>
			<article class="card">
				<h3>Review — judgement, slower, advisory</h3>
				<p>
					An agent browses the site like an irritable reviewer: confusing copy, dead ends, layout that breaks
					at 390&nbsp;px, guideline violations, journeys that silently do nothing. Findings come with a
					confidence score, are capped by your <code>review/*</code> severities, and never block on their own.
				</p>
				<p class="foot"><code>gribble audit --mode review</code></p>
			</article>
		</div>
		<p class="aside">
			<code>gribble audit</code> runs both. Read
			<a href="/docs/concepts/gate-and-review">Gate and review</a> for the whole story.
		</p>
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
			Machine readers: <a href="/llms.txt">/llms.txt</a>, <a href="/llms-full.txt">/llms-full.txt</a>, and every
			page also served as raw Markdown at <code>/docs/&lt;page&gt;.md</code>.
		</p>
	</div>
</section>

<style>
	.hero {
		border-bottom: 1px solid var(--border);
		background:
			radial-gradient(120% 90% at 85% -10%, var(--accent-soft) 0%, transparent 55%),
			linear-gradient(var(--bg), var(--bg));
	}

	.hero-inner {
		max-width: var(--page-max);
		margin: 0 auto;
		padding: var(--space-16) var(--space-4) var(--space-12);
		display: grid;
		grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.75fr);
		gap: var(--space-8);
		align-items: center;
	}

	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.09em;
		font-size: 0.76rem;
		font-weight: 650;
		color: var(--accent);
		margin-bottom: var(--space-3);
	}

	.subline {
		font-size: clamp(1.05rem, 0.95rem + 0.5vw, 1.3rem);
		color: var(--text-muted);
		max-width: 42ch;
	}

	.cta {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		margin: var(--space-6) 0 var(--space-4);
	}

	.button {
		display: inline-block;
		padding: 0.6rem 1.15rem;
		border-radius: var(--radius);
		border: 1px solid var(--border-strong);
		background: var(--bg-raised);
		color: var(--text);
		text-decoration: none;
		font-weight: 600;
	}

	.button:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.button.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}

	.button.primary:hover {
		background: var(--accent-hover);
		color: var(--on-accent);
	}

	.hint {
		color: var(--text-faint);
		font-size: 0.9rem;
		margin: 0;
	}

	.hero-art {
		display: flex;
		justify-content: center;
	}

	.band {
		padding: var(--space-12) 0;
	}

	.band.alt {
		background: var(--bg-sunken);
		border-block: 1px solid var(--border);
	}

	.wrap {
		max-width: var(--page-max);
		margin: 0 auto;
		padding: 0 var(--space-4);
	}

	.prose,
	.lede {
		max-width: var(--measure);
	}

	.lede {
		color: var(--text-muted);
	}

	.pills {
		list-style: none;
		margin: var(--space-6) 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.pills li {
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.35rem 0.85rem;
		font-size: 0.9rem;
		color: var(--text-muted);
	}

	.steps {
		list-style: none;
		margin: var(--space-6) 0 var(--space-4);
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: var(--space-4);
	}

	.steps li {
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
		position: relative;
	}

	.step-number {
		display: inline-grid;
		place-items: center;
		width: 1.7rem;
		height: 1.7rem;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent);
		font-weight: 700;
		font-size: 0.85rem;
		margin-bottom: var(--space-3);
	}

	.steps pre {
		margin: 0 0 var(--space-3);
	}

	.steps p {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.94rem;
	}

	.two-up {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: var(--space-4);
		margin: var(--space-6) 0 var(--space-4);
	}

	.card {
		background: var(--bg-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--space-6);
	}

	.card h3 {
		margin-bottom: var(--space-3);
	}

	.card p {
		color: var(--text-muted);
	}

	.card .foot {
		margin: 0;
		color: var(--text-faint);
	}

	.doc-grid {
		list-style: none;
		margin: var(--space-6) 0 var(--space-4);
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
		gap: var(--space-3);
	}

	.doc-grid a {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-4);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg-raised);
		text-decoration: none;
		height: 100%;
	}

	.doc-grid a:hover {
		border-color: var(--accent);
	}

	.doc-title {
		font-weight: 650;
		color: var(--text);
	}

	.doc-grid a:hover .doc-title {
		color: var(--accent);
	}

	.doc-blurb {
		color: var(--text-muted);
		font-size: 0.92rem;
	}

	.aside {
		color: var(--text-muted);
		font-size: 0.94rem;
		max-width: var(--measure);
		margin-bottom: 0;
	}

	@media (max-width: 820px) {
		.hero-inner {
			grid-template-columns: 1fr;
			padding-top: var(--space-12);
		}

		.hero-art {
			order: -1;
			justify-content: flex-start;
		}
	}
</style>
