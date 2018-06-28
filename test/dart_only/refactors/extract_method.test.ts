import * as assert from "assert";
import * as sinon from "sinon";
import * as vs from "vscode";
import { REFACTOR_ANYWAY, REFACTOR_FAILED_DOC_MODIFIED } from "../../../src/commands/refactor";
import { PromiseCompleter } from "../../../src/debug/utils";
import { activate, currentDoc, ensureTestContent, positionOf, rangeOf, sb, setTestContent, waitFor } from "../../helpers";

describe("refactor", () => {

	beforeEach("activate", () => activate());

	it("can extract simple code into a method", async () => {
		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("printHelloWorld");

		await setTestContent(`
main() {
  print("Hello, world!");
}
		`);
		await (vs.commands.executeCommand("_dart.performRefactor", currentDoc(), rangeOf("|print(\"Hello, world!\");|"), "EXTRACT_METHOD"));
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
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage");

		await setTestContent(`
main() {
  print("Hello, world!");
}
		`);
		await (vs.commands.executeCommand("_dart.performRefactor", currentDoc(), new vs.Range(positionOf("^main("), positionOf("world^")), "EXTRACT_METHOD"));

		// Ensure the content was not modified.
		await ensureTestContent(`
main() {
  print("Hello, world!");
}
		`);
		assert(showErrorMessage.calledOnce);
	});

	it("displays an error if an invalid new name is provided", async () => {
		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("\"\"\"");
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage");

		await setTestContent(`
main() {
  print("Hello, world!");
}
		`);
		await (vs.commands.executeCommand("_dart.performRefactor", currentDoc(), rangeOf("|print(\"Hello, world!\");|"), "EXTRACT_METHOD"));

		// Ensure the content was not modified.
		await ensureTestContent(`
main() {
  print("Hello, world!");
}
		`);
		assert(showErrorMessage.calledOnce);
	});

	it("does not apply changes when there are warnings if the user does not approve", async () => {
		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("Aaaa");
		const showWarningMessage = sb.stub(vs.window, "showWarningMessage");
		const refactorPrompt = showWarningMessage.withArgs(sinon.match.any, REFACTOR_ANYWAY).resolves();
		showWarningMessage.callThrough();

		await setTestContent(`
main() {
  print("Hello, world!");
}
		`);
		await (vs.commands.executeCommand("_dart.performRefactor", currentDoc(), rangeOf("|print(\"Hello, world!\");|"), "EXTRACT_METHOD"));

		// Ensure the content was not modified.
		await ensureTestContent(`
main() {
  print("Hello, world!");
}
		`);
		assert(refactorPrompt.calledOnce);
	});

	it("applies changes when there are warnings if the user approves", async () => {
		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("Aaaa");
		const showWarningMessage = sb.stub(vs.window, "showWarningMessage");
		const refactorPrompt = showWarningMessage.withArgs(sinon.match.any, REFACTOR_ANYWAY).resolves(REFACTOR_ANYWAY);
		showWarningMessage.callThrough();

		await setTestContent(`
main() {
  print("Hello, world!");
}
		`);
		await (vs.commands.executeCommand("_dart.performRefactor", currentDoc(), rangeOf("|print(\"Hello, world!\");|"), "EXTRACT_METHOD"));

		// Ensure the content was modified.
		await ensureTestContent(`
main() {
  Aaaa();
}

void Aaaa() {
  print("Hello, world!");
}
		`);

		assert(refactorPrompt.calledOnce);
	});

	it("rejects the edit if the document has been modified before the user approves", async () => {
		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("Aaaaa");
		const showWarningMessage = sb.stub(vs.window, "showWarningMessage");
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage");
		// Accept after some time (so the doc can be edited by the test).
		const refactorAnywayChoice = new PromiseCompleter();
		const refactorPrompt = showWarningMessage.withArgs(sinon.match.any, REFACTOR_ANYWAY).returns(refactorAnywayChoice.promise);
		const rejectMessage = showErrorMessage.withArgs(REFACTOR_FAILED_DOC_MODIFIED).resolves();

		await setTestContent(`
main() {
  print("Hello, world!");
}
		`);

		// Start the command but don't await it.
		const refactorCommand = (vs.commands.executeCommand("_dart.performRefactor", currentDoc(), rangeOf("|print(\"Hello, world!\");|"), "EXTRACT_METHOD"));

		// Wait for the message to appear.
		await waitFor(() => refactorPrompt.called);

		// Change the document in the meantime.
		await setTestContent(`
main() {
  print("Hello, world!");
}
// This comment was added
		`);

		refactorAnywayChoice.resolve(REFACTOR_ANYWAY);

		// Wait for the command to complete.
		await refactorCommand;

		// Ensure nothing changed.
		await ensureTestContent(`
main() {
  print("Hello, world!");
}
// This comment was added
		`);

		assert(rejectMessage.calledOnce, "Reject message was not shown");
	});
});
