import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { activate, doc, getPositionOf, rangeOf, everythingFile, rangeAt } from "../../helpers";

describe("dart_document_symbol_provider", () => {

	before(async () => activate(everythingFile));

	async function getDocumentSymbols(): Promise<vs.SymbolInformation[]> {
		const documentSymbolResult = await (vs.commands.executeCommand("vscode.executeDocumentSymbolProvider", doc.uri) as Thenable<vs.SymbolInformation[]>);
		return documentSymbolResult || [];
	}

	function ensureSymbol(symbols: vs.SymbolInformation[], name: string, kind: vs.SymbolKind, containerName: string): void {
		const symbol = symbols.find((f) =>
			f.name === name
			&& f.kind === kind
			&& f.containerName === containerName,
		);
		assert.ok(
			symbol,
			`Couldn't find symbol for ${name}/${vs.SymbolKind[kind]}/${containerName} in\n`
			+ symbols.map((s) => `        ${s.name}/${vs.SymbolKind[s.kind]}/${s.containerName}`).join("\n"),
		);
		assert.deepStrictEqual(symbol.location.uri, doc.uri);
		assert.ok(symbol.location);
		// Ensure we have a range, but don't check specifically what it is (this will make the test fragile and the range mapping is trivial)
		assert.ok(symbol.location.range);
		assert.ok(symbol.location.range.start);
		assert.ok(symbol.location.range.start.line);
		assert.ok(symbol.location.range.end);
		assert.ok(symbol.location.range.end.line);
	}

	// TODO: Re-enable this, move it to amulti-root workspace so we can have
	// a few Flutter-specific and Dart-specific tests, but mostly tests in a shared
	// multi-root with them both (so we can access both sides)
	it("returns expected items for 'everything.dart'", async () => {
		const symbols = await getDocumentSymbols();

		assert.equal(symbols.length, 11);
		// TODO: Are these ranges on the end going to be fragile?
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
	});
});
