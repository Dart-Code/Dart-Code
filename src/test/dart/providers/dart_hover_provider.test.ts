import { strict as assert } from "assert";
import * as vs from "vscode";
import { activate, currentDoc, everythingFile, getPackages, positionOf, privateApi, rangeOf } from "../../helpers";

describe("dart_hover_provider", () => {

	// We have tests that read tooltips from external packages so we need to ensure packages have been fetched.
	before("get packages", () => getPackages());
	beforeEach("activate everythingFile", () => activate(everythingFile));

	async function getHoversAt(searchText: string): Promise<Array<{ displayText: string, documentation?: string, range: vs.Range | undefined }>> {
		const position = positionOf(searchText);
		const hoverResult = await vs.commands.executeCommand<vs.Hover[]>("vscode.executeHoverProvider", currentDoc().uri, position);

		// Our hovers are aways in the form:
		// [{ language: "dart", value: data.displayString }, data.documentation || undefined],
		if (!hoverResult || hoverResult.length === 0)
			return [];

		return hoverResult.map((h) => {

			// TODO: Once VS Code updates (and we require that version), we may be able to simplify this.
			// For the existing VS Code impl we get an array here, but for LSP we return '---' as a separator since
			// we only get a single item. To treat them the same, join with `---` then split on `---`.
			const sections = h.contents.map((c) => ((c as any).value as string).trim())
				.join("\n---\n")
				.replace("\n```\n", "\n```\n---\n")
				.replace("\n---\n---\n", "\n---\n") // Hacks just to make both LSP and non-LSP end up formatted the same.
				.split("\n---\n");
			const displayText = sections[0];
			const docs = sections.slice(1).join("\n");
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

	function getExpectedSignature(method: string, returnType: string): string {
		return privateApi.dartCapabilities.omitsVoidForSetters && method.startsWith("set ") && returnType === "void"
			? method
			: `${returnType} ${method.startsWith("(") ? `Function${method}` : method}`;
	}

	function getExpectedDoc(packagePath: string, doc: string): string {
		return packagePath
			? `*${packagePath}*\n\n${doc}`
			: doc;
	}

	it("does not return hovers for blank areas of the document", async () => {
		const hovers = await getHoversAt("\n^\n");
		assert.equal(hovers.length, 0);
	});

	it("returns expected information for a class", async () => {
		const hover = await getHoverAt("class My^TestClass");
		assert.equal(hover.displayText, "class MyTestClass");
		assert.equal(hover.documentation, getExpectedDoc("package:hello_world/everything.dart", "This is my class."));
		assert.deepStrictEqual(hover.range, rangeOf("class |MyTestClass|"));
	});

	it("returns expected information for a field", async () => {
		const hover = await getHoverAt("num? my^TestNumField");
		assert.equal(hover.displayText, "num? myTestNumField");
		if (hover.documentation?.includes("Type:"))
			assert.equal(hover.documentation, `Type: \`num?\`\n\n` + getExpectedDoc("package:hello_world/everything.dart", "This is my num field."));
		else
			assert.equal(hover.documentation, getExpectedDoc("package:hello_world/everything.dart", "This is my num field."));
		assert.deepStrictEqual(hover.range, rangeOf("num? |myTestNumField|"));
	});

	it("returns expected information for a getter", async () => {
		const hover = await getHoverAt("get my^TestNumGetter");
		assert.equal(hover.displayText, getExpectedSignature("get myTestNumGetter", "num"));
		assert.equal(hover.documentation, getExpectedDoc("package:hello_world/everything.dart", "This is my num getter."));
		assert.deepStrictEqual(hover.range, rangeOf("get |myTestNumGetter|"));
	});

	it("returns expected information for a setter", async () => {
		const hover = await getHoverAt("my^TestNumSetter(");
		assert.equal(hover.displayText, getExpectedSignature("set myTestNumSetter(num value)", "void"));
		assert.equal(hover.documentation, getExpectedDoc("package:hello_world/everything.dart", "This is my num setter."));
		assert.deepStrictEqual(hover.range, rangeOf("|myTestNumSetter|"));
	});

	it("returns expected information for a constructor", async () => {
		const hover = await getHoverAt("My^TestClass()");
		assert.equal(hover.displayText, getExpectedSignature("MyTestClass()", "MyTestClass"));
		assert.equal(hover.documentation, getExpectedDoc("package:hello_world/everything.dart", "This is my class constructor."));
		assert.deepStrictEqual(hover.range, rangeOf("|MyTestClass|()"));
	});

	it("returns expected information for a named constructor", async () => {
		for (const hover of [await getHoverAt("My^TestClass.myTestNamed()"), await getHoverAt("MyTestClass.myTestN^amed()")]) {
			assert.equal(hover.displayText, getExpectedSignature("MyTestClass.myTestNamed()", "MyTestClass"));
			assert.equal(hover.documentation, getExpectedDoc("package:hello_world/everything.dart", "This is my class named constructor."));
			assert.deepStrictEqual(hover.range, rangeOf("|MyTestClass.myTestNamed|()"));
		}
	});

	it("returns expected information for a void returning method", async () => {
		const hover = await getHoverAt("my^TestVoidReturningMethod()");
		assert.equal(hover.displayText, getExpectedSignature("myTestVoidReturningMethod()", "void"));
		assert.equal(hover.documentation, getExpectedDoc("package:hello_world/everything.dart", "This is my void returning method."));
		assert.deepStrictEqual(hover.range, rangeOf("|myTestVoidReturningMethod|()"));
	});

	it("returns expected information for a string returning method", async () => {
		const hover = await getHoverAt("my^TestStringReturningMethod()");
		assert.equal(hover.displayText, getExpectedSignature("myTestStringReturningMethod()", "String"));
		assert.equal(hover.documentation, getExpectedDoc("package:hello_world/everything.dart", "This is my string returning method."));
		assert.deepStrictEqual(hover.range, rangeOf("|myTestStringReturningMethod|()"));
	});

	it("returns expected information for a method taking a string", async () => {
		const hover = await getHoverAt("me^thodTakingString(");
		assert.equal(hover.displayText, getExpectedSignature("methodTakingString(String a)", "void"));
		assert.equal(hover.documentation, getExpectedDoc("package:hello_world/everything.dart", "This is my method taking a string."));
		assert.deepStrictEqual(hover.range, rangeOf("|methodTakingString|"));
	});

	it("returns expected information for a method argument", async () => {
		const hover = await getHoverAt("methodTakingString(String ^a");
		assert.equal(hover.displayText, "String a");
		// Method args can't have their own docs so return the methods dartdoc.
		if (hover.documentation?.includes("Type:"))
			assert.equal(hover.documentation, `Type: \`String\`\n\nThis is my method taking a string.`);
		else
			assert.equal(hover.documentation, "This is my method taking a string.");
		assert.deepStrictEqual(hover.range, rangeOf("methodTakingString(String |a|)"));
	});

	it("returns expected information for a method taking a function", async () => {
		const hover = await getHoverAt("me^thodTakingFunction(");
		assert.equal(hover.displayText, getExpectedSignature(`methodTakingFunction(${getExpectedSignature("(String)", "void")} myFunc)`, "void"));
		assert.equal(hover.documentation, getExpectedDoc("package:hello_world/everything.dart", "This is my method taking a function."));
		assert.deepStrictEqual(hover.range, rangeOf("|methodTakingFunction|("));
	});

	it("returns expected information for a type from another package", async () => {
		const hover = await getHoverAt("http.Cli^ent");
		if (hover.displayText.includes("interface class"))
			assert.equal(hover.displayText, "abstract interface class Client");
		else
			assert.equal(hover.displayText, "abstract class Client");
		assert.ok(hover.documentation!.startsWith("*package:http/src/client.dart*"));
		assert.deepStrictEqual(hover.range, rangeOf("http.|Client|"));
	});

	it("returns expected information for a type from an SDK library", async () => {
		const hover = await getHoverAt("Fut^ure<String>");
		if (hover.displayText.includes("interface class"))
			assert.equal(hover.displayText, "abstract interface class Future<T>");
		else
			assert.equal(hover.displayText, "abstract class Future<T>");
		assert.ok(hover.documentation!.startsWith("*dart:async*"));
		assert.deepStrictEqual(hover.range, rangeOf("|Future|<String>"));
	});

	it("displays the correct thing for a deprecated method", async () => {
		const hover = await getHoverAt("doSome^Stuff()");
		assert.equal(hover.displayText, `(deprecated) ${getExpectedSignature("doSomeStuff()", "void")}`);
	});
});
