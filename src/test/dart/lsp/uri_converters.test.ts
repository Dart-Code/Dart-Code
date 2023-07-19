import { strict as assert } from "assert";
import { Uri } from "vscode";
import { isWin } from "../../../shared/constants";
import { LspUriConverters } from "../../../shared/vscode/lsp_uri_converters";

describe("LspUriConverters", () => {
	it("uppercases drive letters", function () {
		if (!isWin)
			this.skip();

		const converter = new LspUriConverters(false);

		assert.equal(converter.code2Protocol(Uri.file("d:\\foo.txt")), "file:///D%3A/foo.txt");
	});

	it("does not modify non-file schemes", () => {
		const converter = new LspUriConverters(false);

		assert.equal(converter.code2Protocol(Uri.parse("vsls:/")), "vsls:/");
	});
});
