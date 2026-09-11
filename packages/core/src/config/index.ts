export { ConfigError, describeValidationErrors, pointerToPath } from "./errors.js";
export {
	GRIBBLE_CONFIG_SCHEMA_ID,
	JSON_SCHEMA_DIALECT,
	REPORT_SCHEMA_ID,
	RULES_CONFIG_SCHEMA_ID,
	toJsonSchema,
} from "./json-schema.js";
export {
	GRIBBLE_CONFIG_FILE,
	interpolateEnv,
	parseGribbleConfig,
	parseRulesConfig,
	RULES_CONFIG_FILE,
	validateAgainst,
} from "./parse.js";
export {
	type ResolvedRuleEntry,
	type ResolvedRuleSetting,
	type ResolvedRules,
	resolveRules,
} from "./resolve.js";
export {
	gribbleConfigSchema,
	ruleOverrideSchema,
	ruleSettingSchema,
	rulesConfigSchema,
	SEVERITIES,
	severitySchema,
} from "./schema.js";
export type * from "./types.js";

import { GRIBBLE_CONFIG_SCHEMA_ID, RULES_CONFIG_SCHEMA_ID, toJsonSchema } from "./json-schema.js";
import { gribbleConfigSchema, rulesConfigSchema } from "./schema.js";

/** JSON Schema (draft 2020-12) for gribble.yaml, `$id` https://gribble.dev/schema/gribble.json. */
export function gribbleConfigJsonSchema(): Record<string, unknown> {
	return toJsonSchema(gribbleConfigSchema, GRIBBLE_CONFIG_SCHEMA_ID);
}

/** JSON Schema (draft 2020-12) for rules.yaml, `$id` https://gribble.dev/schema/rules.json. */
export function rulesConfigJsonSchema(): Record<string, unknown> {
	return toJsonSchema(rulesConfigSchema, RULES_CONFIG_SCHEMA_ID);
}
