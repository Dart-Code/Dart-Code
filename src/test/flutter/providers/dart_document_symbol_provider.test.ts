import { strict as assert } from "assert";
import * as vs from "vscode";
import { waitFor } from "../../../shared/utils/promises";
import { activate, ensureDocumentSymbol, flutterHelloWorldMainFile, getDocumentSymbols, getPackages } from "../../helpers";

describe.only("dart_document_symbol_provider", () => {

	// We have tests that require external packages.
	before("get packages", () => getPackages());
	beforeEach("activate flutterHelloWorldMainFile", () => activate(flutterHelloWorldMainFile));

	it("returns expected items for 'flutter/hello_world'", async () => {
		const symbols = await waitFor(() => getDocumentSymbols());

		assert.ok(symbols && symbols.length, "Didn't get any symbols");

		ensureDocumentSymbol(symbols, "main", vs.SymbolKind.Function);
		ensureDocumentSymbol(symbols, "MyApp", vs.SymbolKind.Class);
		ensureDocumentSymbol(symbols, "build", vs.SymbolKind.Method, "MyApp");
		ensureDocumentSymbol(symbols, "MyHomePage", vs.SymbolKind.Class);
		ensureDocumentSymbol(symbols, "MyHomePage", vs.SymbolKind.Constructor, "MyHomePage");
		ensureDocumentSymbol(symbols, "build", vs.SymbolKind.Method, "MyHomePage");
		assert.equal(symbols.length, 7);
	});
});
