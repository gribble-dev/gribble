import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

// Resolved by the Worker at request time: findings link to /rules/<id> for every rule in the
// registry, including rules that are added between site deploys.
export const prerender = false;

const RULES_REFERENCE = "/docs/configuration/rules-reference";

/** `/rules/links/broken` -> `/docs/configuration/rules-reference#links-broken`. */
export const GET: RequestHandler = ({ params }) => {
	const id = (params.id ?? "").replace(/\/+$/, "");
	if (!id) redirect(301, RULES_REFERENCE);

	const anchor = id
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	redirect(301, anchor ? `${RULES_REFERENCE}#${anchor}` : RULES_REFERENCE);
};
