import * as assert from "assert";
import * as vs from "vscode";

const isWin = /^win/.test(process.platform);
const ext = vs.extensions.getExtension("Dart-Code.dart-code");
const sampleFilePath = (isWin ? "X:\\" : "/tmp/") + "sample.dart";
const sampleFileUri = vs.Uri.parse(`untitled:${sampleFilePath}`);

describe("dart_hover_provider", () => {
	before(async () => {
		await ext.activate();
		await vs.workspace.openTextDocument(sampleFileUri);
		await vs.window.activeTextEditor.edit((b) => b.insert(new vs.Position(0, 0), "\r\nprint('Hello, world');\r\n"));
	});

	function getHovers(searchText: string): Thenable<vs.Hover[]> {
		const index = vs.window.activeTextEditor.document.getText().indexOf(searchText);
		assert.notEqual(index, -1, `Couldn't find string ${searchText} in the document to send hovers`);
		const position = vs.window.activeTextEditor.document.positionAt(index);
		return vs.commands.executeCommand("vscode.executeHoverProvider", sampleFileUri, position) as Thenable<vs.Hover[]>;
	}

	it("does not return hovers for blank areas of the document", async () => {
		const hovers = await getHovers("\n");
		assert.equal(hovers.length, 0);
	});

	// TODO: Figure out why this isn't working...
	// it("does returns a hover for a function call", async () => {
	// 	const hovers = await getHovers("print");
	// 	assert.equal(hovers.length, 1);
	// });
});
