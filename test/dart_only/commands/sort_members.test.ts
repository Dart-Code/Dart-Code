import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { activate, doc, setTestContent, editor, ensureTestContent, delay, waitFor, waitForEditorChange } from "../../helpers";

describe("sort members", () => {

	before(() => activate());

	it("sorts members", async () => {
		await setTestContent(`
int b;
int a;
class Person {
  int b;
  int a;
  bb() {}
  aa() {}
}
dd() {}
cc() {}
		`);

		await waitForEditorChange(() => vs.commands.executeCommand("dart.sortMembers"));

		// b&a inside the class seem sorted the wrong way?
		// https://github.com/dart-lang/sdk/issues/32683
		await ensureTestContent(`
int a;
int b;
cc() {}
dd() {}
class Person {
  int b;
  int a;
  aa() {}
  bb() {}
}
		`);
	});
});
