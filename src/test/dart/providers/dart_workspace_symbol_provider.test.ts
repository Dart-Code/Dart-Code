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
		ensureWorkspaceSymbol(symbols, "MyTestClass.myTestNumField", vs.SymbolKind.Field, undefined, everythingFile);
		ensureWorkspaceSymbol(symbols, "MyTestClass.myTestHttpClient", vs.SymbolKind.Field, undefined, everythingFile);
		ensureWorkspaceSymbol(symbols, "MyTestClass.myTestFutureString", vs.SymbolKind.Field, undefined, everythingFile);
		ensureWorkspaceSymbol(symbols, "MyTestClass.myTestNumGetter", vs.SymbolKind.Property, undefined, everythingFile);
		ensureWorkspaceSymbol(symbols, "MyTestClass.myTestNumSetter", vs.SymbolKind.Property, undefined, everythingFile);
		ensureWorkspaceSymbol(symbols, "MyTestClass.myTestNamed()", vs.SymbolKind.Constructor, undefined, everythingFile);
		ensureWorkspaceSymbol(symbols, "MyTestClass.myTestVoidReturningMethod()", vs.SymbolKind.Method, undefined, everythingFile);
		ensureWorkspaceSymbol(symbols, "MyTestClass.myTestStringReturningMethod()", vs.SymbolKind.Method, undefined, everythingFile);
	});

	it("includes items from pub packages", async () => {
		const symbols = await getWorkspaceSymbols("IOClient");

		ensureWorkspaceSymbol(symbols, "IOClient", vs.SymbolKind.Class, "package:http/src/io_client.dart", { endsWith: `${path.sep}src${path.sep}io_client.dart` });
	});

	it("includes items from git dependencies", async () => {
		const symbols = await getWorkspaceSymbols("ProtobufEnum");

		ensureWorkspaceSymbol(symbols, "ProtobufEnum", vs.SymbolKind.Class, "package:protobuf/src/protobuf/protobuf_enum.dart", { endsWith: `${path.sep}src${path.sep}protobuf${path.sep}protobuf_enum.dart` });
	});
});
