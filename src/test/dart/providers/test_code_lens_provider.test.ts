import { strict as assert } from "assert";
import * as vs from "vscode";
import { activate, addLaunchConfigsForTest, getCodeLens, getPackages, helloWorldTestMainFile, openFile, positionOf, privateApi, waitForResult } from "../../helpers";

describe("test_code_lens", () => {
	before("get packages", () => getPackages());
	beforeEach("activate", () => activate());

	it("includes run/debug actions for tests", async function () {
		const editor = await openFile(helloWorldTestMainFile);
		await waitForResult(() => !!privateApi.fileTracker.getOutlineFor(helloWorldTestMainFile));

		const fileCodeLens = await getCodeLens(editor.document);
		const testPos = positionOf(`test^(".split() splits`);

		const codeLensForTest = fileCodeLens.filter((cl) => cl.range.start.line === testPos.line);
		assert.equal(codeLensForTest.length, 2);

		// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
		// race condition. Rather than failing our test runs, skip.
		// TODO: Remove this if https://github.com/microsoft/vscode/issues/79805 gets a reliable fix.
		if (!codeLensForTest[0].command)
			this.skip();

		const runAction = codeLensForTest.find((cl) => cl.command!.title === "Run")!;
		assert.equal(runAction.command!.command, "_dart.startWithoutDebuggingTestFromOutline");
		assert.equal(runAction.command!.arguments![0].fullName, "String .split() splits the string on the delimiter");
		assert.equal(runAction.command!.arguments![0].isGroup, false);

		const debugAction = codeLensForTest.find((cl) => cl.command!.title === "Debug");
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
					title: "${debugType} (browser)",
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
			const testPos = positionOf(`test^(".split() splits`);

			const codeLensForTest = fileCodeLens.filter((cl) => cl.range.start.line === testPos.line);
			assert.equal(codeLensForTest.length, 3, `Didn't get 3 launch configs, got: ${JSON.stringify(codeLensForTest, undefined, 4)}`);

			// If there's no command, skip the test. This happens very infrequently and appears to be a VS Code
			// race condition. Rather than failing our test runs, skip.
			// TODO: Remove this if https://github.com/microsoft/vscode/issues/79805 gets a reliable fix.
			if (!codeLensForTest[0].command)
				this.skip();

			const action = codeLensForTest.find((cl) => cl.command!.title === `${debugType.name} (browser)`);
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
});
