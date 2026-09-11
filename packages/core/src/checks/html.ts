/**
 * html/* — doctype, charset, viewport meta, duplicate ids.
 */
import type { Finding } from "../report/schema.js";
import { report, ruleEnabled, truncate } from "./finding.js";
import type { CheckContext } from "./types.js";

interface HtmlInfo {
	doctype: { name: string; publicId: string; systemId: string } | null;
	charset: string | null;
	httpEquivCharset: string | null;
	viewport: string | null;
	duplicateIds: Array<{ id: string; count: number; tags: string[] }>;
}

function collectHtml(): HtmlInfo {
	const counts = new Map<string, { count: number; tags: string[] }>();
	for (const el of Array.from(document.querySelectorAll("[id]"))) {
		const id = el.getAttribute("id") ?? "";
		if (!id) continue;
		const entry = counts.get(id) ?? { count: 0, tags: [] };
		entry.count += 1;
		if (entry.tags.length < 3) entry.tags.push(el.tagName.toLowerCase());
		counts.set(id, entry);
	}
	const duplicateIds = [...counts.entries()]
		.filter(([, v]) => v.count > 1)
		.map(([id, v]) => ({ id, count: v.count, tags: v.tags }));
	const httpEquiv =
		document.querySelector('meta[http-equiv="Content-Type" i]')?.getAttribute("content") ?? null;
	return {
		doctype: document.doctype
			? {
					name: document.doctype.name,
					publicId: document.doctype.publicId,
					systemId: document.doctype.systemId,
				}
			: null,
		charset: document.querySelector("meta[charset]")?.getAttribute("charset") ?? null,
		httpEquivCharset: httpEquiv?.match(/charset=([^;\s]+)/i)?.[1] ?? null,
		viewport: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? null,
		duplicateIds,
	};
}

/** html/doctype, html/charset, html/viewport-meta, html/duplicate-ids. */
export async function checkHtml(ctx: CheckContext): Promise<Finding[]> {
	const out: Finding[] = [];
	const rules = ["html/doctype", "html/charset", "html/viewport-meta", "html/duplicate-ids"];
	if (!rules.some((r) => ruleEnabled(ctx, r))) return out;
	const info = await ctx.page.raw.evaluate(collectHtml);

	if (ruleEnabled(ctx, "html/doctype")) {
		if (!info.doctype) {
			report(ctx, out, "html/doctype", {
				title: "Document has no doctype",
				message: "Without <!DOCTYPE html> browsers render in quirks mode.",
				subject: "missing",
				location: { path: "document" },
			});
		} else if (info.doctype.name.toLowerCase() !== "html" || info.doctype.publicId || info.doctype.systemId) {
			report(ctx, out, "html/doctype", {
				title: "Document uses a legacy doctype",
				message: `Found <!DOCTYPE ${info.doctype.name}${info.doctype.publicId ? ` PUBLIC "${info.doctype.publicId}"` : ""}>; use <!DOCTYPE html>.`,
				subject: "legacy",
				location: { path: "document" },
			});
		}
	}

	if (ruleEnabled(ctx, "html/charset")) {
		const headerCharset = (
			ctx.cache?.navigation?.headers?.["content-type"] ??
			ctx.page.lastNavigation()?.headers?.["content-type"] ??
			""
		).match(/charset=([^;\s]+)/i)?.[1];
		const declared = info.charset ?? info.httpEquivCharset ?? headerCharset;
		if (!declared) {
			report(ctx, out, "html/charset", {
				title: "Document declares no charset",
				message: "Neither <meta charset> nor the Content-Type header names an encoding.",
				subject: "missing",
				location: { selector: "head" },
			});
		} else if (declared.toLowerCase().replace(/[^a-z0-9]/g, "") !== "utf8") {
			report(ctx, out, "html/charset", {
				title: `Document charset is ${declared}, not UTF-8`,
				message: `The declared encoding is "${declared}".`,
				subject: declared.toLowerCase(),
				location: { selector: "head" },
			});
		}
	}

	if (ruleEnabled(ctx, "html/viewport-meta") && !info.viewport) {
		report(ctx, out, "html/viewport-meta", {
			title: "Document has no viewport meta tag",
			message: "Mobile browsers will render the desktop layout and zoom out.",
			subject: "missing",
			location: { selector: "head" },
		});
	}

	if (ruleEnabled(ctx, "html/duplicate-ids")) {
		for (const dup of info.duplicateIds.slice(0, 20)) {
			report(ctx, out, "html/duplicate-ids", {
				title: `id="${truncate(dup.id, 40)}" is used ${dup.count} times`,
				message: `Elements: ${dup.tags.join(", ")}${dup.count > dup.tags.length ? ", …" : ""}. Duplicate ids break label associations, anchors and getElementById.`,
				subject: dup.id,
				location: { selector: `#${dup.id}` },
			});
		}
	}
	return out;
}
