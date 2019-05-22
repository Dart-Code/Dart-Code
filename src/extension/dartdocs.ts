import { escapeRegExp } from "./debug/utils";

const iconUrlFormat = "https://raw.githubusercontent.com/Dart-Code/Icons/master/material/$1%402x.png";
const iconRegex = new RegExp(
	`(?:${escapeRegExp("<p>")})?`
	+ escapeRegExp('<i class="material-icons md-36">')
	+ "([\\w\\s_]+)"
	+ escapeRegExp('</i> &#x2014; material icon named "')
	+ "([\\w\\s_]+)"
	+ escapeRegExp('".')
	+ `(?:${escapeRegExp("</p>")})?`,
	"gi",
);
const dartDocDirectives = new RegExp(
	`(\\n\\s*{@.*?}$)|(^{@.*?}\\s*\\n)|(^{@.*?}$)`,
	"gim",
);
const dartDocCodeBlockSections = new RegExp(
	`(\`\`\`\\w+) +\\w+`,
	"gi",
);

export function cleanDartdoc(doc: string | undefined): string {
	if (!doc)
		return "";

	// Clean up some dart.core dartdoc.
	const index = doc.indexOf("## Other resources");
	if (index !== -1)
		doc = doc.substring(0, index);

	// Remove colons from old-style references like [:foo:].
	doc = doc.replace(/\[:\S+:\]/g, (match) => `[${match.substring(2, match.length - 2)}]`);

	doc = doc.replace(iconRegex, `![$1](${iconUrlFormat}|width=32,height=32)`);

	// Remove any directives like {@template xxx}
	doc = doc.replace(dartDocDirectives, "");

	// Remove any code block section names like ```dart preamble
	doc = doc.replace(dartDocCodeBlockSections, "$1");

	return doc;
}

/// Strips markdown to make nicer plain text.
export function stripMarkdown(doc: string): string {
	if (!doc)
		return "";

	// Remove links like [foo](bar).
	doc = doc.replace(/\[(.+?)\]\(.+?\)/g, "$1");

	// Remove references like [foo].
	doc = doc.replace(/\[(.+?)\]/g, "$1");

	return doc;
}
