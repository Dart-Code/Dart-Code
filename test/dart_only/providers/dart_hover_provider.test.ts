import * as assert from "assert";
import * as vs from "vscode";
import { activate, currentDoc, everythingFile, extApi, getPackages, positionOf, rangeOf } from "../../helpers";

describe("dart_hover_provider", () => {

	// We have tests that read tooltips from external packages so we need to ensure packages have been fetched.
	before("get packages", () => getPackages());
	beforeEach("activate everythingFile", () => activate(everythingFile));

	async function getHoversAt(searchText: string): Promise<Array<{ displayText: string, documentation?: string, range: vs.Range | undefined }>> {
		const position = positionOf(searchText);
		const hoverResult = await (vs.commands.executeCommand("vscode.executeHoverProvider", currentDoc().uri, position) as Thenable<vs.Hover[]>);

		// Our hovers are aways in the form:
		// [{ language: "dart", value: data.displayString }, data.documentation || undefined],
		if (!hoverResult || hoverResult.length === 0)
			return [];

		return hoverResult.map((h) => {

			// TODO: Once VS Code updates (and we require that version), we may be able to simplify this.
			// For the existing VS Code impl we get an array here, but for LSP we return '---' as a separator since
			// we only get a single item. To treat them the same, join with `---` then split on `---`.
			const sections = h.contents.map((c) => ((c as any).value as string).trim()).join("\n---\n").split("\n---\n");
			const displayText = sections[0];
			const docs = sections[1];
			assert.equal(displayText.substr(0, 7), "```dart");
			assert.equal(displayText.substr(-3), "```");
			return {
				displayText: displayText.substring(7, displayText.length - 3).trim(),
				documentation: docs,
				range: h.range,
			};
		});
	}

	// Helper to get just a single hover when exactly one is expected.
	async function getHoverAt(searchText: string): Promise<{ displayText: string, documentation?: string, range: vs.Range | undefined }> {
		const hovers = await getHoversAt(searchText);
		assert.equal(hovers.length, 1);
		return hovers[0];
	}

	it("does not return hovers for blank areas of the document", async () => {
		const hovers = await getHoversAt("\n^\n");
		assert.equal(hovers.length, 0);
	});

	it("returns expected information for a class", async () => {
		const hover = await getHoverAt("class My^Class");
		assert.equal(hover.displayText, "class MyClass");
		assert.equal(hover.documentation, "This is my class.");
		assert.deepStrictEqual(hover.range, rangeOf("class |MyClass|"));
	});

	it("returns expected information for a field", async () => {
		const hover = await getHoverAt("num my^NumField");
		assert.equal(hover.displayText, "num myNumField");
		assert.equal(hover.documentation, "This is my num field.");
		assert.deepStrictEqual(hover.range, rangeOf("num |myNumField|"));
	});

	it("returns expected information for a getter", async () => {
		const hover = await getHoverAt("get my^NumGetter");
		assert.equal(hover.displayText, "get myNumGetter → num");
		assert.equal(hover.documentation, "This is my num getter.");
		assert.deepStrictEqual(hover.range, rangeOf("get |myNumGetter|"));
	});

	it("returns expected information for a setter", async function () {
		// https://github.com/dart-lang/sdk/issues/32703
		if (extApi.analyzerCapabilities.isDart2) {
			this.skip();
			return;
		}

		const hover = await getHoverAt("my^NumSetter(");
		assert.equal(hover.displayText, "set myNumSetter(num value) → void");
		assert.equal(hover.documentation, "This is my num setter.");
		assert.deepStrictEqual(hover.range, rangeOf("|myNumSetter|"));
	});

	it("returns expected information for a constructor", async () => {
		const hover = await getHoverAt("My^Class()");
		assert.equal(hover.displayText, "MyClass() → MyClass");
		assert.equal(hover.documentation, "This is my class constructor.");
		assert.deepStrictEqual(hover.range, rangeOf("|MyClass|()"));
	});

	it("returns expected information for a named constructor", async () => {
		// Note: Server seeems to return two different ranges for
		// MyClass and named.
		let hover = await getHoverAt("My^Class.myNamed()");
		assert.equal(hover.displayText, "MyClass.myNamed() → MyClass");
		assert.equal(hover.documentation, "This is my class named constructor.");
		assert.deepStrictEqual(hover.range, rangeOf("|MyClass|.myNamed()"));
		// Check second part... ideally this would be rolled into above.
		hover = await getHoverAt("MyClass.myN^amed()");
		assert.equal(hover.displayText, "MyClass.myNamed() → MyClass");
		assert.equal(hover.documentation, "This is my class named constructor.");
		assert.deepStrictEqual(hover.range, rangeOf("MyClass.|myNamed|()"));
	});

	it("returns expected information for a void returning method", async () => {
		const hover = await getHoverAt("my^VoidReturningMethod()");
		assert.equal(hover.displayText, "myVoidReturningMethod() → void");
		assert.equal(hover.documentation, "This is my void returning method.");
		assert.deepStrictEqual(hover.range, rangeOf("|myVoidReturningMethod|()"));
	});

	it("returns expected information for a string returning method", async () => {
		const hover = await getHoverAt("my^StringReturningMethod()");
		assert.equal(hover.displayText, "myStringReturningMethod() → String");
		assert.equal(hover.documentation, "This is my string returning method.");
		assert.deepStrictEqual(hover.range, rangeOf("|myStringReturningMethod|()"));
	});

	it("returns expected information for a method taking a string", async () => {
		const hover = await getHoverAt("me^thodTakingString(");
		assert.equal(hover.displayText, "methodTakingString(String a) → void");
		assert.equal(hover.documentation, "This is my method taking a string.");
		assert.deepStrictEqual(hover.range, rangeOf("|methodTakingString|"));
	});

	it("returns expected information for a method argument", async () => {
		const hover = await getHoverAt("methodTakingString(String ^a");
		assert.equal(hover.displayText, "String a");
		// Method args can't have their own docs so return the methods dartdoc.
		assert.equal(hover.documentation, "This is my method taking a string.");
		assert.deepStrictEqual(hover.range, rangeOf("methodTakingString(String |a|)"));
	});

	it("returns expected information for a method taking a function", async () => {
		const hover = await getHoverAt("me^thodTakingFunction(");
		assert.equal(hover.displayText, "methodTakingFunction((String) → void myFunc) → void");
		assert.equal(hover.documentation, "This is my method taking a function.");
		assert.deepStrictEqual(hover.range, rangeOf("|methodTakingFunction|("));
	});

	it("returns expected information for a type from another package", async () => {
		const hover = await getHoverAt("http.Cli^ent");
		assert.equal(hover.displayText, "abstract class Client");
		assert.ok(hover.documentation!.indexOf("*package:http*") === 0);
		assert.deepStrictEqual(hover.range, rangeOf("http.|Client|"));
	});

	it("returns expected information for a type from an SDK library", async () => {
		const hover = await getHoverAt("Fut^ure<String>");
		assert.equal(hover.displayText, "abstract class Future<T>");
		assert.ok(hover.documentation!.indexOf("*dart.async*") === 0);
		assert.deepStrictEqual(hover.range, rangeOf("|Future|<String>"));
	});

	it("displays the correct thing for a deprecated method", async () => {
		const hover = await getHoverAt("doSome^Stuff()");
		assert.equal(hover.displayText, "(deprecated) doSomeStuff() → void");
	});
});
