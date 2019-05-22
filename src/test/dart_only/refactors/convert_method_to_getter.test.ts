import * as vs from "vscode";
import { activate, currentDoc, ensureTestContent, rangeOf, setTestContent } from "../../helpers";

describe("refactor", () => {

	beforeEach("activate", () => activate());

	it("can convert a method to a getter", async () => {
		await setTestContent(`
String name() {
  return "Danny";
}
		`);
		await (vs.commands.executeCommand("_dart.performRefactor", currentDoc(), rangeOf("|name(|"), "CONVERT_METHOD_TO_GETTER"));
		await ensureTestContent(`
String get name {
  return "Danny";
}
		`);
	});
});
