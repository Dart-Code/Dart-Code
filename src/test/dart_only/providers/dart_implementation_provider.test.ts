import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../../extension/utils";
import { activate, currentDoc, ensureLocation, ensureNoLocation, helloWorldFolder, positionOf, rangeOf } from "../../helpers";

const testFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/go_to_implementation.dart"));

describe("dart_implementation_provider", () => {
	beforeEach("activate everythingFile", () => activate(testFile));

	async function getImplementationsAt(searchText: string): Promise<vs.Location[]> {
		const position = positionOf(searchText);
		const definitionResults = await (vs.commands.executeCommand("vscode.executeImplementationProvider", currentDoc().uri, position) as Thenable<vs.Location[]>);

		return definitionResults || [];
	}

	it("does not return anything for blank areas of the document", async () => {
		const impls = await getImplementationsAt("\n^\n");
		assert.equal(impls.length, 0, "Unexpected results: " + JSON.stringify(impls, undefined, 4));
	});

	it("returns direct class implementations", async () => {
		const impls = await getImplementationsAt("abstract class ^A");
		ensureLocation(impls, testFile, rangeOf("class |B| extends A"));
		ensureLocation(impls, testFile, rangeOf("class |C| extends A"));
	});

	it("returns indirect class implementations", async () => {
		const impls = await getImplementationsAt("abstract class ^A");
		ensureLocation(impls, testFile, rangeOf("class |D| extends B"));
		ensureLocation(impls, testFile, rangeOf("class |E| extends B"));
		ensureLocation(impls, testFile, rangeOf("class |F| extends E"));
	});

	it("does not return self (class)", async () => {
		const impls = await getImplementationsAt("abstract class ^A");
		ensureNoLocation(impls, testFile, rangeOf("abstract class |A|"));
	});

	it("does not return super classes", async () => {
		const impls = await getImplementationsAt("class ^B extends A");
		ensureNoLocation(impls, testFile, rangeOf("abstract class |A|"));
	});

	it("returns implementations of concrete classes", async () => {
		const impls = await getImplementationsAt("class ^B extends A");
		ensureLocation(impls, testFile, rangeOf("class |E| extends B"));
	});

	it("returns even if selection is not on class name", async () => {
		const impls = await getImplementationsAt("^abstract class A");
		ensureLocation(impls, testFile, rangeOf("class |B| extends A"));
		ensureLocation(impls, testFile, rangeOf("class |C| extends A"));
	});

	it("returns direct method implementations", async () => {
		const impls = await getImplementationsAt("void ^b();");
		ensureLocation(impls, testFile, rangeOf("void |b|() /* B */ {"));
		ensureLocation(impls, testFile, rangeOf("void |b|() /* C */ {"));
	});

	it("returns indirect method implementations", async () => {
		const impls = await getImplementationsAt("void ^b();");
		ensureLocation(impls, testFile, rangeOf("void |b|() /* D */ {"));
		ensureLocation(impls, testFile, rangeOf("void |b|() /* F */ {"));
	});

	it("does not return self (method)", async () => {
		const impls = await getImplementationsAt("void ^b();");
		ensureNoLocation(impls, testFile, rangeOf("void |b|();"));
	});

	it("does not return super method", async () => {
		const impls = await getImplementationsAt("void ^b() /* B */ {");
		ensureNoLocation(impls, testFile, rangeOf("void |b|();"));
	});

	it("returns overrides of concrete method", async () => {
		const impls = await getImplementationsAt("void ^b() /* B */ {");
		ensureLocation(impls, testFile, rangeOf("void |b|() /* D */ {"));
	});

	it("returns even if selection is not on method name", async () => {
		const impls = await getImplementationsAt("^void b();");
		ensureLocation(impls, testFile, rangeOf("void |b|() /* B */ {"));
		ensureLocation(impls, testFile, rangeOf("void |b|() /* C */ {"));
	});

	it("returns implementations when invoked at call sites", async () => {
		const impls = await getImplementationsAt("e.^b();");
		ensureLocation(impls, testFile, rangeOf("void |b|() /* B */ {"));
		ensureLocation(impls, testFile, rangeOf("void |b|() /* C */ {"));
		ensureLocation(impls, testFile, rangeOf("void |b|() /* D */ {"));
		ensureLocation(impls, testFile, rangeOf("void |b|() /* F */ {"));
	});
});
