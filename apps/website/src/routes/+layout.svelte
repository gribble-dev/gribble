<script lang="ts">
	import { page } from "$app/state";
	import Mascot from "$lib/Mascot.svelte";
	import { canonical, site } from "$lib/site";
	import "@fontsource-variable/figtree";
	import "@fontsource-variable/fredoka";
	import "@fontsource-variable/jetbrains-mono";
	import "$lib/styles/app.css";

	let { children } = $props();

	const year = new Date().getFullYear();
	let canonicalUrl = $derived(canonical(page.url.pathname));
</script>

<svelte:head>
	<link rel="canonical" href={canonicalUrl} />
	<meta property="og:site_name" content={site.name} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={canonicalUrl} />
	<meta name="twitter:card" content="summary" />
</svelte:head>

<a class="skip-link" href="#main">Skip to content</a>

<header class="site-header">
	<div class="bar">
		<a class="brand" href="/">
			<Mascot size={38} decorative />
			<span>Gribble</span>
		</a>
		<nav aria-label="Main">
			<a
				href="/docs"
				aria-current={page.url.pathname.startsWith("/docs") && !page.url.pathname.startsWith("/docs/agent-setup")
					? "page"
					: undefined}>Docs</a
			>
			<a href="/docs/agent-setup" aria-current={page.url.pathname.startsWith("/docs/agent-setup") ? "page" : undefined}
				>Agent setup</a
			>
			<a class="gh" href={site.github} rel="noreferrer noopener">GitHub</a>
		</nav>
	</div>
</header>

<main id="main">
	{@render children?.()}
</main>

<footer class="site-footer">
	<div class="inner">
		<p class="joke">
			<Mascot size={44} decorative />
			<span>Let the gribbles chew on it before your users do.</span>
		</p>
		<nav aria-label="Footer">
			<a href="/docs">Docs</a>
			<a href="/setup.md">setup.md</a>
			<a href="/llms.txt">llms.txt</a>
			<a href={site.github} rel="noreferrer noopener">GitHub</a>
			<a href={site.npm} rel="noreferrer noopener">npm</a>
			<a href="/schema/gribble.json">JSON Schema</a>
		</nav>
		<p class="legal">MIT licensed. &copy; {year} the Gribble contributors.</p>
	</div>
</footer>

<style>
	.site-header {
		position: sticky;
		top: 0;
		z-index: 10;
		background: color-mix(in srgb, var(--bg) 90%, transparent);
		backdrop-filter: blur(10px);
		border-bottom: 2px solid var(--outline);
	}

	.bar {
		max-width: var(--page-max);
		margin: 0 auto;
		padding: var(--space-2) var(--space-4);
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-family: var(--font-display);
		font-weight: 650;
		font-size: 1.4rem;
		color: var(--text);
		text-decoration: none;
	}

	.brand:hover {
		color: var(--text);
	}

	.bar nav {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-family: var(--font-display);
		font-weight: 500;
		font-size: 1rem;
	}

	.bar nav a {
		/* Comfortable tap targets: at least 44px tall without changing the visual rhythm. */
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-pill);
		color: var(--text-muted);
		text-decoration: none;
	}

	.bar nav a:hover {
		color: var(--text);
		background: var(--bg-sunken);
	}

	.bar nav a[aria-current="page"] {
		color: var(--text);
		background: var(--bg-water);
	}

	.bar nav a.gh {
		border: 2px solid var(--outline);
		color: var(--text);
		min-height: 40px;
		margin-left: var(--space-1);
	}

	main {
		min-height: 60vh;
	}

	.site-footer {
		border-top: 2px solid var(--outline);
		background: var(--kelp);
		color: var(--sand);
		--accent: #ffb3a8;
		--accent-hover: #ffd2cb;
		/* The footer is always a kelp band, so the critter ink flips to sand to stay visible. */
		--critter-ink: #0a1a17;
	}

	.inner {
		max-width: var(--page-max);
		margin: 0 auto;
		padding: var(--space-8) var(--space-4);
		display: grid;
		gap: var(--space-3);
	}

	.joke {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: 0;
		font-family: var(--font-display);
		font-weight: 500;
		font-size: 1.2rem;
	}

	.site-footer nav {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		font-size: 0.96rem;
	}

	.site-footer nav a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 var(--space-2);
		margin: 0 calc(-1 * var(--space-2));
	}

	.legal {
		margin: 0;
		color: #c9d9d3;
		font-size: 0.88rem;
	}

	@media (max-width: 560px) {
		.bar nav {
			margin-left: 0;
			width: 100%;
			justify-content: space-between;
			font-size: 0.95rem;
		}

		.bar nav a {
			padding: 0 var(--space-2);
		}
	}
</style>
