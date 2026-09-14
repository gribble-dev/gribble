<script lang="ts">
	import { site } from "$lib/site";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	let description = $derived(data.description || `${data.title} — Gribble documentation.`);
</script>

<svelte:head>
	<title>{data.title} — Gribble</title>
	<meta name="description" content={description} />
	<meta property="og:title" content="{data.title} — Gribble" />
	<meta property="og:description" content={description} />
	<meta property="og:image" content="{site.url}/favicon.svg" />
</svelte:head>

<article class="doc">
	<header class="doc-head">
		<h1>{data.title}</h1>
		{#if data.description}
			<p class="lede">{data.description}</p>
		{/if}
		<p class="raw"><a href={`/docs/${data.slug}.md`}>View as Markdown</a></p>
	</header>

	{#if data.headings.length > 2}
		<nav class="toc" aria-label="On this page">
			<h2>On this page</h2>
			<ul>
				{#each data.headings as heading (heading.id)}
					<li class={`depth-${heading.depth}`}><a href={`#${heading.id}`}>{heading.text}</a></li>
				{/each}
			</ul>
		</nav>
	{/if}

	<!-- Compiled at build time from the repo's own docs/ folder. -->
	<div class="markdown">{@html data.html}</div>

	<footer class="doc-foot">
		<a href={`${site.github}/blob/main/${data.sourcePath}`} rel="noreferrer noopener">
			Edit this page on GitHub
		</a>
	</footer>
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

	.toc {
		margin: 0 0 var(--space-8);
		padding: var(--space-4);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg-sunken);
	}

	.toc h2 {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: var(--text-faint);
		margin: 0 0 var(--space-2);
	}

	.toc ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.15rem;
		font-size: 0.94rem;
	}

	.toc .depth-3 {
		padding-left: var(--space-4);
	}

	.doc-foot {
		margin-top: var(--space-12);
		padding-top: var(--space-4);
		border-top: 1px solid var(--border);
		font-size: 0.92rem;
	}
</style>
