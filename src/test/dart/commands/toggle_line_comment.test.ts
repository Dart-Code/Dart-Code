import * as vs from "vscode";
import { activate, closeAllOpenFiles, ensureTestContent, rangeOf, select, setTestContent, waitForEditorChange } from "../../helpers";

describe("toggle dartdoc comment", () => {
	beforeEach("activate", () => activate());

	it("adds doubles to uncommented code", async () => {
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

		await waitForEditorChange(() => vs.commands.executeCommand("dart.toggleLineComment"));
		await ensureTestContent(`
// foo() {
//   print('foo');
// }

bar() {
  print('bar');
}
		`);
	});

	it("adds doubles to make triples", async () => {
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

		await waitForEditorChange(() => vs.commands.executeCommand("dart.toggleLineComment"));
		await ensureTestContent(`
/// foo() {
///   print('foo');
/// }

bar() {
  print('bar');
}
		`);
	});

	it("removes triples", async () => {
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

		await waitForEditorChange(() => vs.commands.executeCommand("dart.toggleLineComment"));
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

		await waitForEditorChange(() => vs.commands.executeCommand("dart.toggleLineComment"));
		await ensureTestContent(`
foo() {
  // print('foo');
}

bar() {
  // print('bar');
}
		`);
	});

	it("does nothing when there is no active editor", async () => {
		await closeAllOpenFiles();
		await vs.commands.executeCommand("dart.toggleLineComment");
	});

	it("handles blank lines, mixed comment prefixes, and multiple selections on the same line", async () => {
		await setTestContent(`
  // foo() {

  print('foo');
  // }
		`);
		select(
			rangeOf(`|// foo() {

  print('foo');
  // }|`),
			rangeOf(`|print|`),
		);

		await waitForEditorChange(() => vs.commands.executeCommand("dart.toggleLineComment"));
		await ensureTestContent(`
  // // foo() {

  // print('foo');
  // // }
		`);

		select(
			rangeOf(`|// // foo() {

  // print('foo');
  // // }|`),
			rangeOf(`|print|`),
		);
		await waitForEditorChange(() => vs.commands.executeCommand("dart.toggleLineComment"));
		await ensureTestContent(`
  /// // foo() {

  /// print('foo');
  /// // }
		`);

		select(
			rangeOf(`|/// // foo() {

  /// print('foo');
  /// // }|`),
			rangeOf(`|print|`),
		);
		await waitForEditorChange(() => vs.commands.executeCommand("dart.toggleLineComment"));
		await ensureTestContent(`
  // foo() {

  print('foo');
  // }
		`);
	});
});
