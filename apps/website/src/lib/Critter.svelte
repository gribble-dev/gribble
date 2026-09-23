<script lang="ts" module>
	/**
	 * The crew: one tide-pool critter per family of checks. Same sticker style as the mascot —
	 * flat fills from the `--critter-*` tokens, a 2.2px ink outline, round joins.
	 */
	export type CritterName = "crab" | "puffer" | "starfish" | "jelly" | "snail" | "urchin" | "fish" | "octopus";
</script>

<script lang="ts">
	interface Props {
		name: CritterName;
		size?: number;
		/** Accessible name. Leave empty for decorative use next to a visible label. */
		title?: string;
		class?: string;
	}

	let { name, size = 48, title = "", class: className = "" }: Props = $props();

	// Five-point star around (24, 25): outer radius 19, inner 8.5.
	const star = "M24 6 L29 18.1 L42.1 19.1 L32.1 27.6 L35.2 40.4 L24 33.5 L12.8 40.4 L15.9 27.6 L5.9 19.1 L19 18.1 Z";
	const urchinSpines = Array.from({ length: 14 }, (_, i) => {
		const a = (i / 14) * Math.PI * 2;
		const r = (n: number) => Math.round(n * 10) / 10;
		return {
			x1: r(24 + Math.cos(a) * 10.5),
			y1: r(27 + Math.sin(a) * 10.5),
			x2: r(24 + Math.cos(a) * 17.5),
			y2: r(27 + Math.sin(a) * 17.5),
		};
	});
	const octopusLegs = [
		"M14 27 C12 33 8 34 7 38",
		"M20 27 C20 34 17 38 15 42",
		"M28 27 C28 34 31 38 33 41",
		"M34 27 C36 32 38 33 39.5 34",
	];
</script>

<svg
	class={`critter ${className}`}
	width={size}
	height={size}
	viewBox="0 0 48 48"
	xmlns="http://www.w3.org/2000/svg"
	role={title ? "img" : "presentation"}
	aria-hidden={title ? undefined : "true"}
	aria-label={title || undefined}
>
	<g stroke="var(--critter-ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
		{#if name === "crab"}
			<!-- hermit crab: links and network -->
			<circle cx="31" cy="22" r="12" fill="var(--critter-shell)" />
			<path d="M31 13.5 A8.5 8.5 0 1 1 22.5 22 A4.6 4.6 0 1 1 31 22" fill="none" />
			<path d="M15 27 L13 20 M20.5 27 L21.5 20" fill="none" />
			<ellipse cx="18" cy="32" rx="9.5" ry="6" fill="var(--critter-coral)" />
			<circle cx="8" cy="31" r="3.8" fill="var(--critter-coral)" />
			<circle cx="11.5" cy="38.2" r="3.2" fill="var(--critter-coral)" />
			<path d="M14 37.5 L12 42.5 M19 38 L18.5 43 M24 37 L26 42" fill="none" />
			<circle cx="13" cy="19" r="2.6" fill="var(--critter-eye)" />
			<circle cx="21.5" cy="19" r="2.6" fill="var(--critter-eye)" />
		{:else if name === "puffer"}
			<!-- pufferfish: SEO and markup -->
			<path d="M12 25 L4.5 18.5 L4.5 31.5 Z" fill="var(--critter-sun)" />
			<path
				d="M24 9.5 L24 6 M33 12 L35.5 9 M38.5 20 L42 19 M38.5 30 L42 31.5 M33 38 L35.5 41 M24 40.5 L24 44 M15 38 L12.5 41 M15 12 L12.5 9"
				fill="none"
			/>
			<circle cx="25" cy="25" r="14" fill="var(--critter-sun)" />
			<path d="M16 30 Q25 36 34 30" fill="none" stroke-width="1.6" opacity="0.5" />
			<circle cx="31" cy="21" r="4" fill="var(--critter-eye)" />
			<circle cx="38.6" cy="26.5" r="1.8" fill="none" />
		{:else if name === "starfish"}
			<!-- starfish: accessibility -->
			<path d={star} fill="var(--critter-coral)" />
			<path d="M21.5 27 Q24 29.2 26.5 27" fill="none" stroke-width="1.8" />
		{:else if name === "jelly"}
			<!-- jellyfish: performance -->
			<path
				d="M11 25 q-2 5 0 9.5 q2 4.5 0 8.5 M18 26 q-2 5 0 9.5 q2 4.5 0 8.5 M26 26 q-2 5 0 9.5 q2 4.5 0 8.5 M33 25 q-2 5 0 9.5 q2 4.5 0 8.5"
				fill="none"
			/>
			<path d="M7 25 C7 11 37 11 37 25 Q33.5 28 30 25 Q26 28 22 25 Q18 28 14 25 Q10.5 28 7 25 Z" fill="var(--critter-glass)" />
			<path d="M40 12 H46 M41.5 18 H46.5 M40 24 H45" fill="none" stroke-width="2" />
		{:else if name === "snail"}
			<!-- sea snail: UI rules and layout -->
			<path d="M4 38 C4 33.5 7.5 31.5 12 31.5 H40 C43.5 31.5 45 34.5 45 38 Z" fill="var(--critter-shell)" />
			<path d="M7.5 33 C5.5 26 8.5 21 12.5 21.5 C16 22 16.5 28 15.5 31.5" fill="var(--critter-shell)" />
			<path d="M11 21.8 L8 14.5 M14.2 22 L15.5 14.5" fill="none" />
			<circle cx="8" cy="13.5" r="2.2" fill="var(--critter-eye)" />
			<circle cx="15.8" cy="13.5" r="2.2" fill="var(--critter-eye)" />
			<rect x="18" y="10" width="22" height="22" rx="11" fill="var(--critter-lilac)" />
			<path d="M29 14.5 A6.5 6.5 0 1 1 22.5 21 A3.4 3.4 0 1 1 29 21" fill="none" />
		{:else if name === "urchin"}
			<!-- sea urchin: security -->
			{#each urchinSpines as s, i (i)}
				<line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
			{/each}
			<circle cx="24" cy="27" r="11" fill="var(--critter-glass)" />
			<path d="M20.5 31.5 H27.5" fill="none" stroke-width="1.8" />
		{:else if name === "fish"}
			<!-- little fish on a dotted path: flows -->
			<path d="M4 42 C11 35 16 45 23 38 S34 36 38 40" fill="none" stroke-width="2" stroke-dasharray="0.1 4.4" />
			<path d="M13 19 L5 12.5 L5 25.5 Z" fill="var(--critter-sun)" />
			<ellipse cx="24" cy="19" rx="12.5" ry="8.5" fill="var(--critter-sun)" />
			<path d="M21 11.2 Q18.6 19 21 26.8" fill="none" stroke-width="3.6" stroke="var(--critter-coral)" />
			<path d="M21 11.2 Q18.6 19 21 26.8" fill="none" stroke-width="1.2" opacity="0.55" />
			<circle cx="30" cy="17" r="3" fill="var(--critter-eye)" />
		{:else if name === "octopus"}
			<!-- octopus with a magnifying glass: the review agent -->
			{#each octopusLegs as d (d)}
				<path {d} fill="none" stroke-width="6.8" />
				<path {d} fill="none" stroke-width="2.6" stroke="var(--critter-coral)" />
			{/each}
			<path d="M10.5 28 C10.5 11 37.5 11 37.5 28 Z" fill="var(--critter-coral)" />
			<circle cx="19" cy="21" r="3.4" fill="var(--critter-eye)" />
			<circle cx="29" cy="21" r="3.4" fill="var(--critter-eye)" />
			<path d="M43 36.5 L46.5 41" fill="none" stroke-width="3" />
			<circle cx="40" cy="33" r="5" fill="var(--critter-eye)" fill-opacity="0.8" />
		{/if}
	</g>

	<!-- pupils sit above the outline group so they stay crisp -->
	{#if name === "crab"}
		<circle cx="13.6" cy="19.4" r="1.1" fill="var(--critter-ink)" />
		<circle cx="22.1" cy="19.4" r="1.1" fill="var(--critter-ink)" />
	{:else if name === "puffer"}
		<circle cx="32" cy="21.6" r="1.8" fill="var(--critter-ink)" />
	{:else if name === "starfish"}
		<circle cx="21.3" cy="23" r="1.5" fill="var(--critter-ink)" />
		<circle cx="26.7" cy="23" r="1.5" fill="var(--critter-ink)" />
	{:else if name === "jelly"}
		<circle cx="18" cy="19" r="1.6" fill="var(--critter-ink)" />
		<circle cx="26" cy="19" r="1.6" fill="var(--critter-ink)" />
	{:else if name === "snail"}
		<circle cx="8.4" cy="13.8" r="1" fill="var(--critter-ink)" />
		<circle cx="16.2" cy="13.8" r="1" fill="var(--critter-ink)" />
	{:else if name === "urchin"}
		<circle cx="20.5" cy="25.5" r="1.7" fill="var(--critter-ink)" />
		<circle cx="27.5" cy="25.5" r="1.7" fill="var(--critter-ink)" />
	{:else if name === "fish"}
		<circle cx="30.8" cy="17.4" r="1.4" fill="var(--critter-ink)" />
	{:else if name === "octopus"}
		<circle cx="19.8" cy="21.6" r="1.5" fill="var(--critter-ink)" />
		<circle cx="29.8" cy="21.6" r="1.5" fill="var(--critter-ink)" />
	{/if}
</svg>

<style>
	.critter {
		display: block;
		flex: none;
		overflow: visible;
	}
</style>
