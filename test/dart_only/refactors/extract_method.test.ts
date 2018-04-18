import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as sinon from "sinon";
import * as vs from "vscode";
import { activate, doc, positionOf, setTestContent, editor, ensureTestContent, rangeOf, delay, defer } from "../../helpers";
import { REFACTOR_FAILED_DOC_MODIFIED, REFACTOR_ANYWAY } from "../../../src/commands/refactor";

describe("refactor", () => {

	before(() => activate());

	it("can extract simple code into a method", async () => {
		const showInputBox = sinon.stub(vs.window, "showInputBox");
		defer(showInputBox.restore);
		showInputBox.resolves("printHelloWorld");

		await setTestContent(`
main() {
  print("Hello, world!");
}
		`);
		await (vs.commands.executeCommand("_dart.performRefactor", doc, rangeOf("|print(\"Hello, world!\");|"), "EXTRACT_METHOD"));
		await ensureTestContent(`
main() {
  printHelloWorld();
}

void printHelloWorld() {
  print("Hello, world!");
}
		`);
	});

	it("displays an error if an invalid range is selected", async () => {
		const showErrorMessage = sinon.stub(vs.window, "showErrorMessage");
		defer(showErrorMessage.restore);

		await setTestContent(`
main() {
  print("Hello, world!");
}
		`);
		await (vs.commands.executeCommand("_dart.performRefactor", doc, new vs.Range(positionOf("^main("), positionOf("world^")), "EXTRACT_METHOD"));

		// Ensure the content was not modified.
		await ensureTestContent(`
main() {
  print("Hello, world!");
}
		`);
		assert(showErrorMessage.calledOnce);
	});

	it("displays an error if an invalid new name is provided", async () => {
		const showInputBox = sinon.stub(vs.window, "showInputBox");
		defer(showInputBox.restore);
		showInputBox.resolves("\"\"\"");
		const showErrorMessage = sinon.stub(vs.window, "showErrorMessage");
		defer(showErrorMessage.restore);

		await setTestContent(`
main() {
  print("Hello, world!");
}
		`);
		await (vs.commands.executeCommand("_dart.performRefactor", doc, rangeOf("|print(\"Hello, world!\");|"), "EXTRACT_METHOD"));

		// Ensure the content was not modified.
		await ensureTestContent(`
main() {
  print("Hello, world!");
}
		`);
		assert(() => showErrorMessage.calledOnce);
	});

	it("does not apply changes when there are warnings if the user does not approve", async () => {
		const showInputBox = sinon.stub(vs.window, "showInputBox");
		defer(showInputBox.restore);
		showInputBox.resolves("Aaaa");
		const showWarningMessage = sinon.stub(vs.window, "showWarningMessage");
		defer(showWarningMessage.restore);
		const refactorWarning = showWarningMessage.withArgs(sinon.match.any, REFACTOR_ANYWAY).resolves();
		showWarningMessage.callThrough();

		await setTestContent(`
main() {
  print("Hello, world!");
}
		`);
		await (vs.commands.executeCommand("_dart.performRefactor", doc, rangeOf("|print(\"Hello, world!\");|"), "EXTRACT_METHOD"));

		// Ensure the content was not modified.
		await ensureTestContent(`
main() {
  print("Hello, world!");
}
		`);
		assert(refactorWarning.calledOnce);
	});

	it("applies changes when there are warnings if the user approves", async () => {
		const showInputBox = sinon.stub(vs.window, "showInputBox");
		defer(showInputBox.restore);
		showInputBox.resolves("Aaaa");
		const showWarningMessage = sinon.stub(vs.window, "showWarningMessage");
		defer(showWarningMessage.restore);
		const refactorWarning = showWarningMessage.withArgs(sinon.match.any, REFACTOR_ANYWAY).resolves(REFACTOR_ANYWAY);
		showWarningMessage.callThrough();

		await setTestContent(`
main() {
  print("Hello, world!");
}
		`);
		await (vs.commands.executeCommand("_dart.performRefactor", doc, rangeOf("|print(\"Hello, world!\");|"), "EXTRACT_METHOD"));

		// Ensure the content was modified.
		await ensureTestContent(`
main() {
  Aaaa();
}

void Aaaa() {
  print("Hello, world!");
}
		`);

		assert(refactorWarning.calledOnce);
	});

	it("rejects the edit if the document has been modified", async () => {
		const showInputBox = sinon.stub(vs.window, "showInputBox");
		defer(showInputBox.restore);
		showInputBox.returns(delay(100).then(() => "printHelloWorld"));
		const showErrorMessage = sinon.stub(vs.window, "showErrorMessage");
		defer(showErrorMessage.restore);
		const rejectMessage = showErrorMessage.withArgs(REFACTOR_FAILED_DOC_MODIFIED).resolves();
		showErrorMessage.callThrough();

		await setTestContent(`
main() {
  print("Hello, world!");
}
		`);

		// Start the command but don't await it.
		const refactorCommand = (vs.commands.executeCommand("_dart.performRefactor", doc, rangeOf("|print(\"Hello, world!\");|"), "EXTRACT_METHOD"));

		// Give the command time to start.
		await delay(10);

		// Change the document in the meantime.
		await setTestContent(`
main() {
  print("Hello, world!");
}
// This comment was added
		`);

		// Wait for the command to complete.
		await refactorCommand;

		// Ensure nothing changed.
		await ensureTestContent(`
main() {
  print("Hello, world!");
}
// This comment was added
		`);
	});
});
