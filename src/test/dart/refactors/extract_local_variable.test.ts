import { strict as assert } from "assert";
import * as vs from "vscode";
import { activate, currentDoc, ensureTestContent, rangeOf, setTestContent } from "../../helpers";

describe("refactor", () => {

	beforeEach("activate", () => activate());

	it("can extract simple code into a local variable", async () => {
		await setTestContent(`
String name() {
  return "Danny";
}
		`);

		const actions = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf(`|"Danny"|`));
		assert.ok(actions);
		assert.ok(actions.length);

		const extractLocalAction = actions.find((r) => r.title.includes("Extract Local Variable"));
		assert.ok(extractLocalAction, "Action was not found");

		await (vs.commands.executeCommand(extractLocalAction.command!.command, ...extractLocalAction.command!.arguments || [])); // eslint-disable-line @typescript-eslint/no-unsafe-argument

		await ensureTestContent(`
String name() {
  var s = "Danny";
  return s;
}
		`);
	});
});
