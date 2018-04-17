import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as sinon from "sinon";
import * as vs from "vscode";
import { activate, doc, positionOf, setTestContent, editor, ensureTestContent, rangeOf, delay, defer } from "../../helpers";
import { REFACTOR_FAILED_DOC_MODIFIED, REFACTOR_ANYWAY } from "../../../src/commands/refactor";

describe.only("refactor", () => {

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

	it.skip("displays an error if an invalid range is selected");

	it.skip("displays an error if an invalid new name is provided");

	it.skip("does not apply changes when there are warnings if the user does not approve");

	it.skip("applies changes when there are warnings if the user approves");

	it.skip("rejects the edit if the document has been modified");
});
