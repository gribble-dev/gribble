import { describe, expect, it } from "vitest";
import { checkMarkupStructure } from "../src/checks/html-structure.js";

const kinds = (source: string) => checkMarkupStructure(source).map((p) => `${p.kind}:${p.tag}@${p.line}`);

describe("checkMarkupStructure", () => {
	it("is quiet on a document that relies on implied end tags", () => {
		const source = [
			"<!DOCTYPE html>",
			"<html lang=en><head><meta charset=utf-8><title>Fine</title>",
			"<body>",
			"<p>one<p>two",
			"<ul><li>a<li>b</ul>",
			"<dl><dt>t<dd>d<dt>t2<dd>d2</dl>",
			"<table><thead><tr><th>h<tbody><tr><td>c<td>d<tr><td>e</table>",
			"<select><option>1<option>2</select>",
			"<div><p>closed by the div</div>",
			"<img src=x alt=''><br><input type=text><hr>",
			"<svg viewBox='0 0 1 1'><path d='M0 0'/><circle r=1 /></svg>",
			"<script>const s = '<div></div>' + '</p>';</script>",
			"<style>a::after { content: '</b>'; }</style>",
			"<textarea></div></textarea>",
			"<!-- a comment with a </div> in it -->",
			"<p>a &lt; b > c</p>",
			"<a href='?x=1&amp;y=\"2\"' data-x='<b>'>quoted &gt; inside attributes</a>",
			"</body></html>",
		].join("\n");
		expect(kinds(source)).toEqual([]);
	});

	it("reports stray and mismatched end tags, elements left open and duplicate attributes", () => {
		const source = [
			"<div>",
			"<span class=a class=b>x</div>",
			"</em>",
			"<section><b>bold",
			"</section>",
			"<main>",
		].join("\n");
		expect(kinds(source)).toEqual([
			"duplicate-attribute:span@2",
			"unclosed:span@2",
			"stray-end-tag:em@3",
			"unclosed:b@4",
			"unclosed:main@6",
		]);
		const [dup] = checkMarkupStructure(source);
		expect(dup?.message).toBe(
			'Attribute "class" appears more than once on <span> (line 2); the browser keeps the first value.',
		);
	});

	it("reports illegal nesting: links in links, non-li list children and blocks inside paragraphs", () => {
		const source = [
			"<a href=/>outer <a href=/x>inner</a></a>",
			"<ul><div>x</div><li>ok</li></ul>",
			"<p>text<div>block</div></p>",
		].join("\n");
		expect(kinds(source)).toEqual([
			"nested-a:a@1",
			"stray-end-tag:a@1",
			"list-child:div@2",
			"block-in-p:p@3",
		]);
		expect(checkMarkupStructure(source).at(-1)?.message).toBe(
			"</p> (line 3) closes the paragraph from line 3, but the browser already ended it when <div> started on line 3; a paragraph cannot contain <div>.",
		);
		// Leaving </p> out before a block is what the spec allows; nothing to report.
		expect(kinds("<p>text<div>block</div>\n<p>next<ul><li>x</ul>")).toEqual([]);
	});

	it("treats self-closing syntax on a non-void element as an open element", () => {
		expect(kinds("<div/>\n<p>x</p>")).toEqual(["self-closing:div@1", "unclosed:div@1"]);
		expect(kinds("<svg><rect/></svg><math><mi/></math>")).toEqual([]);
	});

	it("ignores optional html, head and body end tags and does not report past the limits", () => {
		expect(kinds("</body></html>")).toEqual([]);
		expect(kinds("<p>x</body>")).toEqual([]);
		const many = Array.from({ length: 30 }, () => "</em>").join("\n");
		expect(checkMarkupStructure(many, { maxProblems: 5 })).toHaveLength(5);
		// A truncated document says nothing about what was never read.
		const long = `<div>${"x".repeat(100)}`;
		expect(checkMarkupStructure(long, { maxChars: 50 })).toEqual([]);
		expect(checkMarkupStructure(long)).toHaveLength(1);
	});
});
