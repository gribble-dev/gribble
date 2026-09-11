/**
 * Writes the JSON Schema files served from https://gribble.dev/schema/ into `static/schema/`.
 *
 * The schemas are owned by `@gribble/core`. When that package is not built yet (or does not
 * export a given schema factory), this script writes a placeholder instead of failing, so the
 * website can always be built on its own.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "static", "schema");

type SchemaFactory = () => object;

interface SchemaTarget {
	file: string;
	exportName: "gribbleConfigJsonSchema" | "rulesConfigJsonSchema" | "reportJsonSchema";
	id: string;
	title: string;
}

const targets: SchemaTarget[] = [
	{
		file: "gribble.json",
		exportName: "gribbleConfigJsonSchema",
		id: "https://gribble.dev/schema/gribble.json",
		title: "Gribble configuration (gribble.yaml)",
	},
	{
		file: "rules.json",
		exportName: "rulesConfigJsonSchema",
		id: "https://gribble.dev/schema/rules.json",
		title: "Gribble rules configuration (rules.yaml)",
	},
	{
		file: "report.json",
		exportName: "reportJsonSchema",
		id: "https://gribble.dev/schema/report.json",
		title: "Gribble report (report.json)",
	},
];

async function loadCore(): Promise<Record<string, unknown> | undefined> {
	try {
		return (await import("@gribble/core")) as unknown as Record<string, unknown>;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[schemas] @gribble/core is not importable yet (${message}).`);
		return undefined;
	}
}

function placeholder(target: SchemaTarget): object {
	return {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		$id: target.id,
		$comment: "generated at build time",
		title: target.title,
	};
}

async function main(): Promise<void> {
	await mkdir(outDir, { recursive: true });
	const core = await loadCore();
	let generated = 0;

	for (const target of targets) {
		let schema: object | undefined;
		const factory = core?.[target.exportName];
		if (typeof factory === "function") {
			try {
				const value = (factory as SchemaFactory)();
				if (value && typeof value === "object") {
					schema = value;
					generated += 1;
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.warn(`[schemas] ${target.exportName}() threw (${message}); writing a placeholder.`);
			}
		} else if (core) {
			console.warn(
				`[schemas] @gribble/core does not export ${target.exportName} yet; writing a placeholder.`,
			);
		}

		await writeFile(
			join(outDir, target.file),
			`${JSON.stringify(schema ?? placeholder(target), null, 2)}\n`,
			"utf8",
		);
	}

	console.log(
		`[schemas] wrote ${targets.length} file(s) to static/schema (${generated} from @gribble/core).`,
	);
}

await main();
