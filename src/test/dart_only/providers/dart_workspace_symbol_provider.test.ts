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
		const symbols = await getWorkspaceSymbols("my");

		// TODO: Remove this when we figure out what's up 🤷‍♂️
		const symbols2 = await getWorkspaceSymbols("my");
		const symbols3 = await getWorkspaceSymbols("my");
		if (symbols.length !== symbols2.length || symbols2.length !== symbols3.length) {
			throw new Error(`workspace symbols gave different results! ${symbols.length} vs ${symbols2.length} vs ${symbols3.length}`);
		}

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

	it("includes items from pub packages", async () => {
		const symbols = await getWorkspaceSymbols("IOClient");

		ensureWorkspaceSymbol(symbols, "IOClient", vs.SymbolKind.Class, "package:http/src/io_client.dart", { endsWith: `${path.sep}src${path.sep}io_client.dart` });
	});

	it("includes items from git dependencies", async () => {
		const symbols = await getWorkspaceSymbols("ProtobufEnum");

		ensureWorkspaceSymbol(symbols, "ProtobufEnum", vs.SymbolKind.Class, "package:protobuf/src/protobuf/protobuf_enum.dart", { endsWith: `${path.sep}src${path.sep}protobuf${path.sep}protobuf_enum.dart` });
	});
});
