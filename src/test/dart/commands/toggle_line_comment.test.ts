import * as vs from "vscode";
import { activate, ensureTestContent, rangeOf, select, setTestContent, waitForEditorChange } from "../../helpers";

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
});
