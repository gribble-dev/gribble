<script lang="ts">
	import { site } from "$lib/site";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.title} — Gribble</title>
	<meta name="description" content={data.description} />
	<meta property="og:title" content="{data.title} — Gribble" />
	<meta property="og:description" content={data.description} />
	<meta property="og:image" content="{site.url}/favicon.svg" />
</svelte:head>

<article class="doc">
	<header class="doc-head">
		<h1>{data.title}</h1>
		{#if data.description}
			<p class="lede">{data.description}</p>
		{/if}
		{#if data.hasIndex}
			<p class="raw"><a href="/docs/index.md">View as Markdown</a></p>
		{/if}
	</header>

	{#if data.html}
		<!-- Compiled at build time from the repo's own docs/ folder. -->
		<div class="markdown">{@html data.html}</div>
	{/if}

	{#if data.sections.length === 0}
		<p class="empty">
			The documentation has not been written yet. In the meantime the
			<a href={site.github}>repository README</a> is the shortest path in.
		</p>
	{:else}
		{#each data.sections as section (section.id)}
			<section class="section">
				<h2>{section.label}</h2>
				<ul>
					{#each section.pages as item (item.href)}
						<li>
							<a href={item.href}>{item.title}</a>
							{#if item.description}<span class="blurb">{item.description}</span>{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	{/if}
</article>

<style>
	.doc {
		max-width: min(var(--measure), 100%);
	}

	.doc-head {
		margin-bottom: var(--space-8);
	}

	.lede {
		color: var(--text-muted);
		font-size: 1.05rem;
	}

	.raw {
		margin: 0;
		font-size: 0.9rem;
	}

	.section {
		margin-top: var(--space-8);
	}

	.section ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-3);
	}

	.section li {
		display: grid;
		gap: 0.1rem;
		padding-bottom: var(--space-3);
		border-bottom: 1px solid var(--border);
	}

	.section a {
		font-weight: 600;
	}

	.blurb {
		color: var(--text-muted);
		font-size: 0.94rem;
	}

	.empty {
		color: var(--text-muted);
	}
</style>
