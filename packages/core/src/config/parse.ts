import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { parse as parseYaml, YAMLParseError } from "yaml";
import { isRuleKey } from "../rules/ids.js";
import { deepMerge, isPlainObject } from "../util/index.js";
import { ConfigError, describeValidationErrors } from "./errors.js";
import { gribbleConfigSchema, rulesConfigSchema } from "./schema.js";
import type { GribbleConfig, RulesConfig } from "./types.js";

export const GRIBBLE_CONFIG_FILE = "gribble.yaml";
export const RULES_CONFIG_FILE = "rules.yaml";

function parseYamlMapping(text: string, file: string): Record<string, unknown> {
	let raw: unknown;
	try {
		raw = parseYaml(text);
	} catch (err) {
		const detail = err instanceof YAMLParseError ? err.message.split("\n")[0] : String(err);
		throw new ConfigError(`invalid YAML: ${detail}`, { file });
	}
	if (raw === null || raw === undefined) return {};
	if (!isPlainObject(raw)) throw new ConfigError("must be a YAML mapping at the top level", { file });
	// A key with only comments under it (`rules:`) parses as null; treat it as absent.
	for (const key of Object.keys(raw)) if (raw[key] === null) delete raw[key];
	return raw;
}

export function validateAgainst<T>(schema: TSchema, value: unknown, file: string): T {
	if (Value.Check(schema, value)) return value as T;
	const { path, message } = describeValidationErrors(Value.Errors(schema, value));
	throw new ConfigError(message, { file, path });
}

const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Replace `${VAR}` placeholders in every string value. Throws a ConfigError naming the variable
 * and the config path when a referenced variable is not set.
 */
export function interpolateEnv<T>(value: T, env: NodeJS.ProcessEnv, file: string, path = ""): T {
	if (typeof value === "string") {
		return value.replace(PLACEHOLDER, (_m, name: string) => {
			const found = env[name];
			if (found === undefined) {
				throw new ConfigError(`environment variable ${name} is not set (referenced by \${${name}})`, {
					file,
					path,
				});
			}
			return found;
		}) as T;
	}
	if (Array.isArray(value)) {
		return value.map((item, i) => interpolateEnv(item, env, file, path ? `${path}.${i}` : String(i))) as T;
	}
	if (isPlainObject(value)) {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			out[key] = interpolateEnv(item, env, file, path ? `${path}.${key}` : key);
		}
		return out as T;
	}
	return value;
}

/**
 * Parse and validate gribble.yaml.
 * Order: YAML -> select `environments.<name>` (deep merge over the top level) -> `${VAR}` interpolation
 * (the `environments` block itself is left alone so inactive environments may reference unset variables)
 * -> defaults -> schema validation.
 */
export function parseGribbleConfig(
	yamlText: string,
	opts: { env?: NodeJS.ProcessEnv; environment?: string; file?: string } = {},
): GribbleConfig {
	const file = opts.file ?? GRIBBLE_CONFIG_FILE;
	const env = opts.env ?? process.env;
	const raw = parseYamlMapping(yamlText, file);
	// Unknown rule ids under `environments.<name>.rules` get the same dedicated message as rules.yaml.
	if (isPlainObject(raw.environments)) {
		for (const [name, override] of Object.entries(raw.environments)) {
			if (isPlainObject(override)) assertKnownRuleKeys(override.rules, file, `environments.${name}.rules`);
		}
	}

	let merged: Record<string, unknown> = raw;
	if (opts.environment) {
		const environments = raw.environments;
		const available = isPlainObject(environments) ? Object.keys(environments) : [];
		const override = isPlainObject(environments) ? environments[opts.environment] : undefined;
		if (!isPlainObject(override)) {
			const hint =
				available.length > 0 ? `Available: ${available.join(", ")}` : "No environments are defined";
			throw new ConfigError(`unknown environment "${opts.environment}". ${hint}`, {
				file,
				path: "environments",
			});
		}
		// `rules` is not a gribble.yaml setting: the rules resolver reads it from `environments` itself.
		const { rules: _rules, ...settings } = override;
		merged = deepMerge(raw, settings);
	}

	const { environments, ...rest } = merged;
	const interpolated: Record<string, unknown> = interpolateEnv(rest, env, file);
	if (environments !== undefined) interpolated.environments = environments;

	const defaulted = Value.Default(gribbleConfigSchema, interpolated);
	return validateAgainst<GribbleConfig>(gribbleConfigSchema, defaulted, file);
}

function assertKnownRuleKeys(rules: unknown, file: string, path: string): void {
	if (!isPlainObject(rules)) return;
	for (const key of Object.keys(rules)) {
		if (!isRuleKey(key)) {
			throw new ConfigError(
				`unknown rule "${key}". See https://gribble.dev/docs/configuration/rules-reference for the list of rule ids.`,
				{ file, path: `${path}.${key}` },
			);
		}
	}
}

/** Parse and validate rules.yaml. Missing sections become empty values. */
export function parseRulesConfig(yamlText: string, opts: { file?: string } = {}): RulesConfig {
	const file = opts.file ?? RULES_CONFIG_FILE;
	const raw = parseYamlMapping(yamlText, file);
	// Unknown rule ids get a dedicated message before the schema's additionalProperties check runs.
	assertKnownRuleKeys(raw.rules, file, "rules");
	if (Array.isArray(raw.overrides)) {
		raw.overrides.forEach((override, i) => {
			if (isPlainObject(override)) assertKnownRuleKeys(override.rules, file, `overrides.${i}.rules`);
		});
	}
	// Top-level defaults only: rule options stay exactly as written so the cascade can tell
	// "not specified" from "set to the default".
	const withDefaults = { extends: [], ignore: [], rules: {}, overrides: [], ...raw };
	const validated = validateAgainst<Required<RulesConfig>>(rulesConfigSchema, withDefaults, file);
	return {
		extends: validated.extends,
		ignore: validated.ignore,
		rules: validated.rules,
		overrides: validated.overrides,
	};
}
