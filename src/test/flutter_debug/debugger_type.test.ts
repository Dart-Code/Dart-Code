import { strict as assert } from "assert";
import * as path from "path";
import { isWin } from "../../shared/constants";
import { DebuggerType } from "../../shared/enums";
import { fsPath } from "../../shared/utils/fs";
import { waitFor } from "../../shared/utils/promises";
import { flutterTestDeviceId, flutterTestDeviceIsWeb } from "../debug_helpers";
import { activate, createTempTestFile, extApi, flutterHelloWorldFolder, getResolvedDebugConfiguration, setConfigForTest } from "../helpers";

describe(`flutter debugger`, () => {
	beforeEach("activate", () => activate(null));

	beforeEach("Wait for device to be available", async () => {
		// For web, the device doesn't show up immediately so we need to wait
		// otherwise we will prompt to select a device when starting the debug
		// session in the test. This is not required for flutter-tester as that
		// bypasses the device check.
		if (flutterTestDeviceIsWeb)
			await waitFor(() => extApi.deviceManager!.getDevice(flutterTestDeviceId));
	});

	describe("picks the correct debugger", async () => {
		const tests: { [key: string]: DebuggerType } = {
			// All POSIX paths, Windows handled below.
			"bin/temp_tool.dart": DebuggerType.Dart,
			"lib/temp.dart": DebuggerType.Flutter,
			"lib/temp1_test.dart": DebuggerType.Flutter,
			"lib/temp2_test.dart*": DebuggerType.FlutterTest, // Special case for allowTestsOutsideTestFolder
			"test/temp_test.dart": DebuggerType.FlutterTest,
			"test/tool/temp_tool_test.dart": DebuggerType.FlutterTest,
			"tool/temp_tool.dart": DebuggerType.Dart,
		};
		for (let testPath of Object.keys(tests)) {
			const isSpecialTestOutsideTest = testPath.endsWith("*");
			testPath = isSpecialTestOutsideTest ? testPath.substring(0, testPath.length - 1) : testPath;

			const absolutePath = path.join(fsPath(flutterHelloWorldFolder), testPath);
			const expectedDebuggerType = isSpecialTestOutsideTest ? DebuggerType.FlutterTest : tests[testPath];

			describe(`${testPath} ${isSpecialTestOutsideTest ? " (test outside of test folder)" : ""}`, async () => {
				beforeEach(async () => {
					createTempTestFile(absolutePath);
					if (isSpecialTestOutsideTest) {
						await setConfigForTest("dart", "allowTestsOutsideTestFolder", true);
					}
				});

				it("absolute", async () => {
					const resolvedConfig = await getResolvedDebugConfiguration({
						program: absolutePath,
					})!;
					assert.equal(resolvedConfig.debuggerType, expectedDebuggerType);
				});
				it("POSIX relative", async () => {
					const resolvedConfig = await getResolvedDebugConfiguration({
						cwd: fsPath(flutterHelloWorldFolder),
						program: path.join(testPath),
					})!;
					assert.equal(resolvedConfig.debuggerType, expectedDebuggerType);
				});
				if (isWin) {
					const windowsTestPath = testPath.replace("\\", "/");
					it("Windows relative", async () => {
						const resolvedConfig = await getResolvedDebugConfiguration({
							cwd: fsPath(flutterHelloWorldFolder),
							program: path.join(windowsTestPath),
						})!;
						assert.equal(resolvedConfig.debuggerType, expectedDebuggerType);
					});
				}
			});
		}
	});
});
