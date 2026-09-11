export { findGribbleDirs, GRIBBLE_DIR_NAME } from "./discover.js";
export { detectRootGitignoreConflict, gitignorePatternIgnoresGribbleDir } from "./gitignore.js";
export { findRepoRoot, GUIDELINES_FILE, loadProject } from "./load.js";
export { type InitTemplateOptions, renderInitTemplates } from "./templates.js";
export type { ProjectContext } from "./types.js";
