import { escapeRegExp } from "./utils";

const darkIconUrlFormat = "https://storage.googleapis.com/material-icons/external-assets/v4/icons/svg/ic_$1_white_36px.svg";
const lightIconUrlFormat = "https://storage.googleapis.com/material-icons/external-assets/v4/icons/svg/ic_$1_black_36px.svg";
const iconRegex = new RegExp(
	escapeRegExp('<p><i class="material-icons md-36">')
	+ "([\\w\\s_]+)"
	+ escapeRegExp('</i> &#x2014; material icon named "')
	+ "([\\w\\s_]+)"
	+ escapeRegExp('".</p>'),
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

	// Change any links without hyperlinks to just code syntax.
	// That is, anything in [squares] that isn't a [link](http://blah).
	// Note: To ensure we get things at the end, we need to match "not a paren or end of string"
	// and we need to put that character back in since the regex consumed it.
	doc = doc.replace(/\[(\S+)\]([^(]|$)/g, (match, one, two) => `\`${one}\`${two}`);

	// TODO: Use light/dark theme as appropriate.
	doc = doc.replace(iconRegex, `![$1](${darkIconUrlFormat}|width=100,height=100)`);

	return doc;
}
