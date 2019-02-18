import * as vs from "vscode";
import { activate, ensureTestContentWithCursorPos, rangeOf, select, setTestContent, waitForEditorChange } from "../../helpers";

describe("complete statement", () => {
	beforeEach("activate", () => activate());

	it("completes a simple print", async () => {
		await setTestContent(`
main() {
  print("test
}
		`);
		select(rangeOf("test||"));

		await waitForEditorChange(() => vs.commands.executeCommand("dart.completeStatement"));
		await ensureTestContentWithCursorPos(`
main() {
  print("test");
  ^
}
		`);
	});

	it("completes an if statement", async () => {
		await setTestContent(`
main() {
  if (true
}
		`);
		select(rangeOf("true||"));

		await waitForEditorChange(() => vs.commands.executeCommand("dart.completeStatement"));
		await ensureTestContentWithCursorPos(`
main() {
  if (true) {
    ^
  }
}
		`);
	});

	it("inserts only a newline when there's nothing to complete", async () => {
		await setTestContent(`
main() {
  print("test");
}
		`);
		select(rangeOf(";||"));

		await waitForEditorChange(() => vs.commands.executeCommand("dart.completeStatement"));
		await ensureTestContentWithCursorPos(`
main() {
  print("test");
  ^
}
		`);
	});
});
