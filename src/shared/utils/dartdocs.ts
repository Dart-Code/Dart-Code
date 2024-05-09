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
			variant = fixVariant(variant);
			icon = `${icon}_${variant}`;
		}
		icon = fixIcon(icon);
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

function fixVariant(variant: string): string {
	// Class names don't always match the filenames.
	return variant === "round" ? "rounded" : variant;
}

const identifierPrefixRewritePattern = new RegExp(`^(?:3d|\\d+)`);

const identifierPrefixRewrites: { [key: string]: string | undefined } = {
	// See identifierPrefixRewrites in
	// https://github.com/flutter/flutter/blob/master/dev/tools/update_icons.dart
	"1": "one_",
	"10": "ten_",
	"11": "eleven_",
	"12": "twelve_",
	"123": "onetwothree",
	"13": "thirteen_",
	"14": "fourteen_",
	"15": "fifteen_",
	"16": "sixteen_",
	"17": "seventeen_",
	"18": "eighteen_",
	"19": "nineteen_",
	"2": "two_",
	"20": "twenty_",
	"21": "twenty_one_",
	"22": "twenty_two_",
	"23": "twenty_three_",
	"24": "twenty_four_",
	"2d": "twod",
	"3": "three_",
	"30": "thirty_",
	"360": "threesixty",
	"3d": "threed",
	"4": "four_",
	"5": "five_",
	"6": "six_",
	"60": "sixty_",
	"7": "seven_",
	"8": "eight_",
	"9": "nine_",
};
const identifierExactRewrites: { [key: string]: string | undefined } = {
	// See identifierExactRewrites in
	// https://github.com/flutter/flutter/blob/master/dev/tools/update_icons.dart
	class: "class_",
	// eslint-disable-next-line camelcase
	door_back: "door_back_door",
	// eslint-disable-next-line camelcase
	door_front: "door_front_door",
	new: "new_",
	switch: "switch_",
	try: "try_sms_star",
};

function fixIcon(icon: string): string {
	// Things starting with numbers are textual in their names too.
	const prefixMatch = identifierPrefixRewritePattern.exec(icon);
	if (prefixMatch) {
		const prefix = prefixMatch[0];
		const newPrefix = identifierPrefixRewrites[prefix];
		if (newPrefix)
			return `${newPrefix}${icon.slice(prefix.length)}`;
	}

	// Also try exact rewrites.
	const newIdentifier = identifierExactRewrites[icon];
	if (newIdentifier)
		return newIdentifier;

	return icon;
}

