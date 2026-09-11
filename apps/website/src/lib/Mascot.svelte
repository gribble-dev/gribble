<script lang="ts">
	/**
	 * An original gribble: a small, friendly isopod-shaped sea bug with a segmented shell,
	 * six little legs, two antennae and two dot eyes.
	 */
	interface Props {
		size?: number;
		title?: string;
		/** Decorative instances are hidden from assistive technology. */
		decorative?: boolean;
		class?: string;
	}

	let { size = 48, title = "The Gribble mascot", decorative = false, class: className = "" }: Props = $props();
</script>

<svg
	class={`mascot ${className}`}
	width={size}
	height={size}
	viewBox="0 0 64 64"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	role={decorative ? "presentation" : "img"}
	aria-hidden={decorative ? "true" : undefined}
	aria-label={decorative ? undefined : title}
>
	<!-- legs -->
	<g stroke="var(--mascot-leg)" stroke-width="2.6" stroke-linecap="round">
		<path d="M20 45 L15 53" />
		<path d="M28 47 L26 56" />
		<path d="M36 47 L38 56" />
		<path d="M44 45 L49 53" />
		<path d="M17 36 L8 39" />
		<path d="M47 36 L56 39" />
	</g>

	<!-- antennae -->
	<g stroke="var(--mascot-leg)" stroke-width="2.6" stroke-linecap="round" fill="none">
		<path d="M25 17 C22 11, 18 9, 14 9" />
		<path d="M39 17 C42 11, 46 9, 50 9" />
	</g>

	<!-- body -->
	<ellipse cx="32" cy="32" rx="19" ry="17" fill="var(--mascot-body)" />
	<!-- shell segments -->
	<g stroke="var(--mascot-segment)" stroke-width="2" stroke-linecap="round" fill="none">
		<path d="M15.6 27 C24 24.5, 40 24.5, 48.4 27" />
		<path d="M13.6 34 C23 31.8, 41 31.8, 50.4 34" />
		<path d="M15.6 41 C24 39, 40 39, 48.4 41" />
	</g>
	<!-- head plate -->
	<path
		d="M32 15 C42 15, 50 20.5, 51 26 C41 22.5, 23 22.5, 13 26 C14 20.5, 22 15, 32 15 Z"
		fill="var(--mascot-head)"
	/>
	<!-- eyes -->
	<circle cx="25" cy="21.5" r="2.4" fill="var(--mascot-eye)" />
	<circle cx="39" cy="21.5" r="2.4" fill="var(--mascot-eye)" />
	<circle cx="25.9" cy="20.8" r="0.8" fill="var(--mascot-glint)" />
	<circle cx="39.9" cy="20.8" r="0.8" fill="var(--mascot-glint)" />
</svg>

<style>
	.mascot {
		--mascot-body: #7fd1bd;
		--mascot-head: #52b6a0;
		--mascot-segment: #2f7f6d;
		--mascot-leg: #2f7f6d;
		--mascot-eye: #10312b;
		--mascot-glint: #ffffff;
		display: block;
		flex: none;
	}

	@media (prefers-color-scheme: dark) {
		.mascot {
			--mascot-body: #6ec6b1;
			--mascot-head: #45a690;
			--mascot-segment: #1d5a4c;
			--mascot-leg: #3f9e88;
			--mascot-eye: #07201b;
		}
	}
</style>
