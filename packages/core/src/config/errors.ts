import type { TLocalizedValidationError } from "typebox/error";

/** A configuration problem with the path of the offending value. Message is human-readable. */
export class ConfigError extends Error {
	/** Dot path to the invalid value, e.g. `target.url`. Empty for file-level problems. */
	readonly path: string;
	/** File the problem was found in, when known. */
	readonly file?: string;

	constructor(message: string, opts: { path?: string; file?: string } = {}) {
		const prefix = [opts.file, opts.path].filter(Boolean).join(": ");
		super(prefix ? `${prefix}: ${message}` : message);
		this.name = "ConfigError";
		this.path = opts.path ?? "";
		this.file = opts.file;
	}
}

/** `rules.links.broken` -> `rules.links/broken`: TypeBox does not escape `/` inside keys. */
function rejoinRuleIds(path: string): string {
	return path.replace(/(^|\.)rules\.([a-z0-9]+)\.([a-z0-9*-]+)/g, "$1rules.$2/$3");
}

/** JSON pointer (`/rules/links~1broken`) -> dot path (`rules.links/broken`). */
export function pointerToPath(pointer: string): string {
	if (!pointer) return "";
	return pointer
		.split("/")
		.slice(1)
		.map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"))
		.join(".");
}

/**
 * Pick the most useful error out of a TypeBox error list and phrase it for humans.
 * Union members produce a noisy list of `const`/`type` errors; those collapse into
 * "must be one of: ...".
 */
export function describeValidationErrors(errors: readonly TLocalizedValidationError[]): {
	path: string;
	message: string;
} {
	if (errors.length === 0) return { path: "", message: "invalid value" };
	// Prefer the deepest path: it points at the actual offending value.
	const deepest = errors.reduce((best, e) => (e.instancePath.length > best.instancePath.length ? e : best));
	const atPath = errors.filter((e) => e.instancePath === deepest.instancePath);
	const path = rejoinRuleIds(pointerToPath(deepest.instancePath));

	const specific = atPath.find((e) => !["const", "type", "anyOf", "oneOf", "enum"].includes(e.keyword));
	if (specific) {
		return { path, message: describeSingle(specific) };
	}
	const allowed = new Set<string>();
	for (const e of atPath) {
		if (e.keyword === "const")
			allowed.add(JSON.stringify((e.params as { allowedValue: unknown }).allowedValue));
		if (e.keyword === "enum") {
			for (const v of (e.params as { allowedValues: unknown[] }).allowedValues)
				allowed.add(JSON.stringify(v));
		}
	}
	if (allowed.size > 0) {
		const values = [...allowed].map((v) => v.replace(/^"(.*)"$/, "$1"));
		const hasTuple = atPath.some(
			(e) => e.keyword === "type" && (e.params as { type?: unknown }).type === "array",
		);
		const suffix = hasTuple ? " or [severity, { options }]" : "";
		return { path, message: `must be one of: ${values.join(", ")}${suffix}` };
	}
	const typeError = atPath.find((e) => e.keyword === "type");
	if (typeError) return { path, message: describeSingle(typeError) };
	return { path, message: deepest.message };
}

function describeSingle(e: TLocalizedValidationError): string {
	const params = e.params as Record<string, unknown>;
	switch (e.keyword) {
		case "required":
			return `missing required ${
				Array.isArray(params.requiredProperties) && params.requiredProperties.length === 1
					? "property"
					: "properties"
			}: ${(params.requiredProperties as string[]).join(", ")}`;
		case "additionalProperties":
			return `unknown ${
				Array.isArray(params.additionalProperties) && params.additionalProperties.length === 1
					? "property"
					: "properties"
			}: ${(params.additionalProperties as string[]).join(", ")}`;
		case "type":
			return `must be ${Array.isArray(params.type) ? (params.type as string[]).join(" or ") : String(params.type)}`;
		case "minimum":
		case "maximum":
		case "exclusiveMinimum":
		case "exclusiveMaximum":
			return `must be ${String(params.comparison)} ${String(params.limit)}`;
		case "minLength":
			return `must be at least ${String(params.limit)} characters`;
		case "maxLength":
			return `must be at most ${String(params.limit)} characters`;
		case "minItems":
			return `must have at least ${String(params.limit)} items`;
		case "maxItems":
			return `must have at most ${String(params.limit)} items`;
		case "pattern":
			return `must match pattern ${String(params.pattern)}`;
		default:
			return e.message;
	}
}
