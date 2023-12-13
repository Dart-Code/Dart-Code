import { strict as assert } from "assert";
import * as path from "path";
import { isWin } from "../../shared/constants";
import { DebuggerType } from "../../shared/enums";
import { fsPath } from "../../shared/utils/fs";
import { waitFor } from "../../shared/utils/promises";
import { flutterTestDeviceId, flutterTestDeviceIsWeb } from "../debug_helpers";
import { activate, createTempTestFile, extApi, flutterHelloWorldFolder, getResolvedDebugConfiguration, setConfigForTest } from "../helpers";

describe.only(`debugger type`, () => {
	beforeEach("activate", () => activate(null));

	beforeEach("Wait for device to be available", async () => {
		// For web, the device doesn't show up immediately so we need to wait
		// otherwise we will prompt to select a device when starting the debug
		// session in the test. This is not required for flutter-tester as that
		// bypasses the device check.
		if (flutterTestDeviceIsWeb)
			await waitFor(() => extApi.deviceManager!.getDevice(flutterTestDeviceId));
	});

	const tests: Array<{ program: string, cwd?: string, debugger: DebuggerType }> = [
		// All POSIX paths, Windows handled below.
		// These files should not exist, they are created as part of the test.
		{ program: "bin/temp_tool.dart", debugger: DebuggerType.Dart },
		{ program: "lib/temp.dart", debugger: DebuggerType.Flutter },
		{ program: "lib/temp1_test.dart", debugger: DebuggerType.Flutter },
		{ program: "lib/temp2_test.dart*", debugger: DebuggerType.FlutterTest }, // Special case for allowTestsOutsideTestFolder
		{ program: "test/temp_test.dart", debugger: DebuggerType.FlutterTest },
		{ program: "test/tool/temp_tool_test.dart", debugger: DebuggerType.FlutterTest },
		{ program: "tool/temp_tool.dart", debugger: DebuggerType.Dart },
		// CWD here, but Program in another Flutter project.
		{
			// CWD defaults to this project.
			debugger: DebuggerType.Flutter,
			program: "../dart_nested_flutter/nested_flutter_example/lib/temp.dart",
		},
		// CWD in another Flutter project, but tool here.
		{
			cwd: "../dart_nested_flutter/nested_flutter_example",
			debugger: DebuggerType.Dart,
			program: "../../flutter_hello_world/tool/temp_tool.dart",
		},
		// CWD here, but Program in another Dart project.
		{
			// CWD defaults to this project.
			debugger: DebuggerType.Dart,
			program: "../hello_world/bin/temp.dart",
		},
		// CWD in another Dart project, but app here.
		{
			cwd: "../hello_world",
			debugger: DebuggerType.Flutter,
			program: "../flutter_hello_world/lib/temp.dart",
		},
	];
	for (const test of tests) {
		let program = test.program;
		const { cwd, debugger: expectedDebuggerType } = test;

		describe(program, async () => {
			const isSpecialTestOutsideTest = program.endsWith("*");
			program = program.endsWith("*") ? program.substring(0, program.length - 1) : program;

			let absoluteCwd =
				cwd && !path.isAbsolute(cwd)
					? path.normalize(path.join(fsPath(flutterHelloWorldFolder), cwd))
					: cwd;
			const absolutePath = path.normalize(path.join(absoluteCwd ?? fsPath(flutterHelloWorldFolder), program));

			beforeEach(async () => {
				createTempTestFile(absolutePath);
				if (isSpecialTestOutsideTest) {
					await setConfigForTest("dart", "allowTestsOutsideTestFolder", true);
				}
			});

			it(`absolute: ${absolutePath} (cwd: ${absoluteCwd})`, async () => {
				const resolvedConfig = await getResolvedDebugConfiguration({
					cwd: absoluteCwd,
					program: absolutePath,
				})!;
				assert.equal(DebuggerType[resolvedConfig.debuggerType], DebuggerType[expectedDebuggerType]);
			});
			if (!absoluteCwd) {
				absoluteCwd = fsPath(flutterHelloWorldFolder);
				it(`absolute: ${absolutePath} (cwd: ${absoluteCwd})`, async () => {
					const resolvedConfig = await getResolvedDebugConfiguration({
						cwd: absoluteCwd,
						program: absolutePath,
					})!;
					assert.equal(DebuggerType[resolvedConfig.debuggerType], DebuggerType[expectedDebuggerType]);
				});
			}
			it(`POSIX relative: ${program} (cwd: ${cwd})`, async () => {
				const resolvedConfig = await getResolvedDebugConfiguration({
					cwd,
					program,
				})!;
				assert.equal(DebuggerType[resolvedConfig.debuggerType], DebuggerType[expectedDebuggerType]);
			});
			if (isWin) {
				const windowsProgram = program.replace(/\//g, "\\");
				const windowsCwd = cwd?.replace(/\//g, "\\");
				it(`Windows relative: ${windowsProgram} (cwd: ${windowsCwd})`, async () => {
					const resolvedConfig = await getResolvedDebugConfiguration({
						cwd: windowsCwd,
						program: windowsProgram,
					})!;
					assert.equal(DebuggerType[resolvedConfig.debuggerType], DebuggerType[expectedDebuggerType]);
				});
			}
		});
	}
});
