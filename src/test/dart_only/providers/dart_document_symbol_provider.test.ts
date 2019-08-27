import * as assert from "assert";
import * as vs from "vscode";
import { activate, ensureDocumentSymbol, everythingFile, getDocumentSymbols } from "../../helpers";

describe("document_symbol_provider", () => {

	beforeEach("activate everythingFile", () => activate(everythingFile));

	it("returns expected items for 'everything.dart'", async () => {
		const symbols = await getDocumentSymbols();

		ensureDocumentSymbol(symbols, "MyTestClass", vs.SymbolKind.Class);
		ensureDocumentSymbol(symbols, "myTestNumField", vs.SymbolKind.Field, "MyTestClass");
		ensureDocumentSymbol(symbols, "myTestNumGetter", vs.SymbolKind.Property, "MyTestClass");
		ensureDocumentSymbol(symbols, "myTestNumSetter", vs.SymbolKind.Property, "MyTestClass");
		ensureDocumentSymbol(symbols, "myTestFutureString", vs.SymbolKind.Field, "MyTestClass");
		ensureDocumentSymbol(symbols, "myTestHttpClient", vs.SymbolKind.Field, "MyTestClass");
		ensureDocumentSymbol(symbols, "MyTestClass", vs.SymbolKind.Constructor, "MyTestClass");
		ensureDocumentSymbol(symbols, "MyTestClass.myTestNamed", vs.SymbolKind.Constructor, "MyTestClass");
		ensureDocumentSymbol(symbols, "myTestVoidReturningMethod", vs.SymbolKind.Method, "MyTestClass");
		ensureDocumentSymbol(symbols, "myTestStringReturningMethod", vs.SymbolKind.Method, "MyTestClass");
		ensureDocumentSymbol(symbols, "methodTakingString", vs.SymbolKind.Method, "MyTestClass");
		ensureDocumentSymbol(symbols, "methodTakingFunction", vs.SymbolKind.Method, "MyTestClass");
		ensureDocumentSymbol(symbols, "methodWithArgsAndReturnValue", vs.SymbolKind.Method, "MyTestClass");
		ensureDocumentSymbol(symbols, "doSomeStuff", vs.SymbolKind.Function);
		ensureDocumentSymbol(symbols, "foo", vs.SymbolKind.Variable);
		ensureDocumentSymbol(symbols, "Theme", vs.SymbolKind.Enum);
		ensureDocumentSymbol(symbols, "Light", vs.SymbolKind.EnumMember, "Theme");
		ensureDocumentSymbol(symbols, "Dark", vs.SymbolKind.EnumMember, "Theme");
		assert.equal(symbols.length, 18);
	});
});
