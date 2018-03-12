import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { activate, doc, getPositionOf, rangeOf, everythingFile, rangeAt, ensureSymbol, getDocumentSymbols } from "../../helpers";

describe("document_symbol_provider", () => {

	before(async () => activate(everythingFile));

	it("returns expected items for 'everything.dart'", async () => {
		const symbols = await getDocumentSymbols();

		ensureSymbol(symbols, "MyClass", vs.SymbolKind.Class, "");
		ensureSymbol(symbols, "myNumField", vs.SymbolKind.Field, "MyClass");
		ensureSymbol(symbols, "myNumGetter", vs.SymbolKind.Property, "MyClass");
		ensureSymbol(symbols, "myNumSetter", vs.SymbolKind.Property, "MyClass");
		ensureSymbol(symbols, "MyClass()", vs.SymbolKind.Constructor, "MyClass");
		ensureSymbol(symbols, "MyClass.named()", vs.SymbolKind.Constructor, "MyClass");
		ensureSymbol(symbols, "myVoidReturningMethod()", vs.SymbolKind.Method, "MyClass");
		ensureSymbol(symbols, "myStringReturningMethod()", vs.SymbolKind.Method, "MyClass");
		ensureSymbol(symbols, "methodTakingString(String a)", vs.SymbolKind.Method, "MyClass");
		ensureSymbol(symbols, "methodTakingFunction(int Function(String) myFunc)", vs.SymbolKind.Method, "MyClass");
		ensureSymbol(symbols, "doSomeStuff()", vs.SymbolKind.Function, "");
		assert.equal(symbols.length, 11);
	});
});
