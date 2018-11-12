import * as _ from "lodash";

const darkIconUrlFormat = "https://storage.googleapis.com/material-icons/external-assets/v4/icons/svg/ic_$1_white_36px.svg";
const lightIconUrlFormat = "https://storage.googleapis.com/material-icons/external-assets/v4/icons/svg/ic_$1_black_36px.svg";
const iconRegex = new RegExp(
	`(?:${_.escapeRegExp("<p>")})?`
	+ _.escapeRegExp('<i class="material-icons md-36">')
	+ "([\\w\\s_]+)"
	+ _.escapeRegExp('</i> &#x2014; material icon named "')
	+ "([\\w\\s_]+)"
	+ _.escapeRegExp('".')
	+ `(?:${_.escapeRegExp("</p>")})?`,
	"gi",
);
const dartDocDirectives = new RegExp(
	`(\\n\\s*{@.*?}$)|(^{@.*?}\\s*\\n)`,
	"gim",
);
const dartDocCodeBlockSections = new RegExp(
	`(\`\`\`\\w+) +\\w+`,
	"gi",
);

export function cleanDartdoc(doc: string): string {
	if (!doc)
		return "";

	// Clean up some dart.core dartdoc.
	const index = doc.indexOf("## Other resources");
	if (index !== -1)
		doc = doc.substring(0, index);

	// Remove colons from old-style references like [:foo:].
	doc = doc.replace(/\[:\S+:\]/g, (match) => `[${match.substring(2, match.length - 2)}]`);

	// TODO: Use light/dark theme as appropriate.
	doc = doc.replace(iconRegex, `![$1](${darkIconUrlFormat}|width=100,height=100)`);

	// Remove any directives like {@template xxx}
	doc = doc.replace(dartDocDirectives, "");

	// Remove any code block section names like ```dart preamble
	doc = doc.replace(dartDocCodeBlockSections, "$1");

	return doc;
}
