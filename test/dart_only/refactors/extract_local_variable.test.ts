import * as vs from "vscode";
import { activate, currentDoc, ensureTestContent, rangeOf, sb, setTestContent } from "../../helpers";

describe("refactor", () => {

	beforeEach("activate", () => activate());

	it("can extract simple code into a method", async () => {
		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("myName");

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
  var myName = "Danny";
    return myName;
}
		`);
	});
});
