import * as assert from "assert";
import * as vs from "vscode";
import { activate, ensureSymbol, everythingFile, getDocumentSymbols } from "../../helpers";

describe("document_symbol_provider", () => {

	beforeEach("activate everythingFile", () => activate(everythingFile));

	it("returns expected items for 'everything.dart'", async () => {
		const symbols = await getDocumentSymbols();

		ensureSymbol(symbols, "MyClass", vs.SymbolKind.Class, "");
		ensureSymbol(symbols, "myNumField", vs.SymbolKind.Field, "MyClass");
		ensureSymbol(symbols, "myNumGetter", vs.SymbolKind.Property, "MyClass");
		ensureSymbol(symbols, "myNumSetter", vs.SymbolKind.Property, "MyClass");
		ensureSymbol(symbols, "myFutureString", vs.SymbolKind.Field, "MyClass");
		ensureSymbol(symbols, "myHttpClient", vs.SymbolKind.Field, "MyClass");
		ensureSymbol(symbols, "MyClass()", vs.SymbolKind.Constructor, "MyClass");
		ensureSymbol(symbols, "MyClass.myNamed()", vs.SymbolKind.Constructor, "MyClass");
		ensureSymbol(symbols, "myVoidReturningMethod()", vs.SymbolKind.Method, "MyClass");
		ensureSymbol(symbols, "myStringReturningMethod()", vs.SymbolKind.Method, "MyClass");
		ensureSymbol(symbols, "methodTakingString(String a)", vs.SymbolKind.Method, "MyClass");
		ensureSymbol(symbols, "methodTakingFunction(void Function(String) myFunc)", vs.SymbolKind.Method, "MyClass");
		ensureSymbol(symbols, "doSomeStuff()", vs.SymbolKind.Function, "");
		assert.equal(symbols.length, 13);
	});
});
