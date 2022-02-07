import { strict as assert } from "assert";
import * as sinon from "sinon";
import * as vs from "vscode";
import { REFACTOR_ANYWAY, REFACTOR_FAILED_DOC_MODIFIED } from "../../../shared/constants";
import { PromiseCompleter } from "../../../shared/utils";
import { activate, ensureTestContent, executeCodeAction, extApi, getCodeActions, rangeOf, sb, setTestContent, waitForResult } from "../../helpers";

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
    Key key,
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

	it("does not apply changes when there are errors if the user does not approve", async function () {
		if (extApi.isLsp)
			this.skip(); // LSP doesn't ask for the name

		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("MyWidget");
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage");
		const refactorPrompt = showErrorMessage.withArgs(sinon.match.any, REFACTOR_ANYWAY).resolves();

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
		assert(refactorPrompt.calledOnce);
	});

	it("applies changes when there are errors if the user approves", async function () {
		if (extApi.isLsp)
			this.skip(); // LSP doesn't ask for the name

		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("MyWidget");
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage").callThrough();
		const refactorPrompt = showErrorMessage.withArgs(sinon.match.any, REFACTOR_ANYWAY).resolves(REFACTOR_ANYWAY);

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

		// Ensure the content was modified.
		await ensureTestContent(`
import 'package:flutter/widgets.dart';

class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new MyWidget();
  }
}

class MyWidget extends StatelessWidget {
  const MyWidget({
    Key key,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return new Container();
  }
}
		`, true);

		assert(refactorPrompt.calledOnce);
	});

	it("rejects the edit if the document has been modified before the user approves", async function () {
		if (extApi.isLsp)
			this.skip(); // LSP doesn't prompt

		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("MyWidget");
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage").callThrough();
		// Accept after some time (so the doc can be edited by the test).
		const refactorAnywayChoice = new PromiseCompleter();
		const refactorPrompt = showErrorMessage.withArgs(sinon.match.any, REFACTOR_ANYWAY).returns(refactorAnywayChoice.promise);
		const rejectMessage = showErrorMessage.withArgs(REFACTOR_FAILED_DOC_MODIFIED).resolves();

		await setTestContent(`
import 'package:flutter/widgets.dart';

class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new Container();
  }
}
		`);

		// Start the command but don't await it.
		const refactorCommand = executeCodeAction({ title: "Extract Widget" }, rangeOf("||Container()"));

		// Wait for the message to appear.
		await waitForResult(() => refactorPrompt.called);

		// Change the document in the meantime.
		await setTestContent(`
import 'package:flutter/widgets.dart';

class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new Container();
  }
}
// This comment was added
		`);

		refactorAnywayChoice.resolve(REFACTOR_ANYWAY);

		// Wait for the command to complete.
		await refactorCommand;

		// Ensure nothing changed.
		await ensureTestContent(`
import 'package:flutter/widgets.dart';

class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new Container();
  }
}
// This comment was added
		`);

		assert(rejectMessage.calledOnce, "Reject message was not shown");
	});
});
