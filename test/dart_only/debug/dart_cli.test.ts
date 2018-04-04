import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { DebugClient } from "vscode-debugadapter-testsupport";
import { activate, ext, helloWorldMainFile } from "../../helpers";
import { FlutterLaunchRequestArguments } from "../../../src/debug/utils";

describe("dart cli debugger", () => {
	const dc = new DebugClient("node", "./out/src/debug/dart_debug_entry.js", "dart");

	before(() => activate(helloWorldMainFile));
	beforeEach(() => dc.start());
	afterEach(() => dc.stop());

	it("runs a Dart script to completion", async () => {
		const debugConfig = await ext.exports.debugProvider.resolveDebugConfiguration(
			vs.workspace.workspaceFolders[0],
			{
				name: "Dart & Flutter",
				program: helloWorldMainFile.fsPath,
				request: "launch",
				type: "dart",
			},
		);

		await Promise.all([
			dc.configurationSequence(),
			dc.launch(debugConfig),
			dc.waitForEvent("terminated"),
		]);
	});
});
