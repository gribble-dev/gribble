<script lang="ts">
	/**
	 * A sentence to paste into a coding agent, with a copy button. The same look is used for
	 * ```prompt blocks inside the docs (see `renderMarkdown`), where a delegated click handler
	 * in the docs layout does the copying.
	 */
	import { copyText } from "$lib/copy";

	interface Props {
		prompt: string;
		label?: string;
		/** Small print under the prompt. */
		note?: string;
		size?: "normal" | "large";
	}

	let { prompt, label = "Ask your agent", note = "", size = "normal" }: Props = $props();

	let status: "idle" | "copied" | "selected" = $state("idle");
	let timer: ReturnType<typeof setTimeout> | undefined;
	let text: HTMLElement | undefined = $state();

	async function copy() {
		status = (await copyText(prompt, text)) ? "copied" : "selected";
		clearTimeout(timer);
		timer = setTimeout(() => (status = "idle"), 1800);
	}
</script>

<figure class={`prompt-card ${size}`}>
	<figcaption class="prompt-label">{label}</figcaption>
	<div class="prompt-row">
		<p class="prompt-text" bind:this={text}>{prompt}</p>
		<button type="button" class="prompt-copy" onclick={copy} aria-live="polite">
			{status === "copied" ? "Copied" : status === "selected" ? "Selected" : "Copy"}
		</button>
	</div>
	{#if note}
		<p class="prompt-note">{note}</p>
	{/if}
</figure>
