import { strict as assert } from "assert";
import * as vs from "vscode";
import { activate, currentDoc, ensureTestContent, ensureTestContentWithSelection, flutterEmptyFile, getCodeActions, getPackages, openFile, rangeOf, setTestContent } from "../../helpers";

describe("assist_code_action_provider", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());
	beforeEach("activate", () => activate());

	it("sets selection correctly for code actions with legacy snippet text edits", async () => {
		await openFile(flutterEmptyFile);
		await setTestContent(`
import 'package:flutter/widgets.dart';

class Danny extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      child: Text('Hello!'),
    );
  }
}`);
		const actionResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("Co||ntainer("));
		assert.ok(actionResults);
		assert.ok(actionResults.length);

		const action = actionResults.find((r) => r.title.includes("Wrap with widget"));
		assert.ok(action, "Action was not found");

		// Apply edit first if there is one (for the new SnippetTextEdits this will just be inline).
		if (action.edit) {
			// TODO(dantup): This doesn't work properly because executeCodeActionProvider returns broken edits that have
			//  lost their keepWhitespace. For now, we just have to skip the test in this mode (but it has been manually tested, it
			//  doesn't affect the real extension use).
			//
			// https://github.com/microsoft/vscode/issues/325990
			// await vs.workspace.applyEdit(action.edit);
			return;
		}

		// Execute the command if there is one (this could be the wrapped version for the legacy SnippetTextEdits).
		if (action.command) {
			await vs.commands.executeCommand(action.command.command, ...(action.command.arguments ?? [])); // eslint-disable-line @typescript-eslint/no-unsafe-argument
		}

		await ensureTestContentWithSelection(`
import 'package:flutter/widgets.dart';

class Danny extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return |widget|(
      child: Container(
        child: Text('Hello!'),
      ),
    );
  }
}`);
	});

	it("does not over-encode escaped dollars in actions", async function () {
		// https://github.com/Dart-Code/Dart-Code/issues/4002

		await openFile(flutterEmptyFile);
		await setTestContent(`
import 'package:flutter/material.dart';

Widget build() {
  return const Text('\\$123');
}
`);
		const actionResults = await getCodeActions({ title: "Wrap with Center", requireExactlyOne: true }, rangeOf("Te||xt("));
		assert.equal(actionResults.length, 1);
		const wrapAction = actionResults[0];

		// Older servers have simple edit, but newer has snippets.
		if (wrapAction.edit) {
			await vs.workspace.applyEdit(wrapAction.edit);
		} else if (wrapAction.command) {
			await vs.commands.executeCommand(
				wrapAction.command.command,
				...wrapAction.command.arguments || [], // eslint-disable-line @typescript-eslint/no-unsafe-argument
			);
		} else {
			// If there's no edit or command, skip the test. This happens very infrequently and appears to be a VS Code
			// race condition. Rather than failing our test runs, skip.
			// https://github.com/microsoft/vscode/issues/86403
			this.skip();
		}

		await ensureTestContent(`
import 'package:flutter/material.dart';

Widget build() {
  return Center(child: const Text('\\$123'));
}
`);
	});
});
