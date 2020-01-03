import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { activate, ensureWorkspaceSymbol, everythingFile, getWorkspaceSymbols } from "../../helpers";

describe("workspace_symbol_provider", () => {

	beforeEach("activate", () => activate());

	it("includes nothing given no query", async () => {
		const symbols = await getWorkspaceSymbols("");

		assert.equal(symbols.length, 0);
	});

	it("includes items from 'everything.dart'", async () => {
		const symbols = await getWorkspaceSymbols("mytest");

		ensureWorkspaceSymbol(symbols, "MyTestClass", vs.SymbolKind.Class, undefined, everythingFile);
		ensureWorkspaceSymbol(symbols, "myTestNumField", vs.SymbolKind.Field, "MyTestClass", everythingFile);
		ensureWorkspaceSymbol(symbols, "myTestHttpClient", vs.SymbolKind.Field, "MyTestClass", everythingFile);
		ensureWorkspaceSymbol(symbols, "myTestFutureString", vs.SymbolKind.Field, "MyTestClass", everythingFile);
		ensureWorkspaceSymbol(symbols, "myTestNumGetter", vs.SymbolKind.Property, "MyTestClass", everythingFile);
		ensureWorkspaceSymbol(symbols, "myTestNumSetter(…)", vs.SymbolKind.Property, "MyTestClass", everythingFile);
		ensureWorkspaceSymbol(symbols, "myTestNamed()", vs.SymbolKind.Constructor, "MyTestClass", everythingFile);
		ensureWorkspaceSymbol(symbols, "myTestVoidReturningMethod()", vs.SymbolKind.Method, "MyTestClass", everythingFile);
		ensureWorkspaceSymbol(symbols, "myTestStringReturningMethod()", vs.SymbolKind.Method, "MyTestClass", everythingFile);
	});

	it("includes items from pub packages", async () => {
		const symbols = await getWorkspaceSymbols("IOClient");
		ensureWorkspaceSymbol(symbols, "IOClient", vs.SymbolKind.Class, undefined, { endsWith: `${path.sep}src${path.sep}io_client.dart` });
	});

	it("includes items from git dependencies", async () => {
		const symbols = await getWorkspaceSymbols("ProtobufEnum");

		ensureWorkspaceSymbol(symbols, "ProtobufEnum", vs.SymbolKind.Class, undefined, { endsWith: `${path.sep}src${path.sep}protobuf${path.sep}protobuf_enum.dart` });
	});
});
