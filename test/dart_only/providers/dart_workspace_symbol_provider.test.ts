import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { activate, ensureSymbol, everythingFile, ext, getWorkspaceSymbols } from "../../helpers";

describe("workspace_symbol_provider", () => {

	before(() => activate());

	it("includes nothing given no query", async () => {
		const symbols = await getWorkspaceSymbols("");

		assert.equal(symbols.length, 0);
	});

	it("includes items from 'everything.dart'", async () => {
		const symbols = await getWorkspaceSymbols("my");

		ensureSymbol(symbols, "MyClass", vs.SymbolKind.Class, `lib${path.sep}everything.dart`, everythingFile);

		// Results in legacy version are kinda junk (these are apparently missing!) so only check in v2.
		if (ext.exports.analyzerCapabilities.isDart2) {
			ensureSymbol(symbols, "MyClass.myNumField", vs.SymbolKind.Field, `lib${path.sep}everything.dart`, everythingFile);
			ensureSymbol(symbols, "MyClass.myNumGetter", vs.SymbolKind.Property, `lib${path.sep}everything.dart`, everythingFile);
			ensureSymbol(symbols, "MyClass.myNumSetter", vs.SymbolKind.Property, `lib${path.sep}everything.dart`, everythingFile);
			ensureSymbol(symbols, "MyClass.myNamed()", vs.SymbolKind.Constructor, `lib${path.sep}everything.dart`, everythingFile);
			ensureSymbol(symbols, "MyClass.myVoidReturningMethod()", vs.SymbolKind.Method, `lib${path.sep}everything.dart`, everythingFile);
			ensureSymbol(symbols, "MyClass.myStringReturningMethod()", vs.SymbolKind.Method, `lib${path.sep}everything.dart`, everythingFile);
			assert.equal(symbols.length, 7);
		}
	});
});
