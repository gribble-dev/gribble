<script lang="ts">
	import { page } from "$app/state";
	import "$lib/styles/markdown.css";
	import type { LayoutProps } from "./$types";

	let { data, children }: LayoutProps = $props();

	let current = $derived(page.url.pathname.replace(/\/$/, "") || "/docs");
</script>

<div class="docs-shell">
	<aside class="sidebar">
		<nav aria-label="Documentation">
			{#if data.nav.length === 0}
				<p class="empty">No pages yet.</p>
			{:else}
				{#each data.nav as group (group.id)}
					<section class="group">
						{#if group.id !== ""}
							<h2 class="group-label">{group.label}</h2>
						{/if}
						<ul>
							{#each group.pages as item (item.href)}
								<li>
									<a href={item.href} aria-current={current === item.href ? "page" : undefined}>
										{item.title}
									</a>
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			{/if}
		</nav>
	</aside>

	<div class="content">
		{@render children?.()}
	</div>
</div>

<style>
	.docs-shell {
		max-width: var(--page-max);
		margin: 0 auto;
		padding: var(--space-8) var(--space-4) var(--space-16);
		display: grid;
		grid-template-columns: 15rem minmax(0, 1fr);
		gap: var(--space-8);
		align-items: start;
	}

	.sidebar {
		position: sticky;
		top: 4.5rem;
		max-height: calc(100vh - 6rem);
		overflow-y: auto;
		min-width: 0;
	}

	.content {
		/* Long code lines must scroll inside their own <pre>, never widen the page. */
		min-width: 0;
	}

	.group + .group {
		margin-top: var(--space-6);
	}

	.group-label {
		font-size: 0.74rem;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: var(--text-faint);
		margin: 0 0 var(--space-2);
	}

	.sidebar ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.1rem;
	}

	.sidebar a {
		display: block;
		padding: 0.28rem var(--space-2);
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		text-decoration: none;
		font-size: 0.94rem;
	}

	.sidebar a:hover {
		background: var(--bg-sunken);
		color: var(--text);
	}

	.sidebar a[aria-current="page"] {
		background: var(--accent-soft);
		color: var(--accent);
		font-weight: 600;
	}

	.empty {
		color: var(--text-faint);
		font-size: 0.94rem;
	}

	@media (max-width: 880px) {
		.docs-shell {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--space-6);
		}

		.sidebar {
			position: static;
			max-height: none;
			border-bottom: 1px solid var(--border);
			padding-bottom: var(--space-4);
		}
	}
</style>
