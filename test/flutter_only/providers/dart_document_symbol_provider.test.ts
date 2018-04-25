import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { activate, doc, positionOf, rangeOf, flutterHelloWorldMainFile, ensureSymbol, getDocumentSymbols } from "../../helpers";

describe("dart_document_symbol_provider", () => {

	before(async () => activate(flutterHelloWorldMainFile));

	it("returns expected items for 'flutter/hello_world'", async () => {
		const symbols = await getDocumentSymbols();

		ensureSymbol(symbols, "main()", vs.SymbolKind.Function, "");
		ensureSymbol(symbols, "MyApp", vs.SymbolKind.Class, "");
		ensureSymbol(symbols, "build(BuildContext context)", vs.SymbolKind.Method, "MyApp");
		ensureSymbol(symbols, "MyHomePage", vs.SymbolKind.Class, "");
		ensureSymbol(symbols, "MyHomePage(Key key)", vs.SymbolKind.Constructor, "MyHomePage");
		ensureSymbol(symbols, "build(BuildContext context)", vs.SymbolKind.Method, "MyHomePage");
		assert.equal(symbols.length, 6);
	});
});
