import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { activate, ensureWorkspaceSymbol, everythingFile, extApi, getWorkspaceSymbols } from "../../helpers";

describe("workspace_symbol_provider", () => {

	beforeEach("activate", () => activate());

	it("includes nothing given no query", async () => {
		const symbols = await getWorkspaceSymbols("");

		assert.equal(symbols.length, 0);
	});

	it("includes items from 'everything.dart'", async function () {
		// Results in legacy version are kinda junk.
		if (!extApi.analyzerCapabilities.isDart2)
			this.skip();

		const symbols = await getWorkspaceSymbols("my");

		ensureWorkspaceSymbol(symbols, "MyClass", vs.SymbolKind.Class, `lib${path.sep}everything.dart`, everythingFile);
		ensureWorkspaceSymbol(symbols, "MyClass.myNumField", vs.SymbolKind.Field, `lib${path.sep}everything.dart`, everythingFile);
		ensureWorkspaceSymbol(symbols, "MyClass.myHttpClient", vs.SymbolKind.Field, `lib${path.sep}everything.dart`, everythingFile);
		ensureWorkspaceSymbol(symbols, "MyClass.myFutureString", vs.SymbolKind.Field, `lib${path.sep}everything.dart`, everythingFile);
		ensureWorkspaceSymbol(symbols, "MyClass.myNumGetter", vs.SymbolKind.Property, `lib${path.sep}everything.dart`, everythingFile);
		ensureWorkspaceSymbol(symbols, "MyClass.myNumSetter", vs.SymbolKind.Property, `lib${path.sep}everything.dart`, everythingFile);
		ensureWorkspaceSymbol(symbols, "MyClass.myNamed()", vs.SymbolKind.Constructor, `lib${path.sep}everything.dart`, everythingFile);
		ensureWorkspaceSymbol(symbols, "MyClass.myVoidReturningMethod()", vs.SymbolKind.Method, `lib${path.sep}everything.dart`, everythingFile);
		ensureWorkspaceSymbol(symbols, "MyClass.myStringReturningMethod()", vs.SymbolKind.Method, `lib${path.sep}everything.dart`, everythingFile);
	});

	it("includes items from pub packages", async function () {
		// Results in legacy version are kinda junk.
		if (!extApi.analyzerCapabilities.isDart2)
			this.skip();

		const symbols = await getWorkspaceSymbols("IOClient");

		ensureWorkspaceSymbol(symbols, "IOClient", vs.SymbolKind.Class, "package:http/src/io_client.dart", { endsWith: "/src/io_client.dart" });
	});

	it.skip("includes items from git dependencies", async function () {
		// Results in legacy version are kinda junk.
		if (!extApi.analyzerCapabilities.isDart2)
			this.skip();

		const symbols = await getWorkspaceSymbols("ProtobufEnum");

		ensureWorkspaceSymbol(symbols, "ProtobufEnum", vs.SymbolKind.Class, "package:protobuf/protobuf.dart", { endsWith: "/protobuf.dart" });
	});
});
