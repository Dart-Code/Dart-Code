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
		await (vs.commands.executeCommand("_dart.performRefactor", currentDoc(), rangeOf(`|"Danny"|`), "EXTRACT_LOCAL_VARIABLE"));
		// Incorrect indenting is due to https://github.com/Microsoft/vscode/issues/63129
		// When that's fixed, this test will fail and we can fix it up.
		await ensureTestContent(`
String name() {
  var s = "Danny";
    return s;
}
		`);
	});
});
