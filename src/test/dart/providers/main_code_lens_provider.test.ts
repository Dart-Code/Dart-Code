import * as assert from "assert";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { activate, addLaunchConfigsForTest, extApi, getCodeLens, getPackages, helloWorldMainFile, helloWorldTestMainFile, openFile, positionOf, waitForResult } from "../../helpers";

describe("main_code_lens", () => {
	before("get packages", () => getPackages());
	beforeEach("activate", () => activate());

	it("includes run/debug actions for main methods", async function () {
		const editor = await openFile(helloWorldMainFile);
		await waitForResult(() => !!extApi.fileTracker.getOutlineFor(helloWorldMainFile));

		const fileCodeLens = await getCodeLens(editor.document);
		const mainMethodPos = positionOf(`main^() async {`);

		const codeLensForMainMethod = fileCodeLens.filter((cl) => cl.range.start.line === mainMethodPos.line);
		assert.equal(codeLensForMainMethod.length, 2);

		if (!codeLensForMainMethod[0].command) {
			// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
			// race condition. Rather than failing our test runs, skip.
			// TODO: Remove this if https://github.com/microsoft/vscode/issues/79805 gets a reliable fix.
			this.skip();
			return;
		}

		const runAction = codeLensForMainMethod.find((cl) => cl.command!.title === "Run")!;
		assert.equal(runAction!.command!.command, "dart.startWithoutDebugging");
		assert.equal(fsPath(runAction!.command!.arguments![0]), fsPath(helloWorldMainFile));

		const debugAction = codeLensForMainMethod.find((cl) => cl.command!.title === "Debug");
		assert.equal(debugAction!.command!.command, "dart.startDebugging");
		assert.equal(fsPath(debugAction!.command!.arguments![0]), fsPath(helloWorldMainFile));
	});

	for (const debugType of [
		{ type: "run", name: "Run" },
		{ type: "debug", name: "Debug" },
	]) {
		for (const testConfig of [
			{ type: "file", fileUri: helloWorldMainFile, lensLocation: "main^() async {" },
			{ type: "test-file", fileUri: helloWorldTestMainFile, lensLocation: "main^() {" },
		]) {
			it(`includes custom templated ${debugType.type} actions from launch templates for ${testConfig.type}`, async function () {
				await addLaunchConfigsForTest(
					vs.workspace.workspaceFolders![0].uri,
					[
						{
							console: "terminal",
							name: "${debugType} in Terminal",
							request: "launch",
							template: [`${debugType.type}-${testConfig.type}`],
							type: "dart",
						},
					],
				);

				const editor = await openFile(testConfig.fileUri);
				await waitForResult(() => !!extApi.fileTracker.getOutlineFor(testConfig.fileUri));

				const fileCodeLens = await getCodeLens(editor.document);
				const mainMethodPos = positionOf(testConfig.lensLocation);

				const codeLensForMainMethod = fileCodeLens.filter((cl) => cl.range.start.line === mainMethodPos.line);
				assert.equal(codeLensForMainMethod.length, 3);

				if (!codeLensForMainMethod[0].command) {
					// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
					// race condition. Rather than failing our test runs, skip.
					// TODO: Remove this if https://github.com/microsoft/vscode/issues/79805 gets a reliable fix.
					this.skip();
					return;
				}

				const action = codeLensForMainMethod.find((cl) => cl.command!.title === `${debugType.name} in Terminal`)!;
				assert.equal(action!.command!.command, debugType.type === "debug" ? "dart.startDebugging" : "dart.startWithoutDebugging");
				assert.equal(fsPath(action!.command!.arguments![0]), fsPath(testConfig.fileUri));
				assert.equal(action!.command!.arguments![1].console, "terminal");
			});
		}
	}
});
