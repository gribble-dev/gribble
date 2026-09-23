<script lang="ts">
	import { page } from "$app/state";
	import { copyText } from "$lib/copy";
	import "$lib/styles/markdown.css";
	import type { LayoutProps } from "./$types";

	let { data, children }: LayoutProps = $props();

	let current = $derived(page.url.pathname.replace(/\/$/, "") || "/docs");
	let ready = $state(false);

	$effect(() => {
		ready = true;
	});

	/** One delegated handler for every ```prompt card the Markdown renderer emitted. */
	async function onClick(event: MouseEvent) {
		const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("button[data-copy-prompt]");
		if (!button) return;
		const text = button.closest(".prompt-card")?.querySelector<HTMLElement>(".prompt-text");
		if (!text) return;
		const copied = await copyText(text.textContent ?? "", text);
		button.textContent = copied ? "Copied" : "Selected";
		setTimeout(() => (button.textContent = "Copy"), 1800);
	}
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

	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="content" class:copy-ready={ready} onclick={onClick}>
		{@render children?.()}
	</div>
</div>

<style>
	.docs-shell {
		max-width: var(--page-max);
		margin: 0 auto;
		padding: var(--space-8) var(--space-4) var(--space-16);
		display: grid;
		grid-template-columns: 15.5rem minmax(0, 1fr);
		gap: var(--space-12);
		align-items: start;
	}

	.sidebar {
		position: sticky;
		top: 5rem;
		max-height: calc(100vh - 6.5rem);
		overflow-y: auto;
		min-width: 0;
		padding: var(--space-4);
		background: var(--bg-water);
		border-radius: var(--radius-lg);
	}

	.content {
		/* Long code lines must scroll inside their own <pre>, never widen the page. */
		min-width: 0;
	}

	.group + .group {
		margin-top: var(--space-6);
	}

	.group-label {
		font-family: var(--font-display);
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
		margin: 0 0 var(--space-2);
		padding-left: var(--space-3);
	}

	.sidebar ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.15rem;
	}

	.sidebar a {
		display: block;
		padding: 0.32rem var(--space-3);
		border-radius: var(--radius-pill);
		border: 2px solid transparent;
		color: var(--text-muted);
		text-decoration: none;
		font-size: 0.95rem;
	}

	.sidebar a:hover {
		background: var(--bg-raised);
		color: var(--text);
	}

	.sidebar a[aria-current="page"] {
		background: var(--bg-raised);
		border-color: var(--outline);
		color: var(--text);
		font-weight: 650;
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
		}
	}
</style>
