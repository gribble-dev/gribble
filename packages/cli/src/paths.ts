import { relative } from "node:path";

/** A repository-relative path for terminal output and target names: always forward slashes, never empty. */
export function displayPath(from: string, to: string): string {
	const rel = relative(from, to).split("\\").join("/");
	return rel === "" ? "." : rel;
}
