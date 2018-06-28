import * as assert from "assert";
import * as vs from "vscode";
import { activate, currentDoc, flutterEmptyFile, rangeOf, setTestContent } from "../../helpers";

describe("fix_code_action_provider", () => {

	beforeEach("activate flutterEmptyFile and add test content", async () => {
		await activate(flutterEmptyFile);
		await setTestContent(`
			import 'package:flutter/widgets.dart';

			class _MyCustomPainter extends CustomPainter {
			@override
			void paint(Canvas canvas, Size size) {
				var rect = Offset.zero & size;
				var gradient = LinearGradient(
				colors: [Colors.green, Colors.red, Colors.blue],
				stops: [0.4, 0.5, 0.6],
				);
				canvas.drawRect(rect, Paint()..shader = gradient.createShader(rect));
			}

			@override
			bool shouldRepaint(CustomPainter oldDelegate) => false;
			}
		`);
	});

	it("returns expected items", async () => {
		const fixResults = await (vs.commands.executeCommand("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("Col||ors")) as Thenable<vs.CodeAction[]>);
		assert.ok(fixResults);
		assert.ok(fixResults.length);
		assert.ok(fixResults.find((r) => r.title.indexOf("Create local variable 'Colors'") !== -1));
	});

	it("does not contain duplicates", async () => {
		const fixResults = await (vs.commands.executeCommand("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf("Col||ors")) as Thenable<vs.CodeAction[]>);
		assert.ok(fixResults);
		assert.ok(fixResults.length);
		// Ensure no edit is the same as one that came before it.
		fixResults.forEach((action1, index) => {
			fixResults.slice(index + 1).forEach((action2) => {
				assert.notDeepEqual(action1, action2);
			});
		});
	});
});
