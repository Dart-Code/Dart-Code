import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { activate, doc, getPositionOf, rangeOf, everythingFile, rangeAt, ensureSymbol, getWorkspaceSymbols } from "../../helpers";

describe("workspace_symbol_provider", () => {

	before(() => activate());

	it("includes nothing given no query", async () => {
		const symbols = await getWorkspaceSymbols("");

		assert.equal(symbols.length, 0);
	});

	it("includes items from 'everything.dart'", async () => {
		const symbols = await getWorkspaceSymbols("my");

		ensureSymbol(symbols, "MyClass", vs.SymbolKind.Class, "lib/everything.dart", everythingFile);
		ensureSymbol(symbols, "MyClass.myNumField", vs.SymbolKind.Field, "lib/everything.dart", everythingFile);
		ensureSymbol(symbols, "MyClass.myNumGetter", vs.SymbolKind.Property, "lib/everything.dart", everythingFile);
		ensureSymbol(symbols, "MyClass.myNumSetter", vs.SymbolKind.Property, "lib/everything.dart", everythingFile);
		ensureSymbol(symbols, "MyClass.myNamed()", vs.SymbolKind.Constructor, "lib/everything.dart", everythingFile);
		ensureSymbol(symbols, "MyClass.myVoidReturningMethod()", vs.SymbolKind.Method, "lib/everything.dart", everythingFile);
		ensureSymbol(symbols, "MyClass.myStringReturningMethod()", vs.SymbolKind.Method, "lib/everything.dart", everythingFile);
		assert.equal(symbols.length, 7);
	});
});
