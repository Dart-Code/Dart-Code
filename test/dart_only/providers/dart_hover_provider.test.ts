import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { activate, doc, getPositionOf, rangeOf, everythingFile } from "../../helpers";

describe("dart_hover_provider", () => {

	before(() => activate(everythingFile));

	async function getHoversAt(searchText: string): Promise<Array<{ displayText: string, documentation?: string, range: vs.Range }>> {
		const position = getPositionOf(searchText);
		const hoverResult = await (vs.commands.executeCommand("vscode.executeHoverProvider", doc.uri, position) as Thenable<vs.Hover[]>);

		// Our hovers are aways in the form:
		// [{ language: "dart", value: data.displayString }, data.documentation || undefined],
		if (hoverResult == null || hoverResult.length === 0)
			return [];

		return hoverResult.map((h) => {
			const displayText = ((h.contents[0] as any).value as string).trim();
			const docs = ((h.contents[1] as any).value as string).trim();
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
	async function getHoverAt(searchText: string): Promise<{ displayText: string, documentation?: string, range: vs.Range }> {
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
		// TODO: We don't want this
		// https://github.com/Dart-Code/Dart-Code/issues/555
		assert.equal(hover.displayText, "MyClass num myNumField");
		assert.equal(hover.documentation, "This is my num field.");
		assert.deepStrictEqual(hover.range, rangeOf("num |myNumField|"));
	});

	it("returns expected information for a getter", async () => {
		const hover = await getHoverAt("get my^NumGetter");
		// TODO: We don't want this
		// https://github.com/Dart-Code/Dart-Code/issues/555
		assert.equal(hover.displayText, "MyClass get myNumGetter → num");
		assert.equal(hover.documentation, "This is my num getter.");
		assert.deepStrictEqual(hover.range, rangeOf("get |myNumGetter|"));
	});

	it("returns expected information for a setter", async () => {
		const hover = await getHoverAt("my^NumSetter(");
		// TODO: We don't want this
		// https://github.com/Dart-Code/Dart-Code/issues/555
		assert.equal(hover.displayText, "MyClass set myNumSetter(num value) → void");
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
		// TODO: Currently server seeems to return two different ranges for
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
		assert.equal(hover.displayText, "MyClass.myVoidReturningMethod() → void");
		assert.equal(hover.documentation, "This is my void returning method.");
		assert.deepStrictEqual(hover.range, rangeOf("|myVoidReturningMethod|()"));
	});

	it("returns expected information for a string returning method", async () => {
		const hover = await getHoverAt("my^StringReturningMethod()");
		assert.equal(hover.displayText, "MyClass.myStringReturningMethod() → String");
		assert.equal(hover.documentation, "This is my string returning method.");
		assert.deepStrictEqual(hover.range, rangeOf("|myStringReturningMethod|()"));
	});

	it("returns expected information for a method taking a string", async () => {
		const hover = await getHoverAt("me^thodTakingString(");
		assert.equal(hover.displayText, "MyClass.methodTakingString(String a) → void");
		assert.equal(hover.documentation, "This is my method taking a string.");
		assert.deepStrictEqual(hover.range, rangeOf("|methodTakingString|"));
	});

	it("returns expected information for a method argument", async () => {
		const hover = await getHoverAt("methodTakingString(String ^a");
		assert.equal(hover.displayText, "String a");
		// TODO: This feels like a bug?
		// https://github.com/dart-lang/sdk/issues/32390
		assert.equal(hover.documentation, "This is my method taking a string.");
		assert.deepStrictEqual(hover.range, rangeOf("methodTakingString(String |a|)"));
	});

	it("returns expected information for a method taking a function", async () => {
		const hover = await getHoverAt("me^thodTakingFunction(");
		assert.equal(hover.displayText, "MyClass.methodTakingFunction((String) → int myFunc) → void");
		assert.equal(hover.documentation, "This is my method taking a function.");
		assert.deepStrictEqual(hover.range, rangeOf("|methodTakingFunction|("));
	});
});
