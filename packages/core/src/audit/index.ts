// TODO(phase 2): owned by core-gate. runAudit is a throwing stub until the orchestrator lands.

import type { Report } from "../report/index.js";
import type { AuditOptions } from "./types.js";

export type * from "./types.js";

export async function runAudit(_options: AuditOptions): Promise<Report> {
	throw new Error("runAudit is not implemented yet");
}
