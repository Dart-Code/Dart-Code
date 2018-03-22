import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { activate, doc, getPositionOf, setTestContent, editor, ensureTestContent, rangeOf, delay, flutterEmptyFile } from "../../helpers";
import { SourceChange } from "../../../src/analysis/analysis_server_types";

describe.only("fix_code_action_provider", () => {

	before(async () => {
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

	it.only("returns expected items", async () => {
		const fixResults = await (vs.commands.executeCommand("vscode.executeCodeActionProvider", doc.uri, rangeOf("Col||ors")) as Thenable<vs.CodeAction[]>);
		assert.ok(fixResults);
		assert.ok(fixResults.length);
		assert.ok(fixResults.find((r) => r.title.indexOf("Create local variable 'Colors'") !== -1));
	});

	it.only("does not contain duplicates", async () => {
		const fixResults = await (vs.commands.executeCommand("vscode.executeCodeActionProvider", doc.uri, rangeOf("Col||ors")) as Thenable<vs.CodeAction[]>);
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
