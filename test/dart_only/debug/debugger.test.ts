import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { DebugClient } from "vscode-debugadapter-testsupport";
import { activate, ext } from "../../helpers";
import { FlutterLaunchRequestArguments } from "../../../src/debug/utils";

describe("debugger", () => {
	const dc = new DebugClient("node", "./out/src/debug/dart_debug_entry.js", "dart");
	const debugConfig: vs.DebugConfiguration = {
		name: "Dart & Flutter",
		program: "${workspaceRoot}/bin/main.dart",
		request: "launch",
		type: "dart",
	};

	before(() => activate());

	it("runs a Dart script to completion", async () => {
		const c = debugConfig as any as FlutterLaunchRequestArguments;
		await vs.debug.startDebugging(vs.workspace.workspaceFolders[0], debugConfig);
		// This fails because debugConfig doesn't appear to have the mutations made in the debugConfigProvider.
		await dc.start(debugConfig.debugServer);
		await dc.waitForEvent("terminated");
	});
});
