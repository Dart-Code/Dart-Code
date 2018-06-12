import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { activate, ensureSymbol, everythingFile, ext, getWorkspaceSymbols } from "../../helpers";

describe("workspace_symbol_provider", () => {

	beforeEach("activate", () => activate());

	it("includes nothing given no query", async () => {
		const symbols = await getWorkspaceSymbols("");

		assert.equal(symbols.length, 0);
	});

	it("includes items from 'everything.dart'", async function () {
		// Results in legacy version are kinda junk.
		if (!ext.exports.analyzerCapabilities.isDart2)
			this.skip();

		const symbols = await getWorkspaceSymbols("my");

		ensureSymbol(symbols, "MyClass", vs.SymbolKind.Class, `lib${path.sep}everything.dart`, everythingFile);
		ensureSymbol(symbols, "MyClass.myNumField", vs.SymbolKind.Field, `lib${path.sep}everything.dart`, everythingFile);
		ensureSymbol(symbols, "MyClass.myHttpClient", vs.SymbolKind.Field, `lib${path.sep}everything.dart`, everythingFile);
		ensureSymbol(symbols, "MyClass.myFutureString", vs.SymbolKind.Field, `lib${path.sep}everything.dart`, everythingFile);
		ensureSymbol(symbols, "MyClass.myNumGetter", vs.SymbolKind.Property, `lib${path.sep}everything.dart`, everythingFile);
		ensureSymbol(symbols, "MyClass.myNumSetter", vs.SymbolKind.Property, `lib${path.sep}everything.dart`, everythingFile);
		ensureSymbol(symbols, "MyClass.myNamed()", vs.SymbolKind.Constructor, `lib${path.sep}everything.dart`, everythingFile);
		ensureSymbol(symbols, "MyClass.myVoidReturningMethod()", vs.SymbolKind.Method, `lib${path.sep}everything.dart`, everythingFile);
		ensureSymbol(symbols, "MyClass.myStringReturningMethod()", vs.SymbolKind.Method, `lib${path.sep}everything.dart`, everythingFile);
		assert.equal(symbols.length, 9);
	});
});
