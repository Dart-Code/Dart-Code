import { strict as assert } from "assert";
import { Uri } from "vscode";
import { isWin } from "../../../shared/constants";
import { LspUriConverters } from "../../../shared/vscode/lsp_uri_converters";

describe("LspUriConverters", () => {
	it("uppercases drive letters in file URIs", function () {
		if (!isWin)
			this.skip();

		const converter = new LspUriConverters(false);

		assert.equal(converter.code2Protocol(Uri.parse("file:///d:/foo.txt")), "file:///D%3A/foo.txt");
		assert.equal(converter.code2Protocol(Uri.parse("file:///d%3a/foo.txt")), "file:///D%3A/foo.txt");
	});

	it("uppercases drive letters in non-file URIs", function () {
		if (!isWin)
			this.skip();

		const converter = new LspUriConverters(false);

		// VS Code removes the authority so we'll get fewer slashes
		assert.equal(converter.code2Protocol(Uri.parse("dart-macro:///d:/foo.txt")), "dart-macro:/D%3A/foo.txt");
		assert.equal(converter.code2Protocol(Uri.parse("dart-macro:///d%3a/foo.txt")), "dart-macro:/D%3A/foo.txt");

		// VS Code removes the authority so we'll get fewer slashes
		assert.equal(converter.code2Protocol(Uri.parse("dart-macro:/d:/foo.txt")), "dart-macro:/D%3A/foo.txt");
		assert.equal(converter.code2Protocol(Uri.parse("dart-macro:/d%3a/foo.txt")), "dart-macro:/D%3A/foo.txt");
	});

	it("does not modify URIs without drive letters", () => {
		const converter = new LspUriConverters(false);

		assert.equal(converter.code2Protocol(Uri.parse("vsls:/a/b/c")), "vsls:/a/b/c");
		assert.equal(converter.code2Protocol(Uri.parse("file:///foo/bar")), "file:///foo/bar");
	});
});
