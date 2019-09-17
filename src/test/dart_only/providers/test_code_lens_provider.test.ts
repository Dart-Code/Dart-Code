import * as assert from "assert";
import * as vs from "vscode";
import { activate, addLaunchConfigsForTest, extApi, getCodeLens, getPackages, helloWorldTestMainFile, openFile, positionOf, waitForResult } from "../../helpers";

describe("test_code_lens", () => {
	before("get packages", () => getPackages());
	beforeEach("activate", () => activate());

	it("includes run/debug actions for tests", async () => {
		const editor = await openFile(helloWorldTestMainFile);
		await waitForResult(() => !!extApi.fileTracker.getOutlineFor(helloWorldTestMainFile));

		const fileCodeLens = await getCodeLens(editor.document);
		const testPos = positionOf(`test^(".split() splits`);

		const codeLensForTest = fileCodeLens.filter((cl) => cl.range.start.line === testPos.line);
		assert.equal(codeLensForTest.length, 2);

		const runAction = codeLensForTest.find((cl) => cl.command!.title === "Run")!;
		assert.equal(runAction!.command!.command, "_dart.startWithoutDebuggingTestFromOutline");
		assert.equal(runAction!.command!.arguments![0].fullName, "String .split() splits the string on the delimiter");
		assert.equal(runAction!.command!.arguments![0].isGroup, false);

		const debugAction = codeLensForTest.find((cl) => cl.command!.title === "Debug");
		assert.equal(debugAction!.command!.command, "_dart.startDebuggingTestFromOutline");
		assert.equal(debugAction!.command!.arguments![0].fullName, "String .split() splits the string on the delimiter");
		assert.equal(debugAction!.command!.arguments![0].isGroup, false);
	});

	it("includes run/debug actions for groups", async () => {
		const editor = await openFile(helloWorldTestMainFile);
		await waitForResult(() => !!extApi.fileTracker.getOutlineFor(helloWorldTestMainFile));

		const fileCodeLens = await getCodeLens(editor.document);
		const groupPos = positionOf("group^(");

		const codeLensForGroup = fileCodeLens.filter((cl) => cl.range.contains(groupPos));
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

	it("includes custom run/debug actions from launch templates for tests", async () => {
		await addLaunchConfigsForTest(
			vs.workspace.workspaceFolders![0].uri,
			[
				{
					env: { MY_VAR: "FOO" },
					name: "Run in Browser",
					request: "launch",
					template: "run-test",
					type: "dart",
				},
				{
					env: { MY_VAR: "BAR" },
					name: "Debug in Browser",
					request: "launch",
					template: "debug-test",
					type: "dart",
				},
			],
		);

		const editor = await openFile(helloWorldTestMainFile);
		await waitForResult(() => !!extApi.fileTracker.getOutlineFor(helloWorldTestMainFile));

		const fileCodeLens = await getCodeLens(editor.document);
		const testPos = positionOf(`test^(".split() splits`);

		const codeLensForTest = fileCodeLens.filter((cl) => cl.range.start.line === testPos.line);
		assert.equal(codeLensForTest.length, 4);

		const runAction = codeLensForTest.find((cl) => cl.command!.title === "Run in Browser");
		assert.equal(runAction!.command!.command, "_dart.startWithoutDebuggingTestFromOutline");
		assert.equal(runAction!.command!.arguments![0].fullName, "String .split() splits the string on the delimiter");
		assert.equal(runAction!.command!.arguments![0].isGroup, false);
		assert.deepStrictEqual(runAction!.command!.arguments![1].env, { MY_VAR: "FOO" });

		const debugAction = codeLensForTest.find((cl) => cl.command!.title === "Debug in Browser");
		assert.equal(debugAction!.command!.command, "_dart.startDebuggingTestFromOutline");
		assert.equal(debugAction!.command!.arguments![0].fullName, "String .split() splits the string on the delimiter");
		assert.equal(debugAction!.command!.arguments![0].isGroup, false);
		assert.deepStrictEqual(debugAction!.command!.arguments![1].env, { MY_VAR: "BAR" });
	});

	it("includes custom run/debug actions from launch templates for groups", async () => {
		await addLaunchConfigsForTest(
			vs.workspace.workspaceFolders![0].uri,
			[
				{
					env: { MY_VAR: "FOO" },
					name: "Run in Browser",
					request: "launch",
					template: "run-test",
					type: "dart",
				},
				{
					env: { MY_VAR: "BAR" },
					name: "Debug in Browser",
					request: "launch",
					template: "debug-test",
					type: "dart",
				},
			],
		);

		const editor = await openFile(helloWorldTestMainFile);
		await waitForResult(() => !!extApi.fileTracker.getOutlineFor(helloWorldTestMainFile));

		const fileCodeLens = await getCodeLens(editor.document);
		const groupPos = positionOf("group^(");

		const codeLensForGroup = fileCodeLens.filter((cl) => cl.range.contains(groupPos));
		assert.equal(codeLensForGroup.length, 4);

		const runAction = codeLensForGroup.find((cl) => cl.command!.title === "Run in Browser");
		assert.equal(runAction!.command!.command, "_dart.startWithoutDebuggingTestFromOutline");
		assert.equal(runAction!.command!.arguments![0].fullName, "String");
		assert.equal(runAction!.command!.arguments![0].isGroup, true);
		assert.deepStrictEqual(runAction!.command!.arguments![1].env, { MY_VAR: "FOO" });

		const debugAction = codeLensForGroup.find((cl) => cl.command!.title === "Debug in Browser");
		assert.equal(debugAction!.command!.command, "_dart.startDebuggingTestFromOutline");
		assert.equal(debugAction!.command!.arguments![0].fullName, "String");
		assert.equal(debugAction!.command!.arguments![0].isGroup, true);
		assert.deepStrictEqual(debugAction!.command!.arguments![1].env, { MY_VAR: "BAR" });
	});
});
