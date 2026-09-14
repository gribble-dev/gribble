<script lang="ts">
	/**
	 * A mock-up of the summary comment Gribble leaves on a pull request. Static markup — the copy
	 * below is illustrative and does not come from a real run.
	 */
	import Mascot from "$lib/Mascot.svelte";

	interface Finding {
		severity: "critical" | "error" | "warn";
		rule: string;
		title: string;
		route: string;
		location: string;
		detail: string;
		fix: string;
	}

	const findings: Finding[] = [
		{
			severity: "error",
			rule: "links/broken",
			title: "Link to /pricing/enterprise returns 404",
			route: "/pricing",
			location: "src/routes/pricing/+page.svelte — PlanTable",
			detail: 'The "Talk to sales" link in the Enterprise column points at /pricing/enterprise, which no route serves.',
			fix: "Point it at /contact?plan=enterprise or add the missing route."
		},
		{
			severity: "error",
			rule: "a11y/form-labels",
			title: "Email field has no accessible name",
			route: "/signup",
			location: "src/lib/components/SignupForm.svelte — EmailInput",
			detail: "The input is labelled only by hint text, so screen readers announce it as an unnamed edit field.",
			fix: "Add <label for=\"email\"> or aria-label to the input."
		},
		{
			severity: "warn",
			rule: "review/copy",
			title: "Checkout step 2 has no way back",
			route: "/checkout/shipping",
			location: "src/routes/checkout/shipping/+page.svelte",
			detail:
				"Shipping is the only step without a back control; correcting the address requires restarting the flow. Confidence 0.82.",
			fix: "Add a back link to /checkout/cart that preserves the entered address."
		}
	];

	const severityLabel: Record<Finding["severity"], string> = {
		critical: "Critical",
		error: "Error",
		warn: "Warn"
	};
</script>

<figure class="pr">
	<figcaption class="pr-head">
		<span class="avatar"><Mascot size={28} decorative /></span>
		<span class="who"><strong>gribble</strong> <span class="bot">bot</span> commented 2 minutes ago</span>
	</figcaption>

	<div class="pr-body">
		<h3 class="pr-title">The gribbles found 7 holes in your hull — 2 need patching before you sail.</h3>

		<p class="gate">
			<span class="badge fail">Gate: fail</span>
			<span class="badge neutral">2 new blocking</span>
			<span class="badge neutral">3 new advisory</span>
			<span class="badge neutral">2 already on main</span>
		</p>

		<table class="counts">
			<caption>New findings by severity</caption>
			<thead>
				<tr>
					<th scope="col">Severity</th>
					<th scope="col">Count</th>
				</tr>
			</thead>
			<tbody>
				<tr><th scope="row">Critical</th><td>0</td></tr>
				<tr><th scope="row">Error</th><td>2</td></tr>
				<tr><th scope="row">Warn</th><td>3</td></tr>
				<tr><th scope="row">Info</th><td>2</td></tr>
			</tbody>
		</table>

		<ol class="findings">
			{#each findings as finding (finding.rule + finding.route)}
				<li>
					<p class="f-head">
						<span class={`sev ${finding.severity}`}>{severityLabel[finding.severity]}</span>
						<a class="rule" href={`/rules/${finding.rule}`}>{finding.rule}</a>
						<span class="route">{finding.route}</span>
					</p>
					<p class="f-title">{finding.title}</p>
					<p class="f-loc"><code>{finding.location}</code></p>
					<p class="f-detail">{finding.detail}</p>
					<p class="f-fix"><strong>Fix:</strong> {finding.fix}</p>
				</li>
			{/each}
		</ol>

		<p class="more">Showing 3 of 7 holes. The rest are in the full report.</p>
	</div>
</figure>

<style>
	.pr {
		margin: var(--space-6) 0;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-lg);
		background: var(--bg-raised);
		overflow: hidden;
		box-shadow: var(--shadow);
		max-width: 760px;
	}

	.pr-head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--bg-sunken);
		border-bottom: 1px solid var(--border);
		font-size: 0.9rem;
		color: var(--text-muted);
	}

	.avatar {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: 999px;
		background: var(--accent-soft);
	}

	.who strong {
		color: var(--text);
	}

	.bot {
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		padding: 0 0.4rem;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.pr-body {
		padding: var(--space-4) var(--space-4) var(--space-6);
	}

	.pr-title {
		font-size: 1.05rem;
		margin-bottom: var(--space-3);
	}

	.gate {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}

	.badge {
		font-size: 0.8rem;
		font-weight: 650;
		border-radius: 999px;
		padding: 0.15rem 0.65rem;
		border: 1px solid var(--border-strong);
		color: var(--text-muted);
	}

	.badge.fail {
		background: var(--danger-soft);
		border-color: transparent;
		color: var(--danger);
	}

	.counts {
		width: auto;
		min-width: 16rem;
		font-size: 0.9rem;
		margin-bottom: var(--space-6);
	}

	.counts caption {
		text-align: left;
		color: var(--text-faint);
		font-size: 0.82rem;
		padding-bottom: var(--space-1);
	}

	.findings {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-3);
	}

	.findings li {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: var(--space-3) var(--space-4);
		background: var(--bg);
	}

	.findings p {
		margin: 0 0 var(--space-1);
	}

	.f-head {
		/* Inline flow (not flex) so the rule link stays an inline text link. */
		display: block;
		line-height: 1.9;
		font-size: 0.84rem;
	}

	.f-head > * + * {
		margin-left: var(--space-2);
	}

	.sev {
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-weight: 700;
		font-size: 0.75rem;
		border-radius: var(--radius-sm);
		padding: 0.1rem 0.45rem;
	}

	.sev.critical,
	.sev.error {
		background: var(--danger-soft);
		color: var(--danger);
	}

	.sev.warn {
		background: var(--warn-soft);
		color: var(--warn);
	}

	.rule {
		font-family: var(--font-mono);
		font-size: 0.82rem;
	}

	.route {
		color: var(--text-faint);
		font-family: var(--font-mono);
		font-size: 0.82rem;
	}

	.f-title {
		font-weight: 650;
	}

	.f-loc code {
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.f-detail,
	.f-fix {
		color: var(--text-muted);
		font-size: 0.92rem;
	}

	.more {
		margin: var(--space-4) 0 0;
		color: var(--text-faint);
		font-size: 0.9rem;
	}
</style>
