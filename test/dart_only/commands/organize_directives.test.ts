import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { activate, doc, getPositionOf, setTestContent, editor, ensureTestContent, delay } from "../../helpers";

describe("organize directives", () => {

	before(() => activate());

	it("sorts imports", async () => {
		await vs.window.activeTextEditor.edit(async (edit) => {
			await setTestContent(`
import "dart:collection";
import "dart:async";

main() async {
  await new Future.delayed(const Duration(seconds: 1));
  HashSet hash = new HashSet();
}
			`);
			await vs.commands.executeCommand("dart.organizeDirectives", vs.window.activeTextEditor, edit);
		});

		await ensureTestContent(`
import "dart:async";
import "dart:collection";

main() async {
  await new Future.delayed(const Duration(seconds: 1));
  HashSet hash = new HashSet();
}
		`);
	});

	it("removes unused imports", async () => {
		await vs.window.activeTextEditor.edit(async (edit) => {
			await setTestContent(`
import "dart:collection";
import "dart:async";

main() async {
  await new Future.delayed(const Duration(seconds: 1));
}
			`);
			await vs.commands.executeCommand("dart.organizeDirectives", vs.window.activeTextEditor, edit);
		});

		ensureTestContent(`
import "dart:async";

main() async {
  await new Future.delayed(const Duration(seconds: 1));
}
		`);
	});
});
