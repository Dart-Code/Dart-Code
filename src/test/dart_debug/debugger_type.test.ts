import { strict as assert } from "assert";
import * as path from "path";
import { isWin } from "../../shared/constants";
import { DebuggerType } from "../../shared/enums";
import { fsPath } from "../../shared/utils/fs";
import { activate, createTempTestFile, extApi, getResolvedDebugConfiguration, helloWorldFolder, setConfigForTest } from "../helpers";

describe("dart debugger", () => {
	beforeEach("activate", () => activate(null));

	beforeEach(function () {
		if (isWin && !extApi.dartCapabilities.hasDdsTimingFix)
			this.skip();
	});

	describe("picks the correct debugger", async () => {
		const tests: { [key: string]: DebuggerType } = {
			// All POSIX paths, Windows handled below.
			"bin/temp.dart": DebuggerType.Dart,
			"bin/temp_tool.dart": DebuggerType.Dart,
			"lib/temp_test.dart": DebuggerType.Dart,
			"lib/temp_test.dart*": DebuggerType.DartTest, // Special case for allowTestsOutsideTestFolder
			"test/temp_test.dart": DebuggerType.DartTest,
			"tool/temp_tool.dart": DebuggerType.Dart,
		};
		for (let testPath of Object.keys(tests)) {
			const isSpecialTestOutsideTest = testPath.endsWith("*");
			testPath = isSpecialTestOutsideTest ? testPath.substring(0, testPath.length - 1) : testPath;

			const absolutePath = path.join(fsPath(helloWorldFolder), testPath);
			const expectedDebuggerType = isSpecialTestOutsideTest ? DebuggerType.DartTest : tests[testPath];

			beforeEach(async () => {
				createTempTestFile(absolutePath);
				if (isSpecialTestOutsideTest)
					await setConfigForTest("dart", "allowTestsOutsideTestFolder", true);
			});

			it(`for absolute ${testPath}`, async () => {
				const resolvedConfig = await getResolvedDebugConfiguration({
					program: absolutePath,
				})!;
				assert.equal(resolvedConfig.debuggerType, expectedDebuggerType);
			});
			it(`for POSIX relative ${testPath}`, async () => {
				const resolvedConfig = await getResolvedDebugConfiguration({
					cwd: fsPath(helloWorldFolder),
					program: path.join(testPath),
				})!;
				assert.equal(resolvedConfig.debuggerType, expectedDebuggerType);
			});
			if (isWin) {
				const windowsTestPath = testPath.replace("\\", "/");
				it(`for Windows relative ${windowsTestPath}`, async () => {
					const resolvedConfig = await getResolvedDebugConfiguration({
						cwd: fsPath(helloWorldFolder),
						program: path.join(windowsTestPath),
					})!;
					assert.equal(resolvedConfig.debuggerType, expectedDebuggerType);
				});
			}
		}
	});
});

