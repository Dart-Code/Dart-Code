import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { activate, doc, getPositionOf, setTestContent, editor, ensureTestContent, delay, waitFor } from "../../helpers";

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

		const oldVersion = doc.version;
		await vs.commands.executeCommand("dart.sortMembers");

		// Wait a while since text editor commands are fire-and-forget
		await waitFor(() => doc.version !== oldVersion, 500);

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
