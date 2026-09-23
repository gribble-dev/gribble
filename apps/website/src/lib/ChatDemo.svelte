<script lang="ts">
	/**
	 * Example agent conversations, one per common request. Illustrative copy, not a recording:
	 * the commands and file names are what an agent following the skill would plausibly do.
	 */
	import Mascot from "$lib/Mascot.svelte";

	type Line = { kind: "ok" | "hole" | "dim"; text: string };
	type Message =
		| { from: "you"; text: string }
		| { from: "agent"; text: string }
		| { from: "run"; command: string; output?: Line[] };

	interface Scenario {
		id: string;
		label: string;
		messages: Message[];
	}

	const scenarios: Scenario[] = [
		{
			id: "setup",
			label: "Set up",
			messages: [
				{ from: "you", text: "Set up Gribble in this project by following https://gribble.dev/setup.md" },
				{ from: "run", command: "pnpm add -D gribble && pnpm exec gribble install" },
				{
					from: "run",
					command: 'pnpm exec gribble init --yes --url http://localhost:5173 --start "pnpm dev"',
					output: [
						{ kind: "ok", text: "✓ .gribble/ created" },
						{ kind: "ok", text: "✓ skill installed → .claude/skills/gribble/SKILL.md" },
					],
				},
				{
					from: "agent",
					text: "Installed. gribble models lists three recommended models your key can reach. Which one should the review use?",
				},
				{ from: "you", text: "The first one." },
				{
					from: "run",
					command: "pnpm exec gribble audit --mode gate",
					output: [{ kind: "dim", text: "No baseline yet — this run is the baseline. 14 findings recorded as known." }],
				},
				{
					from: "agent",
					text: "Done. Commit .gribble/ (runs/, sessions/ and cache/ are already ignored). Next time, ask me to fix what's new.",
				},
			],
		},
		{
			id: "fix",
			label: "Fix findings",
			messages: [
				{ from: "you", text: "Fix whatever Gribble finds on this branch." },
				{
					from: "run",
					command: "pnpm exec gribble audit --mode gate",
					output: [
						{ kind: "hole", text: "error  a11y/form-labels  /signup   src/lib/SignupForm.svelte:18" },
						{ kind: "hole", text: "error  links/broken      /pricing  → /pricing/enterprise 404" },
						{ kind: "dim", text: "14 existing, not reported" },
					],
				},
				{
					from: "agent",
					text: "Two new holes. Added a <label> to the email input and pointed the Enterprise link at /contact?plan=enterprise.",
				},
				{
					from: "run",
					command: "pnpm exec gribble audit --mode gate",
					output: [{ kind: "ok", text: "The gribbles went hungry. Ship it." }],
				},
			],
		},
		{
			id: "flow",
			label: "Add a flow",
			messages: [
				{
					from: "you",
					text: "Add a flow for checkout: a guest adds a mug to the cart, pays with the test card and sees an order number.",
				},
				{
					from: "agent",
					text: "Wrote .gribble/flows/guest-checkout.md with the intent and the outcome to check. No selectors — the review agent finds its own way.",
				},
				{
					from: "run",
					command: "pnpm exec gribble audit --mode review",
					output: [
						{ kind: "ok", text: "✓ flow guest-checkout  passed in 41s" },
						{ kind: "dim", text: "replay sidecar written → guest-checkout.replay.json" },
					],
				},
				{ from: "agent", text: "It passes, and gate will now replay it on every run without a model." },
			],
		},
		{
			id: "rule",
			label: "Add a rule",
			messages: [
				{ from: "you", text: "From now on, buttons must be at least 44px tall, and error messages must say what to do next." },
				{
					from: "agent",
					text: "The first is mechanical, so it goes in rules.yaml as a11y/touch-target at error. The second needs judgement, so it goes in guidelines.md for the review.",
				},
				{
					from: "run",
					command: "pnpm exec gribble audit --mode gate",
					output: [{ kind: "hole", text: "error  a11y/touch-target  /cart  button.qty 32×32px" }],
				},
				{ from: "agent", text: "The new rule already caught the quantity stepper on /cart. Want me to fix it?" },
			],
		},
	];

	let active = $state(scenarios[0]!.id);
	let current = $derived(scenarios.find((s) => s.id === active) ?? scenarios[0]!);

	function onKey(event: KeyboardEvent, index: number) {
		const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
		if (!step) return;
		event.preventDefault();
		const next = scenarios[(index + step + scenarios.length) % scenarios.length]!;
		active = next.id;
		document.getElementById(`chat-tab-${next.id}`)?.focus();
	}
</script>

<div class="chat">
	<div class="tabs" role="tablist" aria-label="Example requests">
		{#each scenarios as scenario, index (scenario.id)}
			<button
				type="button"
				role="tab"
				id={`chat-tab-${scenario.id}`}
				aria-selected={active === scenario.id}
				aria-controls="chat-panel"
				tabindex={active === scenario.id ? 0 : -1}
				onclick={() => (active = scenario.id)}
				onkeydown={(event) => onKey(event, index)}
			>
				{scenario.label}
			</button>
		{/each}
	</div>

	<div id="chat-panel" role="tabpanel" aria-labelledby={`chat-tab-${current.id}`}>
		<ol class="log">
			{#each current.messages as message, index (`${current.id}-${index}`)}
				{#if message.from === "you"}
					<li class="bubble you"><span class="visually-hidden">You: </span>{message.text}</li>
				{:else if message.from === "agent"}
					<li class="bubble agent">
						<span class="visually-hidden">Agent: </span>
						{message.text}
					</li>
				{:else}
					<li class="run">
						<span class="visually-hidden">Agent ran: </span>
						<code class="cmd"><span aria-hidden="true">$&nbsp;</span>{message.command}</code>
						{#if message.output}
							{#each message.output as line (line.text)}
								<code class={`out ${line.kind}`}>{line.text}</code>
							{/each}
						{/if}
					</li>
				{/if}
			{/each}
		</ol>
	</div>

	<p class="foot">
		<Mascot size={22} decorative />
		<span>Example conversation. Works with Claude Code, Cursor, Codex, pi, or any agent that can run commands.</span>
	</p>
</div>

<style>
	.chat {
		background: var(--bg-raised);
		border: 2px solid var(--outline);
		border-radius: var(--radius-lg);
		box-shadow: var(--sticker-shadow);
		overflow: hidden;
		display: grid;
		min-width: 0;
	}

	.tabs {
		display: flex;
		gap: var(--space-1);
		padding: var(--space-2);
		background: var(--bg-water);
		border-bottom: 2px solid var(--outline);
		overflow-x: auto;
	}

	.tabs button {
		flex: none;
		min-height: 40px;
		padding: 0 var(--space-4);
		border: 2px solid transparent;
		border-radius: var(--radius-pill);
		background: transparent;
		color: var(--text-muted);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
	}

	.tabs button:hover {
		color: var(--text);
	}

	.tabs button[aria-selected="true"] {
		background: var(--bg-raised);
		border-color: var(--outline);
		color: var(--text);
	}

	.log {
		list-style: none;
		margin: 0;
		padding: var(--space-4);
		display: grid;
		gap: var(--space-3);
		align-content: start;
		min-height: 25rem;
		font-size: 0.95rem;
	}

	.bubble {
		max-width: 88%;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius) var(--radius) var(--radius) 4px;
		background: var(--bg-sunken);
		border: 1.5px solid var(--border-strong);
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	.bubble.you {
		justify-self: end;
		background: var(--bubble-you);
		border-color: var(--bubble-you);
		color: var(--on-bubble-you);
		border-radius: var(--radius) var(--radius) 4px var(--radius);
	}

	.run {
		display: grid;
		gap: 2px;
		padding: var(--space-2) var(--space-3);
		border-left: 3px solid var(--coral);
		background: var(--bg-code);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
		min-width: 0;
		overflow-x: auto;
	}

	.run code {
		display: block;
		background: none;
		border: 0;
		border-radius: 0;
		padding: 0;
		font-size: 0.8rem;
		line-height: 1.55;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.cmd {
		color: var(--text);
		font-weight: 600;
	}

	.out.ok {
		color: var(--ok);
	}

	.out.hole {
		color: var(--danger);
	}

	.out.dim {
		color: var(--text-faint);
	}

	.foot {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
		padding: var(--space-2) var(--space-4) var(--space-3);
		color: var(--text-faint);
		font-size: 0.82rem;
	}

	@media (max-width: 520px) {
		.log {
			min-height: 0;
		}

		.bubble {
			max-width: 96%;
		}
	}
</style>
