<script lang="ts">
	import { page } from "$app/state";
	import Mascot from "$lib/Mascot.svelte";
	import { canonical, site } from "$lib/site";
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
			<Mascot size={32} decorative />
			<span>Gribble</span>
		</a>
		<nav aria-label="Main">
			<a href="/docs" aria-current={page.url.pathname.startsWith("/docs") ? "page" : undefined}>Docs</a>
			<a href="/llms.txt">llms.txt</a>
			<a href={site.github} rel="noreferrer noopener">GitHub</a>
		</nav>
	</div>
</header>

<main id="main">
	{@render children?.()}
</main>

<footer class="site-footer">
	<div class="inner">
		<p class="joke">
			<Mascot size={24} decorative />
			<span>Let the gribbles chew on it before your users do.</span>
		</p>
		<nav aria-label="Footer">
			<a href="/docs">Docs</a>
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
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		backdrop-filter: blur(10px);
		border-bottom: 1px solid var(--border);
	}

	.bar {
		max-width: var(--page-max);
		margin: 0 auto;
		padding: var(--space-3) var(--space-4);
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-weight: 650;
		font-size: 1.05rem;
		color: var(--text);
		text-decoration: none;
		letter-spacing: -0.01em;
	}

	.bar nav {
		margin-left: auto;
		display: flex;
		gap: var(--space-4);
		font-size: 0.94rem;
	}

	.bar nav a {
		/* Comfortable tap targets: at least 44px tall without changing the visual rhythm. */
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 var(--space-2);
		margin: 0 calc(-1 * var(--space-2));
		color: var(--text-muted);
		text-decoration: none;
	}

	.bar nav a:hover,
	.bar nav a[aria-current="page"] {
		color: var(--accent);
	}

	main {
		min-height: 60vh;
	}

	.site-footer {
		border-top: 1px solid var(--border);
		margin-top: var(--space-16);
		background: var(--bg-sunken);
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
		gap: var(--space-2);
		margin: 0;
		color: var(--text-muted);
	}

	.site-footer nav {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		font-size: 0.94rem;
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
		color: var(--text-faint);
		font-size: 0.88rem;
	}

	@media (max-width: 480px) {
		.bar nav {
			gap: var(--space-3);
			font-size: 0.9rem;
		}
	}
</style>
