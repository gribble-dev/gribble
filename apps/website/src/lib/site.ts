export const site = {
	name: "Gribble",
	url: "https://gribble.dev",
	tagline: "Tiny bugs that find your bugs before you ship.",
	subline: "Let the gribbles chew on it before your users do.",
	description:
		"Gribble is an AI website audit agent that runs during development — before the PR, in CI, before release — and traces every finding back to your source.",
	github: "https://github.com/gribble-dev/gribble",
	npm: "https://www.npmjs.com/package/gribble",
} as const;

export function canonical(pathname: string): string {
	if (pathname === "/") return `${site.url}/`;
	return `${site.url}${pathname.replace(/\/$/, "")}`;
}
