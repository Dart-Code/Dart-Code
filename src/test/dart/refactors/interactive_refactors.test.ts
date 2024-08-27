import { strict as assert } from "assert";
import * as vs from "vscode";
import { isWin } from "../../../shared/constants";
import { InteractiveRefactors, SupportedParameterKind } from "../../../shared/vscode/interactive_refactors";
import { activate, emptyFile, extApi, helloWorldMainFile, sb } from "../../helpers";

describe("interactive refactors", () => {

	const testRefactorCommandName = "myRefactorCommand";

	beforeEach("activate", () => activate());
	beforeEach("check capabilities", function () {
		if (!extApi.isLsp)
			this.skip();
	});

	it("does not rewrite unrelated code actions", async () => {
		const refactors = extApi.interactiveRefactors!;

		const codeActionWithCommand = new vs.CodeAction("e");
		codeActionWithCommand.command = {
			// Deliberately looks like a new refactor, but is missing "data".
			arguments: [{
				arguments: ["aaa"],
			}],
			command: "eee",
			title: "ee",
		};
		const codeActions: Array<vs.Command | vs.CodeAction> = [
			{ title: "a", command: "aa" },
			{ title: "b", command: "bb", arguments: ["bbb"] },
			new vs.CodeAction("d"),
			new vs.CodeAction("d", vs.CodeActionKind.Refactor),
			codeActionWithCommand,
		];
		const originalJson = JSON.stringify(codeActions);
		refactors.rewriteCommands(codeActions);
		const newJson = JSON.stringify(codeActions);
		assert.equal(newJson, originalJson);
	});

	/// Rewrites and executes `codeAction` and returns arguments passed to the test refactor command.
	async function executeRefactor(refactors: InteractiveRefactors, codeAction: vs.CodeAction) {
		let capturedArgs: any;
		refactors.rewriteCommands([codeAction]);
		const commandSub = vs.commands.registerCommand(testRefactorCommandName, (args) => capturedArgs = args);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
		await vs.commands.executeCommand(codeAction.command!.command, ...codeAction.command!.arguments!);
		await commandSub.dispose();
		return capturedArgs;
	}


	/// Creates a test refactor with a single parameter with the supplier kind/defaultValue.
	function createTestRefactor(kind: string, defaultValue: unknown, additionalArgs: Record<string, unknown> = {}) {
		const refactorTitle = "My Interactive Refactor";
		const refactorArgs = {
			arguments: [defaultValue],
			...additionalArgs,
		};
		const refactorParams = [
			{
				defaultValue,
				kind,
				parameterLabel: "My Parameter",
			},
		];

		const codeAction = new vs.CodeAction(refactorTitle, vs.CodeActionKind.RefactorInline);
		codeAction.command = {
			arguments: [refactorArgs],
			command: testRefactorCommandName,
			title: codeAction.title,
		};
		(codeAction as any).data = {
			parameters: refactorParams,
		};
		return codeAction;
	}

	it("rewrites interactive refactor code actions", async () => {
		const refactors = extApi.interactiveRefactors!;
		const kind = "unknown_kind";
		const defaultValue = "aaa";

		const codeAction = createTestRefactor(kind, defaultValue, { myRefactorCustomArg: 1 });
		refactors.rewriteCommands([codeAction]);

		const rewrittenCommandName = codeAction.command!.command;
		const rewrittenArgments = codeAction.command!.arguments!;

		assert.equal(rewrittenCommandName, InteractiveRefactors.commandName);
		assert.equal(rewrittenArgments[0], testRefactorCommandName);
		assert.equal(rewrittenArgments[1][0].kind, kind);
		assert.equal(rewrittenArgments[1][0].defaultValue, defaultValue);
		assert.deepStrictEqual(rewrittenArgments[2].arguments, [defaultValue]);
	});

	it("runs using original values for unknown kinds", async () => {
		const refactors = extApi.interactiveRefactors!;
		const kind = "unknown_kind";
		const defaultValue = "aaa";

		const codeAction = createTestRefactor(kind, defaultValue);
		const capturedArgs = await executeRefactor(refactors, codeAction);

		assert.deepStrictEqual(capturedArgs.arguments[0], defaultValue);
	});

	it("handles 'saveUri' parameters", async () => {
		const refactors = extApi.interactiveRefactors!;
		const kind = SupportedParameterKind.saveUri;

		// Use emptyFile as the default.
		const defaultValue = emptyFile;

		// Provide mainFile to the prompt.
		const showSaveDialog = sb.stub(vs.window, "showSaveDialog");
		showSaveDialog.resolves(helloWorldMainFile);

		const codeAction = createTestRefactor(kind, defaultValue);
		const capturedArgs = await executeRefactor(refactors, codeAction);

		// Expect the captured args to contain the value we returned from showSaveDialog.
		assert.deepStrictEqual(capturedArgs.arguments[0], helloWorldMainFile.toString());
	});

	it("normalizes casing for 'saveUri' parameter responses", async function () {
		if (!isWin)
			this.skip();

		const refactors = extApi.interactiveRefactors!;
		const kind = SupportedParameterKind.saveUri;

		// Use emptyFile as the default.
		const defaultValue = emptyFile;

		// Provide mainFile to the prompt.
		const showSaveDialog = sb.stub(vs.window, "showSaveDialog");
		showSaveDialog.resolves(vs.Uri.file("c:\\foo\\bar"));

		const codeAction = createTestRefactor(kind, defaultValue);
		const capturedArgs = await executeRefactor(refactors, codeAction);

		// Expect the captured args to contain the value we returned from showSaveDialog.
		assert.deepStrictEqual(capturedArgs.arguments[0], "file:///C%3A/foo/bar");
	});
});

