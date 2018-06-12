import * as vs from "vscode";
import { DebugClient } from "vscode-debugadapter-testsupport";
import { activate } from "../../helpers";

const testDebugServerPortNumber = 4715;

// Skipped because of https://github.com/Microsoft/vscode/issues/46028
describe.skip("debug_config_provider", () => {
	const dc = new DebugClient("node", "./out/src/debug/dart_debug_entry.js", "dart");
	dc.defaultTimeout = 30000;
	const debugConfig: vs.DebugConfiguration = {
		debugServer: testDebugServerPortNumber,
		name: "Dart & Flutter",
		program: "bin/main.dart",
		request: "launch",
		type: "dart",
	};

	beforeEach("activate", () => activate());

	it("runs a Dart script to completion", async () => {
		await vs.debug.startDebugging(vs.workspace.workspaceFolders[0], debugConfig);
		await dc.start(debugConfig.debugServer);

		// TODO: Currently this just times out. My guess is that the test debug client didn't
		// connect/initialise properly.
		await dc.waitForEvent("terminated");

	});
});
