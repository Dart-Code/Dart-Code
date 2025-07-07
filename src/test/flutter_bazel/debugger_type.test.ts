import { strict as assert } from "assert";
import * as path from "path";
import { Uri } from "vscode";
import { isWin } from "../../shared/constants";
import { DebuggerType } from "../../shared/enums";
import { fsPath } from "../../shared/utils/fs";
import { waitFor } from "../../shared/utils/promises";
import { flutterTestDeviceId, flutterTestDeviceIsWeb } from "../debug_helpers";
import { activate, flutterHelloWorldFolder, getResolvedDebugConfiguration, privateApi } from "../helpers";

describe(`flutter debugger type`, async () => {
	beforeEach(function () {
		if (isWin)
			this.skip();
	});

	beforeEach("activate", () => activate(null));

	beforeEach("Wait for device to be available", async () => {
		// For web, the device doesn't show up immediately so we need to wait
		// otherwise we will prompt to select a device when starting the debug
		// session in the test. This is not required for flutter-tester as that
		// bypasses the device check.
		if (flutterTestDeviceIsWeb)
			await waitFor(() => privateApi.deviceManager!.getDevice(flutterTestDeviceId));
	});

	const tests: Array<{ program: string, cwd?: string, debugger: DebuggerType }> = [
		// forceFlutter means we should always use Flutter even for unknown // targets.
		{
			debugger: DebuggerType.Flutter,
			program: "//foo/bar/baz.dart",
		},
		{
			cwd: "../hello_world",
			debugger: DebuggerType.Flutter,
			program: "//foo/bar/baz.dart",
		},
	];

	await runDebuggerTypeTests(tests, flutterHelloWorldFolder);
});


export async function runDebuggerTypeTests(tests: Array<{ program: string; cwd?: string | undefined; debugger: DebuggerType; }>, defaultFolder: Uri): Promise<void> {
	for (const test of tests) {
		const program = test.program;
		const { cwd, debugger: expectedDebuggerType } = test;

		describe(program, async () => {
			let absoluteCwd = cwd && !path.isAbsolute(cwd)
				? path.normalize(path.join(fsPath(defaultFolder), cwd))
				: cwd;

			it(`${program} (cwd: ${absoluteCwd})`, async () => {
				const resolvedConfig = await getResolvedDebugConfiguration({
					cwd: absoluteCwd,
					program,
				});
				assert.equal(DebuggerType[resolvedConfig.debuggerType], DebuggerType[expectedDebuggerType]);
			});
			if (!absoluteCwd) {
				absoluteCwd = fsPath(defaultFolder);
				it(`${program} (cwd: ${absoluteCwd})`, async () => {
					const resolvedConfig = await getResolvedDebugConfiguration({
						cwd: absoluteCwd,
						program,
					});
					assert.equal(DebuggerType[resolvedConfig.debuggerType], DebuggerType[expectedDebuggerType]);
				});
			}
		});
	}
}
