import { escapeRegExp } from "../utils";

const materialIconRegex = new RegExp(
	escapeRegExp('<i class="material-icons')
	+ "(?:-([\\w]+))?"
	+ escapeRegExp(' md-36">')
	+ "([\\w\\s_]+)"
	+ escapeRegExp("</i> &#x2014;")
	+ "\\s+",
	"gi",
);
const cupertinoIconRegex = new RegExp(
	escapeRegExp(`<i class='cupertino-icons md-36'>`)
	+ "([\\w\\s_]+)"
	+ escapeRegExp("</i> &#x2014;")
	+ "\\s+",
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

export function cleanDartdoc(doc: string | undefined, iconPathFormat: string): string {
	if (!doc)
		return "";

	// Clean up some dart.core dartdoc.
	const index = doc.indexOf("## Other resources");
	if (index !== -1)
		doc = doc.substring(0, index);

	// Remove colons from old-style references like [:foo:].
	doc = doc.replace(/\[:\S+:\]/g, (match) => `[${match.substring(2, match.length - 2)}]`);

	// Replace material icon HTML blocks with markdown to load the images from the correct place.
	doc = doc.replace(materialIconRegex, (_fullMatch: string, variant: string, icon: string) => {
		if (variant) {
			// HACK: Classnames don't match the filenames.
			if (variant === "round")
				variant = "rounded";
			icon = `${icon}_${variant}`;
		}
		const iconPath = iconPathFormat.replace("$1", `material/${icon}`);
		return `![${icon}](${iconPath}|width=32,height=32)\n\n`;
	});

	// Replace cupertino icon HTML blocks with markdown to load the images from the correct place.
	doc = doc.replace(cupertinoIconRegex, (_fullMatch: string, icon: string) => {
		const iconPath = iconPathFormat.replace("$1", `cupertino/${icon}`);
		return `![${icon}](${iconPath}|width=32,height=32)\n\n`;
	});

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
