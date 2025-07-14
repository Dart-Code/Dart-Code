import { strict as assert } from "assert";
import { commands, workspace } from "vscode";
import { activate, activateWithoutAnalysis, extApi, helloWorldMainFile, waitForResult } from "../helpers";

describe("extension api", () => {
	it("provides the DTD Uri and notifies of changes", async () => {
		await activateWithoutAnalysis();
		await waitForResult(() => !!extApi.dtdUri);

		let didChange = false;
		const sub = extApi.onDtdUriChanged(() => didChange = true);
		await commands.executeCommand("_dart.reloadExtension", "testing");
		await waitForResult(() => didChange);
		sub.dispose();
	});

	it("provides the Dart SDK and notifies of changes", async () => {
		await activateWithoutAnalysis();
		assert.ok(extApi.sdks.dart);

		let didChange = false;
		const sub = extApi.onSdksChanged(() => didChange = true);
		await commands.executeCommand("_dart.reloadExtension", "testing");
		await waitForResult(() => didChange);
		sub.dispose();
	});

	it("provides outlines for Dart files", async () => {
		await activate();

		const doc = await workspace.openTextDocument(helloWorldMainFile);
		const outline = (await extApi.workspace.getOutline(doc))!;

		assert.equal(outline.element.name, "<unit>");
		assert.equal(outline.element.kind, "COMPILATION_UNIT");
		assert.ok(outline.range);
		assert.ok(outline.codeRange);

		const main = outline.children![0];
		assert.equal(main.element.name, "main");
		assert.equal(main.element.kind, "FUNCTION");
		assert.ok(main.range);
		assert.ok(main.codeRange);
	});
});
