import { strict as assert } from "assert";
import * as sinon from "sinon";
import * as vs from "vscode";
import { activate, ensureTestContent, executeCodeAction, getCodeActions, rangeOf, sb, setTestContent } from "../../helpers";

describe("extract widget refactor", () => {
	beforeEach("activate", () => activate());

	it("can extract simple code into a widget", async () => {
		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("MyNewWidget");

		await setTestContent(`
import 'package:flutter/widgets.dart';

class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new Container();
  }
}
		`);
		await executeCodeAction({ title: "Extract Widget" }, rangeOf("||Container()"));

		await ensureTestContent(`
import 'package:flutter/widgets.dart';

class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new MyNewWidget();
  }
}

class MyNewWidget extends StatelessWidget {
  const MyNewWidget({
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return new Container();
  }
}
		`, true);
	});

	it("is not available for an invalid range", async () => {
		await setTestContent(`
import 'package:flutter/widgets.dart';

class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new Container();
  }
}
		`);

		const codeActions = await getCodeActions({ title: "Extract Widget", waitForMatch: false }, rangeOf("|MyWidget|"));
		assert.equal(codeActions.length, 0);
	});

	it("displays an error if an invalid new name is provided", async () => {
		const showInputBox = sb.stub(vs.window, "showInputBox");
		// Return the invalid name on the first prompt, then cancel (undefined) if Interactive Forms
		// (Dart 3.15+) re-prompts after showing the server's field validation warning.
		showInputBox.onFirstCall().resolves("\"\"\"");
		showInputBox.resolves(undefined);
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage");
		showErrorMessage.resolves(undefined);
		// Interactive Forms (Dart 3.15+) reports server field errors via showWarningMessage,
		// whereas legacy refactors report the failed refactor via showErrorMessage.
		const showWarningMessage = sb.stub(vs.window, "showWarningMessage");
		showWarningMessage.resolves(undefined);

		await setTestContent(`
import 'package:flutter/widgets.dart';

class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new Container();
  }
}
		`);
		await executeCodeAction({ title: "Extract Widget" }, rangeOf("||Container()"));

		// Ensure the content was not modified.
		await ensureTestContent(`
import 'package:flutter/widgets.dart';

class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new Container();
  }
}
		`);

		// Verify client-side input validation accepts a valid name and rejects the invalid name.
		const inputBoxOptions = showInputBox.firstCall.args[0];
		assert.equal(await inputBoxOptions?.validateInput?.("MyNewWidget") ?? undefined, undefined);
		assert.ok(await inputBoxOptions?.validateInput?.("\"\"\""));

		const textMatch = sinon.match("Class name must not contain '\"'.")
			.or(sinon.match("Class name must not contain '\"'.\n\nYour refactor was not applied."))
			.or(sinon.match("Question 1: Class name must not contain '\"'."));
		assert(showErrorMessage.calledWith(textMatch) || showWarningMessage.calledWith(textMatch));
	});
});
