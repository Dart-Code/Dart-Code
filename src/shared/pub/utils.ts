export function cleanPubOutput(pubOutput: string) {
	// Sometimes pub will output additional text that we need to discard:
	// Precompiling executable...\nPrecompiled test:test.\n[{"name":"console-full","label"
	const precompilingHeaderPattern = RegExp("^Precompil(?:ing|ed).*$", "gm");
	const json = pubOutput.replace(precompilingHeaderPattern, "");
	return json;
}
