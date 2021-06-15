import * as vs from "vscode";
import { activate, ensureTestContent, rangeOf, select, setTestContent, waitForEditorChange } from "../../helpers";

describe("toggle dartdoc comment", () => {
	beforeEach("activate", () => activate());

	it("adds to uncommented code", async () => {
		await setTestContent(`
foo() {
  print('foo');
}

bar() {
  print('bar');
}
		`);
		select(rangeOf(`|foo() {
  print('foo');
}|`));

		await waitForEditorChange(() => vs.commands.executeCommand("dart.toggleDartdocComment"));
		await ensureTestContent(`
/// foo() {
///   print('foo');
/// }

bar() {
  print('bar');
}
		`);
	});

	it("adds only one slash to double-slash commented code", async () => {
		await setTestContent(`
// foo() {
//   print('foo');
// }

bar() {
  print('bar');
}
		`);
		select(rangeOf(`|// foo() {
//   print('foo');
// }|`));

		await waitForEditorChange(() => vs.commands.executeCommand("dart.toggleDartdocComment"));
		await ensureTestContent(`
/// foo() {
///   print('foo');
/// }

bar() {
  print('bar');
}
		`);
	});

	it("removes slashes from triple-slash commented code", async () => {
		await setTestContent(`
/// foo() {
///   print('foo');
/// }

bar() {
  print('bar');
}
		`);
		select(rangeOf(`|/// foo() {
///   print('foo');
/// }|`));

		await waitForEditorChange(() => vs.commands.executeCommand("dart.toggleDartdocComment"));
		await ensureTestContent(`
foo() {
  print('foo');
}

bar() {
  print('bar');
}
		`);
	});

	it("supports multiple selections", async () => {
		await setTestContent(`
foo() {
  print('foo');
}

bar() {
  print('bar');
}
		`);
		select(
			rangeOf(`|print('foo`),
			rangeOf(`|print('bar`),
		);

		await waitForEditorChange(() => vs.commands.executeCommand("dart.toggleDartdocComment"));
		await ensureTestContent(`
foo() {
  /// print('foo');
}

bar() {
  /// print('bar');
}
		`);
	});
});
