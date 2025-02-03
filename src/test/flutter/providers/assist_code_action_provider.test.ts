import { strict as assert } from "assert";
import * as vs from "vscode";
import { activate, currentDoc, ensureTestContent, ensureTestContentWithSelection, extApi, flutterEmptyFile, getPackages, openFile, rangeOf, setTestContent } from "../../helpers";

describe("assist_code_action_provider", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());
	beforeEach("activate", () => activate());

	it("sets selection correctly for code actions with snippets", async function () {
		if (!extApi.dartCapabilities.supportsSnippetTextEdits)
			this.skip();

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

		const wrapAction = actionResults.find((r) => r.title.includes("Wrap with widget"));
		assert.ok(wrapAction, "Action was not found");

		await vs.commands.executeCommand(wrapAction.command!.command, ...(wrapAction.command!.arguments ?? [])); // eslint-disable-line @typescript-eslint/no-unsafe-argument

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
		const actionResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("Te||xt("));
		assert.ok(actionResults);
		assert.ok(actionResults.length);

		const wrapAction = actionResults.find((r) => r.title.includes("Wrap with Center"));
		assert.ok(wrapAction, "Action was not found");

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
			return;
		}

		await ensureTestContent(`
import 'package:flutter/material.dart';

Widget build() {
  return Center(child: const Text('\\$123'));
}
`);
	});
});
