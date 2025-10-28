import { strict as assert } from "assert";
import * as vs from "vscode";
import { disposeAll } from "../../../shared/utils";
import { fsPath } from "../../../shared/utils/fs";
import { activate, addLaunchConfigsForTest, extApi, getCodeLens, getPackages, helloWorldFolder, helloWorldMainFile, helloWorldTestFolder, helloWorldTestMainFile, openFile, positionOf, privateApi, waitForResult } from "../../helpers";

describe("main_code_lens", () => {
	before("get packages", () => getPackages());
	beforeEach("activate", () => activate());

	it("includes run/debug actions for main function", async function () {
		const editor = await openFile(helloWorldMainFile);
		await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldMainFile));

		const fileCodeLens = await getCodeLens(editor.document);
		const targetPos = positionOf(`main^() async {`);

		const codeLensForTarget = fileCodeLens.filter((cl) => cl.range.start.line === targetPos.line);
		assert.equal(codeLensForTarget.length, 2);

		// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
		// race condition. Rather than failing our test runs, skip.
		// TODO: Remove this if https://github.com/microsoft/vscode/issues/79805 gets a reliable fix.
		if (!codeLensForTarget[0].command)
			this.skip();

		const runAction = codeLensForTarget.find((cl) => cl.command!.title === "Run")!;
		assert.equal(runAction.command!.command, "dart.startWithoutDebugging");
		assert.equal(fsPath(runAction.command!.arguments![0].resource as vs.Uri), fsPath(helloWorldMainFile));

		const debugAction = codeLensForTarget.find((cl) => cl.command!.title === "Debug");
		assert.equal(debugAction!.command!.command, "dart.startDebugging");
		assert.equal(fsPath(debugAction!.command!.arguments![0].resource as vs.Uri), fsPath(helloWorldMainFile));
	});

	it("uses default templates for run/debug actions for main function", async function () {
		const editor = await openFile(helloWorldMainFile);
		await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldMainFile));

		const fileCodeLens = await getCodeLens(editor.document);
		const targetPos = positionOf(`main^() async {`);

		const codeLensForTarget = fileCodeLens.filter((cl) => cl.range.start.line === targetPos.line);
		assert.equal(codeLensForTarget.length, 2);

		// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
		// race condition. Rather than failing our test runs, skip.
		// TODO: Remove this if https://github.com/microsoft/vscode/issues/79805 gets a reliable fix.
		if (!codeLensForTarget[0].command)
			this.skip();

		const runAction = codeLensForTarget.find((cl) => cl.command!.title === "Run")!;
		assert.equal(runAction.command!.arguments![0].launchTemplate.env.LAUNCH_ENV_VAR, "default");

		const debugAction = codeLensForTarget.find((cl) => cl.command!.title === "Debug")!;
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
								title: `${debugType.name} (terminal)`,
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
				const targetPos = positionOf(testConfig.lensLocation);

				const codeLensForTarget = fileCodeLens.filter((cl) => cl.range.start.line === targetPos.line);
				assert.equal(codeLensForTarget.length, 3);

				// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
				// race condition. Rather than failing our test runs, skip.
				// TODO: Remove this if https://github.com/microsoft/vscode/issues/79805 gets a reliable fix.
				if (!codeLensForTarget[0].command)
					this.skip();

				const action = codeLensForTarget.find((cl) => cl.command!.title === `${debugType.name} (terminal)`)!;
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
				const targetPos = positionOf(testConfig.lensLocation);

				const codeLensForTarget = fileCodeLens.filter((cl) => cl.range.start.line === targetPos.line);
				assert.equal(codeLensForTarget.length, 2);

				// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
				// race condition. Rather than failing our test runs, skip.
				// TODO: Remove this if https://github.com/microsoft/vscode/issues/79805 gets a reliable fix.
				if (!codeLensForTarget[0].command)
					this.skip();

				const action = codeLensForTarget.find((cl) => cl.command!.title === `${debugType.name}`)!;
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
				const targetPos = positionOf(testConfig.lensLocation);

				const codeLensForTarget = fileCodeLens.filter((cl) => cl.range.start.line === targetPos.line);
				const codeLensNames = codeLensForTarget.map((cl) => cl.command!.title);
				const expected = testConfig.expectMatch
					? ["Run", "Debug", "Run (terminal)"]
					: ["Run", "Debug"];
				assert.deepStrictEqual(codeLensNames, expected);
			});
		}
	}

	describe("suppression via API", () => {
		it("suppresses main code lenses for a project folder", async () => {
			const disposable = extApi.features.codeLens.suppress([helloWorldFolder], { main: true });

			try {
				const editor = await openFile(helloWorldMainFile);
				await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldMainFile));

				const fileCodeLens = await getCodeLens(editor.document);
				const targetPos = positionOf("main^() async {");

				const codeLensForTarget = fileCodeLens.filter((cl) => cl.range.start.line === targetPos.line);
				assert.equal(codeLensForTarget.length, 0);
			} finally {
				disposable.dispose();
			}
		});

		it("suppresses main code lenses but allows override for test folder", async () => {
			const disposables = [
				extApi.features.codeLens.suppress([helloWorldFolder], { main: true }),
				extApi.features.codeLens.suppress([helloWorldTestFolder], { main: false }),
			];

			try {
				// Test that main file is suppressed
				const mainEditor = await openFile(helloWorldMainFile);
				await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldMainFile));

				const mainCodeLens = await getCodeLens(mainEditor.document);
				const targetPos = positionOf("main^() async {");
				const mainLenses = mainCodeLens.filter((cl) => cl.range.start.line === targetPos.line);
				assert.equal(mainLenses.length, 0);

				// Test that test file is NOT suppressed.
				const testEditor = await openFile(helloWorldTestMainFile);
				await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldTestMainFile));

				const testCodeLens = await getCodeLens(testEditor.document);
				const testPos = positionOf("main^() {");
				const testLenses = testCodeLens.filter((cl) => cl.range.start.line === testPos.line);
				assert.equal(testLenses.length, 2);
			} finally {
				disposeAll(disposables);
			}
		});

		it("allows stacking multiple suppressions with latest match winning", async () => {
			const disposables = [
				extApi.features.codeLens.suppress([helloWorldFolder], { main: true }),
				extApi.features.codeLens.suppress([helloWorldFolder], { main: false }),
			];

			try {
				const editor = await openFile(helloWorldMainFile);
				await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldMainFile));

				const fileCodeLens = await getCodeLens(editor.document);
				const targetPos = positionOf("main^() async {");

				const codeLensForTarget = fileCodeLens.filter((cl) => cl.range.start.line === targetPos.line);
				assert.equal(codeLensForTarget.length, 2);
			} finally {
				disposeAll(disposables);
			}
		});

		it("removes suppression when disposed", async () => {
			const disposable = extApi.features.codeLens.suppress([helloWorldFolder], { main: true });

			// First verify suppression works
			let editor = await openFile(helloWorldMainFile);
			await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldMainFile));
			let fileCodeLens = await getCodeLens(editor.document);
			let targetPos = positionOf("main^() async {");
			let codeLensForTarget = fileCodeLens.filter((cl) => cl.range.start.line === targetPos.line);
			assert.equal(codeLensForTarget.length, 0);

			// Dispose and verify it's restored
			disposable.dispose();

			// Need to wait for the change event to propagate
			await new Promise((resolve) => setTimeout(resolve, 10));

			editor = await openFile(helloWorldMainFile);
			await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldMainFile));
			fileCodeLens = await getCodeLens(editor.document);
			targetPos = positionOf("main^() async {");
			codeLensForTarget = fileCodeLens.filter((cl) => cl.range.start.line === targetPos.line);
			assert.equal(codeLensForTarget.length, 2);
		});

		it("does not suppress when main option is undefined", async () => {
			const disposable = extApi.features.codeLens.suppress([helloWorldFolder], { test: true });

			try {
				const editor = await openFile(helloWorldMainFile);
				await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldMainFile));

				const fileCodeLens = await getCodeLens(editor.document);
				const targetPos = positionOf("main^() async {");

				const codeLensForTarget = fileCodeLens.filter((cl) => cl.range.start.line === targetPos.line);
				assert.equal(codeLensForTarget.length, 2);
			} finally {
				disposable.dispose();
			}
		});
	});
});
