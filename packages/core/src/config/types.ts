/** Severity of a rule setting in rules.yaml. `off` disables the rule. */
export type Severity = "off" | "info" | "warn" | "error" | "critical";

/** Which half of the audit to run. */
export type AuditMode = "gate" | "review" | "all";

/** A rule setting: a bare severity or `[severity, options]`. */
export type RuleSetting = Severity | [Severity, Record<string, unknown>];

/** Per-route override block in rules.yaml. */
export interface RuleOverride {
	routes: string[];
	rules: Record<string, RuleSetting>;
}

/** Validated rules.yaml. Missing sections are normalized to empty values. */
export interface RulesConfig {
	extends?: string[];
	ignore: string[];
	rules: Record<string, RuleSetting>;
	overrides: RuleOverride[];
}

export interface TargetConfig {
	/** Base URL of the site under audit. */
	url: string;
	/** Optional command that starts the dev server; Gribble waits until `url` responds. */
	start?: string;
	/** `auto` (from the framework's route files), `crawl` (follow links) or an explicit list of paths. */
	routes: "auto" | "crawl" | string[];
	/** How long to wait for `url` to respond after `start`, in milliseconds. */
	readyTimeoutMs: number;
	/** Consecutive routes refused at the socket before the audit stops; 0 disables the check. */
	maxConnectionFailures: number;
}

export interface ReviewConfig {
	max_comments: number;
	min_confidence: number;
	vision: boolean;
	explore: boolean;
}

export interface BudgetConfig {
	max_steps: number;
	max_tokens: number;
	max_cost_usd?: number;
}

export interface FlowAuthProfile {
	type: "flow";
	flow: string;
	env?: Record<string, string>;
}

export interface CommandAuthProfile {
	type: "command";
	command: string;
}

export interface CookieAuthProfile {
	type: "cookie";
	env: { value: string };
	name: string;
	domain?: string;
}

export interface HeaderAuthProfile {
	type: "header";
	env: { value: string };
	name: string;
}

export type AuthProfile = FlowAuthProfile | CommandAuthProfile | CookieAuthProfile | HeaderAuthProfile;

export interface AuthConfig {
	profiles: Record<string, AuthProfile>;
}

export interface BaselineConfig {
	screenshots: "commit" | "lfs" | "off";
	update: "commit" | "pr" | "manual";
}

/** Coverage that must execute; a miss fails the gate. All off by default. */
export interface CoverageRequirements {
	routes: boolean;
	/** `true` for every flow in scope, or the names of the flows that must execute. */
	flows: boolean | string[];
	checks: boolean;
	baseline: boolean;
}

export interface CoverageConfig {
	required: CoverageRequirements;
}

export interface Viewport {
	width: number;
	height: number;
}

export interface OutputConfig {
	dir: string;
	keep: number;
}

/** Values allowed under `environments.<name>`; deep-merged over the top level when `--env <name>` is given. */
export interface EnvironmentOverride {
	target?: Partial<TargetConfig>;
	model?: string;
	review?: Partial<ReviewConfig>;
	budget?: Partial<BudgetConfig>;
	allowed_origins?: string[];
	auth?: AuthConfig;
	baseline?: Partial<BaselineConfig>;
	coverage?: { required?: Partial<CoverageRequirements> };
	viewports?: Record<string, Viewport>;
	output?: Partial<OutputConfig>;
	reusePiAuth?: boolean;
	/** Rule settings applied after the whole rules.yaml cascade when this environment is selected. */
	rules?: Record<string, RuleSetting>;
}

/** Validated gribble.yaml with defaults applied. */
export interface GribbleConfig {
	target: TargetConfig;
	/** Model in pi syntax: `provider/id` or `provider/id:thinking`. */
	model?: string;
	review: ReviewConfig;
	budget: BudgetConfig;
	allowed_origins: string[];
	environments?: Record<string, EnvironmentOverride>;
	auth?: AuthConfig;
	baseline: BaselineConfig;
	/** Filled with defaults by the parser; optional for hand-built configs. */
	coverage?: CoverageConfig;
	viewports: Record<string, Viewport>;
	output: OutputConfig;
	reusePiAuth: boolean;
}
