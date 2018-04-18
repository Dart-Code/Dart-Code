import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as sinon from "sinon";
import * as vs from "vscode";
import { activate, doc, positionOf, setTestContent, editor, ensureTestContent, rangeOf, delay, defer, waitFor } from "../../helpers";
import { REFACTOR_FAILED_DOC_MODIFIED, REFACTOR_ANYWAY } from "../../../src/commands/refactor";

describe("refactor", () => {

	before(() => activate());

	it("can extract simple code into a method", async () => {
		const showInputBox = sinon.stub(vs.window, "showInputBox");
		defer(showInputBox.restore);
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
		await (vs.commands.executeCommand("_dart.performRefactor", doc, rangeOf("|Container()|"), "EXTRACT_WIDGET"));
		await ensureTestContent(`
import 'package:flutter/widgets.dart';

class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new MyOtherWidget();
  }
}

class MyOtherWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new Container();
  }
}
		`);
	});

	it("displays an error if an invalid range is selected", async () => {
		const showErrorMessage = sinon.stub(vs.window, "showErrorMessage");
		defer(showErrorMessage.restore);

		await setTestContent(`
import 'package:flutter/widgets.dart';

class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new Container();
  }
}
		`);
		await (vs.commands.executeCommand("_dart.performRefactor", doc, rangeOf("|MyWidget|"), "EXTRACT_WIDGET"));

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
		const showInputBox = sinon.stub(vs.window, "showInputBox");
		defer(showInputBox.restore);
		showInputBox.resolves("\"\"\"");
		const showErrorMessage = sinon.stub(vs.window, "showErrorMessage");
		defer(showErrorMessage.restore);

		await setTestContent(`
import 'package:flutter/widgets.dart';

class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return new Container();
  }
}
		`);
		await (vs.commands.executeCommand("_dart.performRefactor", doc, rangeOf("|Container()|"), "EXTRACT_WIDGET"));

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
		assert(() => showErrorMessage.calledOnce);
	});

	it("does not apply changes when there are errors if the user does not approve", async () => {
		const showInputBox = sinon.stub(vs.window, "showInputBox");
		defer(showInputBox.restore);
		showInputBox.resolves("MyWidget");
		const showErrorMessage = sinon.stub(vs.window, "showErrorMessage");
		defer(showErrorMessage.restore);
		const refactorPrompt = showErrorMessage.withArgs(sinon.match.any, REFACTOR_ANYWAY).resolves();
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
		await (vs.commands.executeCommand("_dart.performRefactor", doc, rangeOf("|Container()|"), "EXTRACT_WIDGET"));

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
		const showInputBox = sinon.stub(vs.window, "showInputBox");
		defer(showInputBox.restore);
		showInputBox.resolves("MyWidget");
		const showErrorMessage = sinon.stub(vs.window, "showErrorMessage");
		defer(showErrorMessage.restore);
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
		await (vs.commands.executeCommand("_dart.performRefactor", doc, rangeOf("|Container()|"), "EXTRACT_WIDGET"));

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
  @override
  Widget build(BuildContext context) {
    return new Container();
  }
}
		`);

		assert(refactorPrompt.calledOnce);
	});

	it("rejects the edit if the document has been modified before the user approves", async () => {
		const showInputBox = sinon.stub(vs.window, "showInputBox");
		defer(showInputBox.restore);
		showInputBox.resolves("MyWidget");
		const showErrorMessage = sinon.stub(vs.window, "showErrorMessage");
		defer(showErrorMessage.restore);
		// Accept after some time (so the doc can be edited by the test).
		const refactorPrompt = showErrorMessage.withArgs(sinon.match.any, REFACTOR_ANYWAY).returns(delay(500).then(() => REFACTOR_ANYWAY));
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
		const refactorCommand = (vs.commands.executeCommand("_dart.performRefactor", doc, rangeOf("|Container()|"), "EXTRACT_WIDGET"));

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

		assert(rejectMessage.calledOnce);
	});
});
