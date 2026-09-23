<script lang="ts">
	/**
	 * The gribble: a chubby coral isopod seen from above, drawn as a sticker — flat fills, a
	 * kelp outline, big eyes, curled antennae and a little tail fan. Colours come from the
	 * `--critter-*` tokens so it follows the theme.
	 */
	interface Props {
		size?: number;
		title?: string;
		/** Decorative instances are hidden from assistive technology. */
		decorative?: boolean;
		/** `wiggle` bobs the antennae; it stops for readers who prefer reduced motion. */
		wiggle?: boolean;
		class?: string;
	}

	let {
		size = 48,
		title = "The Gribble mascot",
		decorative = false,
		wiggle = false,
		class: className = "",
	}: Props = $props();
</script>

<svg
	class={`mascot ${className}`}
	class:wiggle
	width={size}
	height={size}
	viewBox="0 0 64 64"
	xmlns="http://www.w3.org/2000/svg"
	role={decorative ? "presentation" : "img"}
	aria-hidden={decorative ? "true" : undefined}
	aria-label={decorative ? undefined : title}
>
	<g stroke="var(--critter-ink)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
		<!-- legs, tucked under the shell -->
		<g fill="none">
			<path d="M15 29 L8.5 26.5" />
			<path d="M13.6 37 L7 38" />
			<path d="M15.5 44.5 L10 48.5" />
			<path d="M49 29 L55.5 26.5" />
			<path d="M50.4 37 L57 38" />
			<path d="M48.5 44.5 L54 48.5" />
		</g>

		<!-- antennae -->
		<g class="antennae" fill="none">
			<path d="M26 15 C24 9, 20 6, 15.5 6.5" />
			<path d="M38 15 C40 9, 44 6, 48.5 6.5" />
		</g>
		<circle class="antennae" cx="15" cy="6.6" r="2.6" fill="var(--critter-sun)" />
		<circle class="antennae" cx="49" cy="6.6" r="2.6" fill="var(--critter-sun)" />

		<!-- tail fan -->
		<ellipse cx="27" cy="54.5" rx="4.4" ry="3.4" fill="var(--critter-shell)" />
		<ellipse cx="37" cy="54.5" rx="4.4" ry="3.4" fill="var(--critter-shell)" />

		<!-- shell -->
		<path
			d="M32 12.5 C45.5 12.5 50.8 24 50.8 34 C50.8 46 42.5 54 32 54 C21.5 54 13.2 46 13.2 34 C13.2 24 18.5 12.5 32 12.5 Z"
			fill="var(--critter-coral)"
		/>
		<g fill="none" stroke-width="2.2">
			<path d="M15.2 38.5 Q32 33.5 48.8 38.5" />
			<path d="M17.8 45 Q32 40.8 46.2 45" />
			<path d="M22.5 50.5 Q32 47.6 41.5 50.5" />
		</g>

		<!-- eyes -->
		<circle cx="25" cy="25" r="5.4" fill="var(--critter-eye)" stroke-width="2.2" />
		<circle cx="39" cy="25" r="5.4" fill="var(--critter-eye)" stroke-width="2.2" />
	</g>
	<circle cx="26" cy="26" r="2.5" fill="var(--critter-ink)" />
	<circle cx="40" cy="26" r="2.5" fill="var(--critter-ink)" />
	<circle cx="26.9" cy="25" r="0.9" fill="var(--critter-eye)" />
	<circle cx="40.9" cy="25" r="0.9" fill="var(--critter-eye)" />

	<!-- cheeks and grin -->
	<ellipse cx="19.4" cy="32" rx="2.6" ry="1.6" fill="var(--critter-ink)" opacity="0.18" />
	<ellipse cx="44.6" cy="32" rx="2.6" ry="1.6" fill="var(--critter-ink)" opacity="0.18" />
	<path
		d="M28.6 31.4 Q32 34.4 35.4 31.4"
		fill="none"
		stroke="var(--critter-ink)"
		stroke-width="2.2"
		stroke-linecap="round"
	/>

	<!-- shine -->
	<ellipse cx="21" cy="18.6" rx="3" ry="1.7" transform="rotate(-28 21 18.6)" fill="var(--critter-eye)" opacity="0.55" />
</svg>

<style>
	.mascot {
		display: block;
		flex: none;
		overflow: visible;
	}

	.wiggle .antennae {
		transform-box: view-box;
		transform-origin: 32px 15px;
		animation: wiggle 2.8s ease-in-out infinite;
	}

	@keyframes wiggle {
		0%,
		100% {
			transform: rotate(0deg);
		}
		20% {
			transform: rotate(-5deg);
		}
		40% {
			transform: rotate(4deg);
		}
		60% {
			transform: rotate(0deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.wiggle .antennae {
			animation: none;
		}
	}
</style>
