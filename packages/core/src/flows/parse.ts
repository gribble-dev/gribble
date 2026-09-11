import { basename } from "node:path";
import { Value } from "typebox/value";
import { parse as parseYaml } from "yaml";
import { ConfigError, describeValidationErrors } from "../config/errors.js";
import { isPlainObject } from "../util/index.js";
import {
	type Flow,
	type FlowFrontmatter,
	type FlowReplay,
	flowFrontmatterSchema,
	flowReplaySchema,
} from "./schema.js";

const FRONTMATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)([\s\S]*)$/;

/** Split `---` frontmatter from the body. Files without frontmatter return an empty object. */
export function splitFrontmatter(text: string): { frontmatter: string; body: string } {
	const match = FRONTMATTER.exec(text);
	if (!match) return { frontmatter: "", body: text };
	return { frontmatter: match[1] ?? "", body: match[2] ?? "" };
}

/** Parse one flows/*.md file. `name` defaults to the file name without extension. */
export function parseFlow(file: string, text: string): Flow {
	const { frontmatter, body } = splitFrontmatter(text.replace(/^﻿/, ""));
	let raw: unknown = {};
	if (frontmatter.trim()) {
		try {
			raw = parseYaml(frontmatter) ?? {};
		} catch (err) {
			throw new ConfigError(`invalid frontmatter: ${(err as Error).message.split("\n")[0]}`, { file });
		}
	}
	if (!isPlainObject(raw)) throw new ConfigError("frontmatter must be a YAML mapping", { file });
	if (!Value.Check(flowFrontmatterSchema, raw)) {
		const { path, message } = describeValidationErrors(Value.Errors(flowFrontmatterSchema, raw));
		throw new ConfigError(message, { file, path });
	}
	const fm: FlowFrontmatter = raw;
	const flow: Flow = {
		name: fm.name?.trim() || basename(file).replace(/\.md$/i, ""),
		file,
		description: body.trim(),
	};
	const requiresAuth = fm.requires_auth ?? fm.requiresAuth;
	if (requiresAuth !== undefined && requiresAuth !== false) flow.requiresAuth = requiresAuth;
	if (fm.env) flow.env = fm.env;
	if (fm.tags) flow.tags = fm.tags;
	return flow;
}

/** Parse and validate a `<name>.replay.json` sidecar. */
export function parseFlowReplay(file: string, text: string): FlowReplay {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (err) {
		throw new ConfigError(`invalid JSON: ${(err as Error).message}`, { file });
	}
	if (!Value.Check(flowReplaySchema, raw)) {
		const { path, message } = describeValidationErrors(Value.Errors(flowReplaySchema, raw));
		throw new ConfigError(message, { file, path });
	}
	return raw;
}
