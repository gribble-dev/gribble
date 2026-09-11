import type { TSchema } from "typebox";

export const GRIBBLE_CONFIG_SCHEMA_ID = "https://gribble.dev/schema/gribble.json";
export const RULES_CONFIG_SCHEMA_ID = "https://gribble.dev/schema/rules.json";
export const REPORT_SCHEMA_ID = "https://gribble.dev/schema/report.json";
export const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";

/**
 * Convert a TypeBox schema into a plain JSON Schema (draft 2020-12) document.
 * TypeBox emits tuples in draft-07 form (`items: []` + `additionalItems`); they are rewritten to `prefixItems`.
 */
export function toJsonSchema(schema: TSchema, id: string): Record<string, unknown> {
	const plain = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
	const body = upgradeTuples(plain) as Record<string, unknown>;
	return { $schema: JSON_SCHEMA_DIALECT, $id: id, ...body };
}

function upgradeTuples(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(upgradeTuples);
	if (node === null || typeof node !== "object") return node;
	const obj = node as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		if (key === "items" && Array.isArray(value)) {
			out.prefixItems = value.map(upgradeTuples);
			continue;
		}
		if (key === "additionalItems") {
			out.items = value;
			continue;
		}
		out[key] = upgradeTuples(value);
	}
	return out;
}
