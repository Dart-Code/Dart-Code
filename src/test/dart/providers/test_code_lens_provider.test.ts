import { strict as assert } from "assert";
import * as vs from "vscode";
import { disposeAll } from "../../../shared/utils";
import { activate, addLaunchConfigsForTest, extApi, getCodeLens, getPackages, helloWorldFolder, helloWorldTestFolder, helloWorldTestMainFile, openFile, positionOf, privateApi, waitForResult } from "../../helpers";

describe("test_code_lens", () => {
	before("get packages", () => getPackages());
	beforeEach("activate", () => activate());

	it("includes run/debug actions for tests", async function () {
		const editor = await openFile(helloWorldTestMainFile);
		await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldTestMainFile));

		const fileCodeLens = await getCodeLens(editor.document);
		const targetPos = positionOf(`test^(".split() splits`);

		const codeLensForTarget = fileCodeLens.filter((cl) => cl.range.start.line === targetPos.line);
		assert.equal(codeLensForTarget.length, 2);

		// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
		// race condition. Rather than failing our test runs, skip.
		// TODO: Remove this if https://github.com/microsoft/vscode/issues/79805 gets a reliable fix.
		if (!codeLensForTarget[0].command)
			this.skip();

		const runAction = codeLensForTarget.find((cl) => cl.command!.title === "Run")!;
		assert.equal(runAction.command!.command, "_dart.startWithoutDebuggingTestFromOutline");
		assert.equal(runAction.command!.arguments![0].fullName, "String .split() splits the string on the delimiter");
		assert.equal(runAction.command!.arguments![0].isGroup, false);

		const debugAction = codeLensForTarget.find((cl) => cl.command!.title === "Debug");
		assert.equal(debugAction!.command!.command, "_dart.startDebuggingTestFromOutline");
		assert.equal(debugAction!.command!.arguments![0].fullName, "String .split() splits the string on the delimiter");
		assert.equal(debugAction!.command!.arguments![0].isGroup, false);
	});

	it("includes run/debug actions for groups", async () => {
		const editor = await openFile(helloWorldTestMainFile);
		await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldTestMainFile));

		const fileCodeLens = await getCodeLens(editor.document);
		const groupPos = positionOf("group^(");

		const codeLensForGroup = fileCodeLens.filter((cl) => cl.range.start.line === groupPos.line);
		assert.equal(codeLensForGroup.length, 2);

		const runAction = codeLensForGroup.find((cl) => cl.command!.title === "Run");
		assert.equal(runAction!.command!.command, "_dart.startWithoutDebuggingTestFromOutline");
		assert.equal(runAction!.command!.arguments![0].fullName, "String");
		assert.equal(runAction!.command!.arguments![0].isGroup, true);

		const debugAction = codeLensForGroup.find((cl) => cl.command!.title === "Debug");
		assert.equal(debugAction!.command!.command, "_dart.startDebuggingTestFromOutline");
		assert.equal(debugAction!.command!.arguments![0].fullName, "String");
		assert.equal(debugAction!.command!.arguments![0].isGroup, true);
	});

	for (const debugType of [
		{ type: "run", name: "Run" },
		{ type: "debug", name: "Debug" },
	]) {
		const launchConfigs = [
			{
				codeLens: {
					for: [`${debugType.type}-test`],
					title: `${debugType.name} (browser)`,
				},
				env: { MY_VAR: "FOO" },
				name: "Run in Browser",
				request: "launch",
				type: "dart",
			},
		];
		it(`includes custom ${debugType.type} actions from launch templates for tests`, async function () {
			await addLaunchConfigsForTest(vs.workspace.workspaceFolders![0].uri, launchConfigs);

			const editor = await openFile(helloWorldTestMainFile);
			await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldTestMainFile));

			const fileCodeLens = await getCodeLens(editor.document);
			const targetPos = positionOf(`test^(".split() splits`);

			const codeLensForTarget = fileCodeLens.filter((cl) => cl.range.start.line === targetPos.line);
			assert.equal(codeLensForTarget.length, 3, `Didn't get 3 launch configs, got: ${JSON.stringify(codeLensForTarget, undefined, 4)}`);

			// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
			// race condition. Rather than failing our test runs, skip.
			// TODO: Remove this if https://github.com/microsoft/vscode/issues/79805 gets a reliable fix.
			if (!codeLensForTarget[0].command)
				this.skip();

			const action = codeLensForTarget.find((cl) => cl.command!.title === `${debugType.name} (browser)`);
			assert.equal(action!.command!.command, debugType.type === "debug" ? "_dart.startDebuggingTestFromOutline" : "_dart.startWithoutDebuggingTestFromOutline");
			assert.equal(action!.command!.arguments![0].fullName, "String .split() splits the string on the delimiter");
			assert.equal(action!.command!.arguments![0].isGroup, false);
			assert.deepStrictEqual(action!.command!.arguments![1].env, { MY_VAR: "FOO" });
		});

		it(`includes custom ${debugType.type} actions from launch templates for groups`, async function () {
			await addLaunchConfigsForTest(vs.workspace.workspaceFolders![0].uri, launchConfigs);

			const editor = await openFile(helloWorldTestMainFile);
			await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldTestMainFile));

			const fileCodeLens = await getCodeLens(editor.document);
			const groupPos = positionOf("group^(");

			const codeLensForGroup = fileCodeLens.filter((cl) => cl.range.start.line === groupPos.line);
			assert.equal(codeLensForGroup.length, 3);

			// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
			// race condition. Rather than failing our test runs, skip.
			// TODO: Remove this if https://github.com/microsoft/vscode/issues/79805 gets a reliable fix.
			if (!codeLensForGroup[0].command)
				this.skip();

			const action = codeLensForGroup.find((cl) => cl.command!.title === `${debugType.name} (browser)`);
			assert.equal(action!.command!.command, debugType.type === "debug" ? "_dart.startDebuggingTestFromOutline" : "_dart.startWithoutDebuggingTestFromOutline");
			assert.equal(action!.command!.arguments![0].fullName, "String");
			assert.equal(action!.command!.arguments![0].isGroup, true);
			assert.deepStrictEqual(action!.command!.arguments![1].env, { MY_VAR: "FOO" });
		});
	}

	describe("suppression via API", () => {
		it("suppresses test code lenses for a project folder", async () => {
			const disposable = extApi.features.codeLens.suppress([helloWorldFolder], { test: true });

			try {
				const editor = await openFile(helloWorldTestMainFile);
				await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldTestMainFile));

				const fileCodeLens = await getCodeLens(editor.document);
				const targetPos = positionOf(`test^(".split() splits`);

				const codeLensForTarget = fileCodeLens.filter((cl) => cl.range.start.line === targetPos.line);
				assert.equal(codeLensForTarget.length, 0);
			} finally {
				disposable.dispose();
			}
		});

		it("suppresses test code lenses but allows override for specific folders", async () => {
			const disposables = [
				extApi.features.codeLens.suppress([helloWorldFolder], { main: true }),
				extApi.features.codeLens.suppress([helloWorldTestFolder], { main: false }),
			];

			try {
				// Test that test file is NOT suppressed.
				const testEditor = await openFile(helloWorldTestMainFile);
				await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldTestMainFile));

				const testCodeLens = await getCodeLens(testEditor.document);
				const targetPos = positionOf(`test^(".split() splits`);
				const testLenses = testCodeLens.filter((cl) => cl.range.start.line === targetPos.line);
				assert.equal(testLenses.length, 2);
			} finally {
				disposeAll(disposables);
			}
		});

		it("allows stacking multiple suppressions with latest match winning", async () => {
			const disposables = [
				extApi.features.codeLens.suppress([helloWorldFolder], { test: true }),
				extApi.features.codeLens.suppress([helloWorldFolder], { test: false }),
			];

			try {
				const editor = await openFile(helloWorldTestMainFile);
				await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldTestMainFile));

				const fileCodeLens = await getCodeLens(editor.document);
				const targetPos = positionOf(`test^(".split() splits`);

				const codeLensForTarget = fileCodeLens.filter((cl) => cl.range.start.line === targetPos.line);
				assert.equal(codeLensForTarget.length, 2);
			} finally {
				disposeAll(disposables);
			}
		});

		it("removes suppression when disposed", async () => {
			const disposable = extApi.features.codeLens.suppress([helloWorldFolder], { test: true });

			// First verify suppression works
			let editor = await openFile(helloWorldTestMainFile);
			await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldTestMainFile));
			let fileCodeLens = await getCodeLens(editor.document);
			let targetPos = positionOf(`test^(".split() splits`);
			let codeLensForTarget = fileCodeLens.filter((cl) => cl.range.start.line === targetPos.line);
			assert.equal(codeLensForTarget.length, 0);

			// Dispose and verify it's restored
			disposable.dispose();

			// Need to wait for the change event to propagate
			await new Promise((resolve) => setTimeout(resolve, 10));

			editor = await openFile(helloWorldTestMainFile);
			await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldTestMainFile));
			fileCodeLens = await getCodeLens(editor.document);
			targetPos = positionOf(`test^(".split() splits`);
			codeLensForTarget = fileCodeLens.filter((cl) => cl.range.start.line === targetPos.line);
			assert.equal(codeLensForTarget.length, 2);
		});

		it("does not suppress when test option is undefined", async () => {
			const disposable = extApi.features.codeLens.suppress([helloWorldFolder], { main: true });

			try {
				const editor = await openFile(helloWorldTestMainFile);
				await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldTestMainFile));

				const fileCodeLens = await getCodeLens(editor.document);
				const targetPos = positionOf(`test^(".split() splits`);

				const codeLensForTarget = fileCodeLens.filter((cl) => cl.range.start.line === targetPos.line);
				assert.equal(codeLensForTarget.length, 2);
			} finally {
				disposable.dispose();
			}
		});

		it("suppresses both tests and groups when test is suppressed", async () => {
			const disposable = extApi.features.codeLens.suppress([helloWorldFolder], { test: true });

			try {
				const editor = await openFile(helloWorldTestMainFile);
				await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldTestMainFile));

				const fileCodeLens = await getCodeLens(editor.document);

				// Check test
				const targetPos = positionOf(`test^(".split() splits`);
				const codeLensForTarget = fileCodeLens.filter((cl) => cl.range.start.line === targetPos.line);
				assert.equal(codeLensForTarget.length, 0);

				// Check group
				const groupPos = positionOf("group^(");
				const codeLensForGroup = fileCodeLens.filter((cl) => cl.range.start.line === groupPos.line);
				assert.equal(codeLensForGroup.length, 0);
			} finally {
				disposable.dispose();
			}
		});
	});
});
