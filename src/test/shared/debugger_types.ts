import { strict as assert } from "assert";
import * as path from "path";
import { Uri } from "vscode";
import { isWin } from "../../shared/constants";
import { DebuggerType } from "../../shared/enums";
import { fsPath } from "../../shared/utils/fs";
import { createTempTestFile, getResolvedDebugConfiguration, setConfigForTest } from "../helpers";

export async function runDebuggerTypeTests(tests: Array<{ program: string; cwd?: string; debuggerType?: DebuggerType | string; expectedDebuggerType: DebuggerType; }>, defaultFolder: Uri): Promise<void> {
	for (const test of tests) {
		let program = test.program;
		const { cwd, debuggerType, expectedDebuggerType } = test;

		describe(program, async () => {
			const isSpecialTestOutsideTest = program.endsWith("*");
			program = program.endsWith("*") ? program.substring(0, program.length - 1) : program;

			let absoluteCwd = cwd && !path.isAbsolute(cwd)
				? path.normalize(path.join(fsPath(defaultFolder), cwd))
				: cwd;
			const absolutePath = path.normalize(path.join(absoluteCwd ?? fsPath(defaultFolder), program));

			beforeEach(async () => {
				createTempTestFile(absolutePath);
				if (isSpecialTestOutsideTest) {
					await setConfigForTest("dart", "allowTestsOutsideTestFolder", true);
				}
			});

			it(`absolute: ${absolutePath} (cwd: ${absoluteCwd})`, async () => {
				const resolvedConfig = await getResolvedDebugConfiguration({
					cwd: absoluteCwd,
					debuggerType,
					program: absolutePath,
				});
				assert.equal(DebuggerType[resolvedConfig.debuggerType], DebuggerType[expectedDebuggerType]);
			});
			if (!absoluteCwd) {
				absoluteCwd = fsPath(defaultFolder);
				it(`absolute: ${absolutePath} (cwd: ${absoluteCwd})`, async () => {
					const resolvedConfig = await getResolvedDebugConfiguration({
						cwd: absoluteCwd,
						debuggerType,
						program: absolutePath,
					});
					assert.equal(DebuggerType[resolvedConfig.debuggerType], DebuggerType[expectedDebuggerType]);
				});
			}
			it(`POSIX relative: ${program} (cwd: ${cwd})`, async () => {
				const resolvedConfig = await getResolvedDebugConfiguration({
					cwd,
					debuggerType,
					program,
				});
				assert.equal(DebuggerType[resolvedConfig.debuggerType], DebuggerType[expectedDebuggerType]);
			});
			if (isWin) {
				const windowsProgram = program.replace(/\//g, "\\");
				const windowsCwd = cwd?.replace(/\//g, "\\");
				it(`Windows relative: ${windowsProgram} (cwd: ${windowsCwd})`, async () => {
					const resolvedConfig = await getResolvedDebugConfiguration({
						cwd: windowsCwd,
						debuggerType,
						program: windowsProgram,
					});
					assert.equal(DebuggerType[resolvedConfig.debuggerType], DebuggerType[expectedDebuggerType]);
				});
			}
		});
	}
}

