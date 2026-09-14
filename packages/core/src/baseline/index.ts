export { type BaselineDiff, diffAgainstBaseline } from "./diff.js";
export {
	BASELINE_DIR,
	type BaselinePaths,
	baselinePaths,
	baselineScreenshotPath,
	baselineSnapshotPath,
	LFS_GITATTRIBUTES,
	readBaseline,
	screenshotPlatformKey,
	type WriteBaselineInput,
	writeBaseline,
} from "./io.js";
export {
	type Baseline,
	type BaselineFinding,
	type BaselineFindingsFile,
	type BaselineMeta,
	type BaselineMetricsFile,
	baselineFindingSchema,
	baselineFindingsFileSchema,
	baselineMetaSchema,
	baselineMetricsFileSchema,
} from "./schema.js";
export { routeSlug } from "./slug.js";
