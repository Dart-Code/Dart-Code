import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { activate, doc, getPositionOf, setTestContent, editor, ensureTestContent, delay } from "../../helpers";

describe("sort members", () => {

	before(() => activate());

	it("sorts members", async () => {
		await vs.window.activeTextEditor.edit(async (edit) => {
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
			await vs.commands.executeCommand("dart.sortMembers", vs.window.activeTextEditor, edit);
		});

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
