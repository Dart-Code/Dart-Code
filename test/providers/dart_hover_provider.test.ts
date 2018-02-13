import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";

const ext = vs.extensions.getExtension("Dart-Code.dart-code");
const helloWorldFolder = vs.Uri.file(path.join(ext.extensionPath, "test/data/hello_world"));
const helloWorldFile = vs.Uri.file(path.join(helloWorldFolder.fsPath, "bin/main.dart"));

// describe("dart_hover_provider", () => {
// 	let doc: vs.TextDocument;
// 	let editor: vs.TextEditor;

// 	before(async () => {
// 		await ext.activate();
// 		await vs.commands.executeCommand("vscode.openFolder", helloWorldFolder);
// 		console.log("OPENING " + helloWorldFile.fsPath);
// 		console.log("EXISTS? " + fs.existsSync(helloWorldFile.fsPath));
// 		doc = await vs.workspace.openTextDocument(helloWorldFile);
// 		console.log("OPENED");
// 		editor = await vs.window.showTextDocument(doc);
// 		console.log("SHOWED");
// 	});

// 	function getHoversAt(searchText: string): Thenable<vs.Hover[]> {
// 		const index = doc.getText().indexOf(searchText);
// 		assert.notEqual(index, -1, `Couldn't find string ${searchText} in the document to send hovers`);
// 		const position = doc.positionAt(index);
// 		console.warn("EXECUTING vscode.executeHoverProvider");
// 		return vs.commands.executeCommand("vscode.executeHoverProvider", doc.uri, position) as Thenable<vs.Hover[]>;
// 	}

// 	it("does not return hovers for blank areas of the document", async () => {
// 		const hovers = await getHoversAt("\n");
// 		assert.equal(hovers.length, 0);
// 	});

// 	it("does returns a hover for a function call", async () => {
// 		const hovers = await getHoversAt("print");
// 		assert.equal(hovers.length, 1);
// 	});
// });
