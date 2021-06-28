import { strict as assert } from "assert";
import * as vs from "vscode";
import { activate, currentDoc, ensureTestContentWithSelection, extApi, flutterEmptyFile, getPackages, openFile, rangeOf, setTestContent } from "../../helpers";

describe("assist_code_action_provider", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());
	beforeEach("activate", () => activate());

	it("inserts correct indenting for create_method", async function () {
		// Doesn't work for non-LSP due to https://github.com/microsoft/vscode/issues/63129.
		if (!extApi.isLsp)
			this.skip();

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
		const actionResults = await (vs.commands.executeCommand("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("Co||ntainer(")) as Thenable<vs.CodeAction[]>);
		assert.ok(actionResults);
		assert.ok(actionResults.length);

		const wrapAction = actionResults.find((r) => r.title.indexOf("Wrap with widget") !== -1);
		assert.ok(wrapAction, "Action was not found");

		await vs.commands.executeCommand(wrapAction.command!.command, ...(wrapAction.command!.arguments ?? []));

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
});
