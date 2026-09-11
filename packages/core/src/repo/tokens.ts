/**
 * Design token extraction: Tailwind config files, Tailwind v4 `@theme` blocks and CSS custom
 * properties. Everything is regex-based; configs are never executed.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fg from "fast-glob";

export interface DesignTokens {
	/** Normalized lowercase `#rrggbb` values. */
	colors: Set<string>;
	/** Font sizes in CSS px, as numeric strings such as `14` or `17.5`. */
	fontSizes: Set<string>;
	/** Spacing values in CSS px, as numeric strings. */
	spacing: Set<string>;
	/** Files that contributed, relative to `targetDir`. */
	sources: string[];
}

const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
const RGB = /rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)/gi;
const HSL = /hsla?\(\s*([\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%\s*(?:[,/]\s*[\d.]+%?\s*)?\)/gi;
const LENGTH = /^(-?\d*\.?\d+)(px|rem|em)$/i;

function hex2(n: number): string {
	return Math.max(0, Math.min(255, Math.round(n)))
		.toString(16)
		.padStart(2, "0");
}

function hslToHex(h: number, s: number, l: number): string {
	const sat = s / 100;
	const light = l / 100;
	const c = (1 - Math.abs(2 * light - 1)) * sat;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = light - c / 2;
	let [r, g, b] = [0, 0, 0];
	if (h < 60) [r, g, b] = [c, x, 0];
	else if (h < 120) [r, g, b] = [x, c, 0];
	else if (h < 180) [r, g, b] = [0, c, x];
	else if (h < 240) [r, g, b] = [0, x, c];
	else if (h < 300) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	return `#${hex2((r + m) * 255)}${hex2((g + m) * 255)}${hex2((b + m) * 255)}`;
}

/** Normalize a CSS color literal to `#rrggbb`; returns undefined for anything else. */
export function normalizeColor(value: string): string | undefined {
	const v = value.trim().toLowerCase();
	const hex = v.match(/^#([0-9a-f]{3,8})$/);
	if (hex) {
		const digits = hex[1]!;
		if (digits.length === 3 || digits.length === 4) {
			return `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`;
		}
		if (digits.length === 6 || digits.length === 8) return `#${digits.slice(0, 6)}`;
		return undefined;
	}
	const rgb = new RegExp(RGB.source, "i").exec(v);
	if (rgb) return `#${hex2(Number(rgb[1]))}${hex2(Number(rgb[2]))}${hex2(Number(rgb[3]))}`;
	const hsl = new RegExp(HSL.source, "i").exec(v);
	if (hsl) return hslToHex(Number(hsl[1]) % 360, Number(hsl[2]), Number(hsl[3]));
	return undefined;
}

/** Convert a px/rem/em length to a numeric px string. */
export function lengthToPx(value: string, rootPx = 16): string | undefined {
	const m = value.trim().match(LENGTH);
	if (!m) return undefined;
	const n = Number(m[1]);
	const px = m[2]!.toLowerCase() === "px" ? n : n * rootPx;
	return String(Math.round(px * 100) / 100);
}

function collectColors(text: string, into: Set<string>): void {
	for (const m of text.matchAll(HEX)) {
		const norm = normalizeColor(m[0]);
		if (norm) into.add(norm);
	}
	for (const m of text.matchAll(RGB)) {
		const norm = normalizeColor(m[0]);
		if (norm) into.add(norm);
	}
	for (const m of text.matchAll(HSL)) {
		const norm = normalizeColor(m[0]);
		if (norm) into.add(norm);
	}
}

/** Extract the body of a `key: {` block from a JS/TS config, brace-balanced. */
function jsBlock(text: string, key: string): string | undefined {
	const re = new RegExp(`\\b${key}\\s*:\\s*\\{`, "g");
	const m = re.exec(text);
	if (!m) return undefined;
	let depth = 0;
	for (let i = m.index + m[0].length - 1; i < text.length; i++) {
		if (text[i] === "{") depth++;
		else if (text[i] === "}") {
			depth--;
			if (depth === 0) return text.slice(m.index + m[0].length, i);
		}
	}
	return undefined;
}

function collectLengths(text: string, into: Set<string>): void {
	for (const m of text.matchAll(/["'`](-?\d*\.?\d+(?:px|rem|em))["'`]/gi)) {
		const px = lengthToPx(m[1]!);
		if (px) into.add(px);
	}
}

function parseTailwindConfig(text: string, tokens: DesignTokens): void {
	const theme = jsBlock(text, "theme") ?? text;
	const colors = jsBlock(theme, "colors");
	if (colors) collectColors(colors, tokens.colors);
	else collectColors(theme, tokens.colors);
	const fontSize = jsBlock(theme, "fontSize");
	if (fontSize) collectLengths(fontSize, tokens.fontSizes);
	const spacing = jsBlock(theme, "spacing");
	if (spacing) collectLengths(spacing, tokens.spacing);
}

function parseCss(text: string, tokens: DesignTokens): boolean {
	let found = false;
	const inTheme = /@theme[^{]*\{([^}]*)\}/g;
	const props = /--([a-z0-9-]+)\s*:\s*([^;}]+)/gi;
	const scan = (block: string, themeBlock: boolean) => {
		for (const m of block.matchAll(props)) {
			const name = m[1]!.toLowerCase();
			const value = m[2]!.trim();
			const color = normalizeColor(value);
			if (color) {
				tokens.colors.add(color);
				found = true;
				continue;
			}
			const px = lengthToPx(value);
			if (!px) continue;
			if (
				name.startsWith("text-") ||
				name.includes("font-size") ||
				name.startsWith("fs-") ||
				name.startsWith("font-")
			) {
				tokens.fontSizes.add(px);
				found = true;
			} else if (
				name.startsWith("spacing") ||
				name.startsWith("space-") ||
				name.startsWith("gap") ||
				name.startsWith("size-")
			) {
				tokens.spacing.add(px);
				found = true;
			} else if (themeBlock) {
				tokens.spacing.add(px);
				found = true;
			}
		}
	};
	for (const m of text.matchAll(inTheme)) scan(m[1]!, true);
	for (const m of text.matchAll(/:root[^{]*\{([^}]*)\}/g)) scan(m[1]!, false);
	// Bare custom properties outside :root, e.g. in `html {}` or `[data-theme]` blocks.
	for (const m of text.matchAll(/\[data-theme[^{]*\{([^}]*)\}|html\s*\{([^}]*)\}/g))
		scan(m[1] ?? m[2] ?? "", false);
	return found;
}

const CSS_GLOBS = [
	"src/**/*.css",
	"styles/**/*.css",
	"app/**/*.css",
	"*.css",
	"src/**/*.pcss",
	"src/**/*.scss",
];
const IGNORE = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.next/**", "**/.svelte-kit/**"];

/** Read design tokens from Tailwind configs, `@theme` blocks and CSS custom properties. */
export async function readDesignTokens(targetDir: string): Promise<DesignTokens> {
	const tokens: DesignTokens = { colors: new Set(), fontSizes: new Set(), spacing: new Set(), sources: [] };
	const configs = await fg(["tailwind.config.{js,ts,cjs,mjs}"], { cwd: targetDir, ignore: IGNORE });
	for (const file of configs.sort()) {
		try {
			parseTailwindConfig(await readFile(join(targetDir, file), "utf8"), tokens);
			tokens.sources.push(file);
		} catch {
			// unreadable config: skip
		}
	}
	const cssFiles = (await fg(CSS_GLOBS, { cwd: targetDir, ignore: IGNORE, unique: true }))
		.sort()
		.slice(0, 200);
	for (const file of cssFiles) {
		try {
			if (parseCss(await readFile(join(targetDir, file), "utf8"), tokens)) tokens.sources.push(file);
		} catch {
			// skip
		}
	}
	return tokens;
}
