import { strict as assert } from "assert";
import * as sinon from "sinon";
import * as vs from "vscode";
import { activate, ensureTestContent, executeCodeAction, getCodeActions, positionOf, rangeOf, sb, setTestContent } from "../../helpers";

describe("extract method refactor", () => {

	beforeEach("activate", () => activate());

	it("can extract simple code into a method", async () => {
		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("myNewMethod");

		await setTestContent(`
main() {
  print("Hello, world!");
}
		`);

		await executeCodeAction({ title: "Extract Method" }, rangeOf("|print(\"Hello, world!\");|"));

		await ensureTestContent(`
main() {
  myNewMethod();
}

void myNewMethod() {
  print("Hello, world!");
}
		`);
	});

	it("is not available for an invalid range", async () => {
		await setTestContent(`
main() {
  print("Hello, world!");
}
		`);
		const codeActions = await getCodeActions({ title: "Extract Method", waitForMatch: false }, new vs.Range(positionOf("^main("), positionOf("world^")));
		assert.equal(codeActions.length, 0);
	});

	it("displays an error if an invalid new name is provided", async () => {
		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("\"\"\"");
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage");
		showErrorMessage.resolves(undefined);

		await setTestContent(`
main() {
  print("Hello, world!");
}
		`);
		await executeCodeAction({ title: "Extract Method" }, rangeOf("|print(\"Hello, world!\");|"));

		// Ensure the content was not modified.
		await ensureTestContent(`
main() {
  print("Hello, world!");
}
		`);
		const textMatch = sinon.match("Method name must not contain '\"'.")
			.or(sinon.match("Method name must not contain '\"'.\n\nYour refactor was not applied."));
		assert(showErrorMessage.calledWith(textMatch));
	});
});
