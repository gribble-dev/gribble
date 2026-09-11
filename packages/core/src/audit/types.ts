/**
 * Public types of the audit orchestrator. Implemented by core-gate in src/audit/run-audit.ts.
 */
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AuditMode } from "../config/index.js";
import type { ProjectContext } from "../project/index.js";
import type { Finding, Report } from "../report/index.js";

export interface AuditGitInfo {
	commit?: string;
	branch?: string;
	baseCommit?: string;
	remote?: string;
}

export interface AuditOptions {
	project: ProjectContext;
	mode: AuditMode;
	/** CI mode: in-memory pi session, no interactive prompts. */
	ci?: boolean;
	/** Global agent dir (~/.gribble or ~/.pi/agent). */
	agentDir: string;
	/** Write .gribble/baseline/ from this run. */
	updateBaseline?: boolean;
	/** No baseline exists: generate one, do not diff. Detected automatically when omitted. */
	bootstrap?: boolean;
	onEvent?: (event: AuditEvent) => void;
	signal?: AbortSignal;
	/** Restrict the audit to these routes. */
	routes?: string[];
	/** Changed files (from git) for incremental audits. */
	changedFiles?: string[];
	env?: NodeJS.ProcessEnv;
	git?: AuditGitInfo;
}

export type AuditPhase = "prepare" | "server" | "routes" | "gate" | "review" | "baseline" | "report";

export type AuditEvent =
	| { type: "phase"; phase: AuditPhase; message: string }
	| { type: "log"; level: "debug" | "info" | "warn" | "error"; message: string }
	| { type: "route:start"; route: string; viewport?: string }
	| { type: "route:end"; route: string; viewport?: string; durationMs?: number }
	| { type: "check:start"; rule: string; route?: string }
	| { type: "check:end"; rule: string; route?: string; durationMs?: number; findings?: number }
	| { type: "flow:start"; flow: string }
	| { type: "flow:end"; flow: string; ok: boolean; durationMs?: number; error?: string }
	| { type: "finding"; finding: Finding }
	| { type: "agent"; event: AgentSessionEvent }
	| { type: "budget"; steps: number; maxSteps: number; tokens: number; maxTokens: number; costUsd: number }
	| { type: "done"; report: Report };

export type RunAudit = (options: AuditOptions) => Promise<Report>;
