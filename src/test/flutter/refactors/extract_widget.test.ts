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
    Key? key,
  }) : super(key: key);

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

		const codeActions = await getCodeActions({ title: "Extract Widget" }, rangeOf("|MyWidget|"));
		assert.equal(codeActions.length, 0);
	});

	it("displays an error if an invalid new name is provided", async () => {
		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("\"\"\"");
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage");
		showErrorMessage.resolves(undefined);

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
		const textMatch = sinon.match("Class name must not contain '\"'.")
			.or(sinon.match("Class name must not contain '\"'.\n\nYour refactor was not applied."));
		assert(showErrorMessage.calledWith(textMatch));
	});
});
