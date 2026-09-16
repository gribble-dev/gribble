import type { RuleSetting } from "../config/types.js";
import { type PresetName, RULES } from "./registry.js";

export const PRESET_IDS = ["gribble:recommended", "gribble:strict", "gribble:seo", "gribble:a11y"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

const PRESET_KEY: Record<PresetId, PresetName> = {
	"gribble:recommended": "recommended",
	"gribble:strict": "strict",
	"gribble:seo": "seo",
	"gribble:a11y": "a11y",
};

function buildPreset(name: PresetName): Record<string, RuleSetting> {
	const out: Record<string, RuleSetting> = {};
	for (const rule of RULES) {
		out[rule.id] = rule.presets[name] ?? "off";
	}
	return out;
}

/**
 * Built-in presets, fully expanded (every rule id present).
 * - `gribble:recommended`: the defaults from the product brief; `gribble init` uses it.
 * - `gribble:strict`: recommended with `warn` promoted to `error` for links, network, seo, a11y, html and security, plus `visual/regression` on.
 * - `gribble:seo`: every implemented `seo/*` rule on, everything else off.
 * - `gribble:a11y`: every implemented `a11y/*` rule on, everything else off.
 *
 * A rule with no checker yet (`implemented: false`) is off in all of them; see `derivePresets`.
 */
export const PRESETS: Record<PresetId, Record<string, RuleSetting>> = {
	"gribble:recommended": buildPreset("recommended"),
	"gribble:strict": {
		...buildPreset("strict"),
		// Pixel comparison is opt-in for everyone else; strict projects get it (with `baseline.screenshots` set).
		"visual/regression": ["warn", { threshold: 0.01, viewports: ["mobile", "desktop"] }],
	},
	"gribble:seo": buildPreset("seo"),
	"gribble:a11y": buildPreset("a11y"),
};

export function isPresetId(value: string): value is PresetId {
	return value in PRESET_KEY;
}
