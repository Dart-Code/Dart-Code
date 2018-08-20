import * as assert from "assert";
import * as sinon from "sinon";
import * as vs from "vscode";
import { REFACTOR_ANYWAY, REFACTOR_FAILED_DOC_MODIFIED } from "../../../src/commands/refactor";
import { PromiseCompleter } from "../../../src/debug/utils";
import { activate, currentDoc, ensureTestContent, extApi, rangeOf, sb, setTestContent, waitFor } from "../../helpers";

describe("refactor", () => {
	beforeEach("activate", () => activate());
	// tslint:disable-next-line:only-arrow-functions
	beforeEach("skip if not updated widget snippets", function () {
		if (!extApi.analyzerCapabilities.hasUpdatedWidgetSnippets)
			this.skip();
	});

	it("can extract simple code into a widget", async () => {
		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("MyOtherWidget");

		await setTestContent(`
import 'package:flutter/widgets.dart';

class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new Container();
  }
}
		`);
		await (vs.commands.executeCommand("_dart.performRefactor", currentDoc(), rangeOf("||Container()"), "EXTRACT_WIDGET"));
		await ensureTestContent(`
import 'package:flutter/widgets.dart';

class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new MyOtherWidget();
  }
}

class MyOtherWidget extends StatelessWidget {
  const MyOtherWidget({
    Key key,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return new Container();
  }
}
		`);
	});

	it("displays an error if an invalid range is selected", async () => {
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage");

		await setTestContent(`
import 'package:flutter/widgets.dart';

class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new Container();
  }
}
		`);
		await (vs.commands.executeCommand("_dart.performRefactor", currentDoc(), rangeOf("|MyWidget|"), "EXTRACT_WIDGET"));

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
		assert(showErrorMessage.calledOnce);
	});

	it("displays an error if an invalid new name is provided", async () => {
		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("\"\"\"");
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage");

		await setTestContent(`
import 'package:flutter/widgets.dart';

class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new Container();
  }
}
		`);
		await (vs.commands.executeCommand("_dart.performRefactor", currentDoc(), rangeOf("||Container()"), "EXTRACT_WIDGET"));

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
		assert(showErrorMessage.calledOnce);
	});

	it("does not apply changes when there are errors if the user does not approve", async () => {
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
		await (vs.commands.executeCommand("_dart.performRefactor", currentDoc(), rangeOf("||Container()"), "EXTRACT_WIDGET"));

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

	it("applies changes when there are errors if the user approves", async () => {
		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("MyWidget");
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage");
		const refactorPrompt = showErrorMessage.withArgs(sinon.match.any, REFACTOR_ANYWAY).resolves(REFACTOR_ANYWAY);
		showErrorMessage.callThrough();

		await setTestContent(`
import 'package:flutter/widgets.dart';

class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new Container();
  }
}
		`);
		await (vs.commands.executeCommand("_dart.performRefactor", currentDoc(), rangeOf("||Container()"), "EXTRACT_WIDGET"));

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
		`);

		assert(refactorPrompt.calledOnce);
	});

	it("rejects the edit if the document has been modified before the user approves", async () => {
		const showInputBox = sb.stub(vs.window, "showInputBox");
		showInputBox.resolves("MyWidget");
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage");
		// Accept after some time (so the doc can be edited by the test).
		const refactorAnywayChoice = new PromiseCompleter();
		const refactorPrompt = showErrorMessage.withArgs(sinon.match.any, REFACTOR_ANYWAY).returns(refactorAnywayChoice.promise);
		const rejectMessage = showErrorMessage.withArgs(REFACTOR_FAILED_DOC_MODIFIED).resolves();
		showErrorMessage.callThrough();

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
		const refactorCommand = (vs.commands.executeCommand("_dart.performRefactor", currentDoc(), rangeOf("||Container()"), "EXTRACT_WIDGET"));

		// Wait for the message to appear.
		await waitFor(() => refactorPrompt.called);

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
