import { strict as assert } from "assert";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { activate, addLaunchConfigsForTest, getCodeLens, getPackages, helloWorldMainFile, helloWorldTestMainFile, openFile, positionOf, privateApi, waitForResult } from "../../helpers";

describe("main_code_lens", () => {
	before("get packages", () => getPackages());
	beforeEach("activate", () => activate());

	it("includes run/debug actions for main function", async function () {
		const editor = await openFile(helloWorldMainFile);
		await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldMainFile));

		const fileCodeLens = await getCodeLens(editor.document);
		const mainFunctionPos = positionOf(`main^() async {`);

		const codeLensForMainFunction = fileCodeLens.filter((cl) => cl.range.start.line === mainFunctionPos.line);
		assert.equal(codeLensForMainFunction.length, 2);

		if (!codeLensForMainFunction[0].command) {
			// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
			// race condition. Rather than failing our test runs, skip.
			// TODO: Remove this if https://github.com/microsoft/vscode/issues/79805 gets a reliable fix.
			this.skip();
			return;
		}

		const runAction = codeLensForMainFunction.find((cl) => cl.command!.title === "Run")!;
		assert.equal(runAction.command!.command, "dart.startWithoutDebugging");
		assert.equal(fsPath(runAction.command!.arguments![0].resource as vs.Uri), fsPath(helloWorldMainFile));

		const debugAction = codeLensForMainFunction.find((cl) => cl.command!.title === "Debug");
		assert.equal(debugAction!.command!.command, "dart.startDebugging");
		assert.equal(fsPath(debugAction!.command!.arguments![0].resource as vs.Uri), fsPath(helloWorldMainFile));
	});

	it("uses default templates for run/debug actions for main function", async function () {
		const editor = await openFile(helloWorldMainFile);
		await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldMainFile));

		const fileCodeLens = await getCodeLens(editor.document);
		const mainFunctionPos = positionOf(`main^() async {`);

		const codeLensForMainFunction = fileCodeLens.filter((cl) => cl.range.start.line === mainFunctionPos.line);
		assert.equal(codeLensForMainFunction.length, 2);

		if (!codeLensForMainFunction[0].command) {
			// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
			// race condition. Rather than failing our test runs, skip.
			// TODO: Remove this if https://github.com/microsoft/vscode/issues/79805 gets a reliable fix.
			this.skip();
			return;
		}

		const runAction = codeLensForMainFunction.find((cl) => cl.command!.title === "Run")!;
		assert.equal(runAction.command!.arguments![0].launchTemplate.env.LAUNCH_ENV_VAR, "default");

		const debugAction = codeLensForMainFunction.find((cl) => cl.command!.title === "Debug")!;
		assert.equal(debugAction.command!.arguments![0].launchTemplate.env.LAUNCH_ENV_VAR, "noDebugExplicitlyFalse");
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
							codeLens: {
								for: [`${debugType.type}-${testConfig.type}`],
								title: "${debugType} (terminal)",
							},
							console: "terminal",
							name: "Run in Terminal",
							request: "launch",
							type: "dart",
						},
					],
				);

				const editor = await openFile(testConfig.fileUri);
				await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(testConfig.fileUri));

				const fileCodeLens = await getCodeLens(editor.document);
				const mainFunctionPos = positionOf(testConfig.lensLocation);

				const codeLensForMainFunction = fileCodeLens.filter((cl) => cl.range.start.line === mainFunctionPos.line);
				assert.equal(codeLensForMainFunction.length, 3);

				if (!codeLensForMainFunction[0].command) {
					// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
					// race condition. Rather than failing our test runs, skip.
					// TODO: Remove this if https://github.com/microsoft/vscode/issues/79805 gets a reliable fix.
					this.skip();
					return;
				}

				const action = codeLensForMainFunction.find((cl) => cl.command!.title === `${debugType.name} (terminal)`)!;
				assert.equal(action.command!.command, debugType.type === "debug" ? "dart.startDebugging" : "dart.startWithoutDebugging");
				assert.equal(fsPath(action.command!.arguments![0].resource as vs.Uri), fsPath(testConfig.fileUri));
				assert.equal(action.command!.arguments![0].launchTemplate.console, "terminal");
			});

			it(`replaces default ${debugType.type} action with custom templated actions from launch templates for ${testConfig.type}`, async function () {
				await addLaunchConfigsForTest(
					vs.workspace.workspaceFolders![0].uri,
					[
						{
							codeLens: {
								for: [`${debugType.type}-${testConfig.type}`],
								title: "${debugType}",
							},
							console: "terminal",
							name: "test_config",
							request: "launch",
							type: "dart",
						},
					],
				);

				const editor = await openFile(testConfig.fileUri);
				await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(testConfig.fileUri));

				const fileCodeLens = await getCodeLens(editor.document);
				const mainFunctionPos = positionOf(testConfig.lensLocation);

				const codeLensForMainFunction = fileCodeLens.filter((cl) => cl.range.start.line === mainFunctionPos.line);
				assert.equal(codeLensForMainFunction.length, 2);

				if (!codeLensForMainFunction[0].command) {
					// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
					// race condition. Rather than failing our test runs, skip.
					// TODO: Remove this if https://github.com/microsoft/vscode/issues/79805 gets a reliable fix.
					this.skip();
					return;
				}

				const action = codeLensForMainFunction.find((cl) => cl.command!.title === `${debugType.name}`)!;
				assert.equal(action.command!.command, debugType.type === "debug" ? "dart.startDebugging" : "dart.startWithoutDebugging");
				assert.equal(fsPath(action.command!.arguments![0].resource as vs.Uri), fsPath(testConfig.fileUri));
				assert.equal(action.command!.arguments![0].launchTemplate.console, "terminal");
			});
		}
	}

	for (const testConfig of [
		{ fileUri: helloWorldMainFile, lensLocation: "main^() async {", expectMatch: false },
		{ fileUri: helloWorldTestMainFile, lensLocation: "main^() {", expectMatch: true },
	]) {
		for (const pathThatMatchesTestButNotLib of [
			// All of these are valid entries in "codeLens.path" that should match the main test file ("test/basic_test.dart") but not
			// the main lib file ("bin/main.dart").
			"test",
			"**/basic_test.dart",
			"**/*_test.dart",
			"**/**_test.dart",
			"**/**_test.*",
		]) {
			it(`with a path of "${pathThatMatchesTestButNotLib}" ${testConfig.expectMatch ? "matches" : "does not match"} "${vs.workspace.asRelativePath(testConfig.fileUri)}"`, async () => {
				await addLaunchConfigsForTest(
					vs.workspace.workspaceFolders![0].uri,
					[
						{
							codeLens: {
								for: ["run-file", "run-test-file"],
								path: pathThatMatchesTestButNotLib,
								title: "Run (terminal)",
							},
							console: "terminal",
							name: "Run in Terminal",
							request: "launch",
							type: "dart",
						},
					],
				);

				const editor = await openFile(testConfig.fileUri);
				await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(testConfig.fileUri));

				const fileCodeLens = await getCodeLens(editor.document);
				const mainFunctionPos = positionOf(testConfig.lensLocation);

				const codeLensForMainFunction = fileCodeLens.filter((cl) => cl.range.start.line === mainFunctionPos.line);
				const codeLensNames = codeLensForMainFunction.map((cl) => cl.command!.title);
				const expected = testConfig.expectMatch
					? ["Run", "Debug", "Run (terminal)"]
					: ["Run", "Debug"];
				assert.deepStrictEqual(codeLensNames, expected);
			});
		}
	}
});
