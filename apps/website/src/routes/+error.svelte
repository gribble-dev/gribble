<script lang="ts">
	import { page } from "$app/state";
	import Mascot from "$lib/Mascot.svelte";
</script>

<svelte:head>
	<title>{page.status} — Gribble</title>
	<meta name="description" content="That page is not on the map." />
</svelte:head>

<section class="wrap">
	<Mascot size={120} wiggle title="A puzzled gribble" />
	<h1>{page.status} — nothing to chew on here</h1>
	<p>{page.error?.message ?? "That page is not on the map."}</p>
	<p>
		Try the <a href="/docs">documentation index</a> or head back to the
		<a href="/">front page</a>.
	</p>
</section>

<style>
	.wrap {
		max-width: var(--page-max);
		margin: 0 auto;
		padding: var(--space-16) var(--space-4);
		display: grid;
		justify-items: start;
		gap: var(--space-2);
	}

	h1 {
		margin-top: var(--space-4);
	}
</style>
