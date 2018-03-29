export function cleanDartdoc(doc: string): string {
	if (!doc)
		return null;

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

	return doc;
}
