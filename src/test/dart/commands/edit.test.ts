import { strict as assert } from "assert";
import * as sinon from "sinon";
import * as vs from "vscode";
import { dartRecommendedConfig, openSettingsAction } from "../../../shared/constants";
import { fsPath } from "../../../shared/utils/fs";
import { activate, closeAllOpenFiles, currentEditor, defer, helloWorldMainFile, positionOf, rangeOf, sb, select, setTestContent, waitForResult } from "../../helpers";

describe("edit commands", () => {
	beforeEach("activate", () => activate());

	describe("writeRecommendedSettings", () => {
		beforeEach(async () => {
			const topLevelConfig = vs.workspace.getConfiguration("", null);
			const originalValue = topLevelConfig.inspect("[dart]")?.globalValue;
			defer("Restore global [dart] settings", () => topLevelConfig.update("[dart]", originalValue, vs.ConfigurationTarget.Global));
			await topLevelConfig.update("[dart]", undefined, vs.ConfigurationTarget.Global);
		});

		it("writes recommended settings, shows notification, and opens settings when clicked", async () => {
			const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(openSettingsAction as any);
			const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
			const openSettingsJson = executeCommand.withArgs("workbench.action.openSettingsJson", sinon.match.any).resolves();

			await vs.commands.executeCommand("dart.writeRecommendedSettings");

			const topLevelConfig = vs.workspace.getConfiguration("", null);
			assert.deepStrictEqual(topLevelConfig.inspect("[dart]")?.globalValue, dartRecommendedConfig);
			assert.ok(showInformationMessage.calledOnceWithExactly(
				"Recommended settings were written to the [dart] section of your global settings file",
				openSettingsAction,
			));
			assert.ok(openSettingsJson.calledOnceWithExactly(
				"workbench.action.openSettingsJson",
				{ revealSetting: { key: "[dart]" } },
			));
		});

		it("preserves existing global [dart] settings and does not open settings when dismissed", async () => {
			const topLevelConfig = vs.workspace.getConfiguration("", null);
			const existingSettings = {
				"editor.rulers": [100],
				"editor.wordWrap": "on",
			};
			await topLevelConfig.update("[dart]", existingSettings, vs.ConfigurationTarget.Global);

			const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);
			const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
			const openSettingsJson = executeCommand.withArgs("workbench.action.openSettingsJson", sinon.match.any).resolves();

			await vs.commands.executeCommand("dart.writeRecommendedSettings");

			const updatedConfig = vs.workspace.getConfiguration("", null);
			assert.deepStrictEqual(
				updatedConfig.inspect("[dart]")?.globalValue,
				Object.assign({}, dartRecommendedConfig, existingSettings),
			);
			assert.ok(showInformationMessage.calledOnce);
			assert.equal(openSettingsJson.called, false);
		});

		it("does not show notification when showNotification is false", async () => {
			const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);

			await vs.commands.executeCommand("dart.writeRecommendedSettings", { showNotification: false });

			const topLevelConfig = vs.workspace.getConfiguration("", null);
			assert.deepStrictEqual(topLevelConfig.inspect("[dart]")?.globalValue, dartRecommendedConfig);
			assert.equal(showInformationMessage.called, false);
		});
	});

	describe("printSelectionToTerminal", () => {
		it("writes selected text to a pseudo-terminal", async () => {
			await setTestContent("line 1\nline 2\nline 3");
			select(rangeOf("|line 1\nline 2|"));

			const written: string[] = [];
			let capturedPty: vs.Pseudoterminal | undefined;
			const origCreateTerminal = vs.window.createTerminal.bind(vs.window);
			const createTerminal = sb.stub(vs.window, "createTerminal").callsFake((options: vs.ExtensionTerminalOptions) => {
				capturedPty = options.pty;
				options.pty.onDidWrite((data) => written.push(data));
				const terminal = origCreateTerminal(options);
				defer("Dispose terminal", () => terminal.dispose());
				return terminal;
			});

			await vs.commands.executeCommand("dart.printSelectionToTerminal");
			await waitForResult(() => written.length > 0, "Terminal output was written");

			assert.ok(createTerminal.calledOnce);
			assert.equal((createTerminal.firstCall.args[0] as vs.ExtensionTerminalOptions).name, "Test Output");
			assert.deepStrictEqual(written, ["line 1\r\nline 2"]);
			capturedPty?.close();
		});

		it("does nothing when selection is empty", async () => {
			await setTestContent("line 1\nline 2");
			const pos = positionOf("^line 1");
			select(new vs.Range(pos, pos));

			const createTerminal = sb.spy(vs.window, "createTerminal");

			await vs.commands.executeCommand("dart.printSelectionToTerminal");

			assert.equal(createTerminal.called, false);
		});

		it("does nothing when there is no active editor", async () => {
			await closeAllOpenFiles();
			const createTerminal = sb.spy(vs.window, "createTerminal");

			await vs.commands.executeCommand("dart.printSelectionToTerminal");

			assert.equal(createTerminal.called, false);
		});
	});

	describe("jumpToLineColInUri", () => {
		it("ignores non-file URIs", async () => {
			const openTextDocument = sb.spy(vs.workspace, "openTextDocument");

			await vs.commands.executeCommand("_dart.jumpToLineColInUri", vs.Uri.parse("http://example.com/foo.dart"), 1, 1);
			await vs.commands.executeCommand("_dart.jumpToLineColInUri", undefined);

			assert.equal(openTextDocument.called, false);
		});

		it("opens document without moving cursor when lineNumber is omitted", async () => {
			await closeAllOpenFiles();

			await vs.commands.executeCommand("_dart.jumpToLineColInUri", helloWorldMainFile);

			const editor = currentEditor();
			assert.equal(fsPath(editor.document.uri), fsPath(helloWorldMainFile));
		});

		it("positions cursor at 1-based lineNumber and columnNumber", async () => {
			await vs.commands.executeCommand("_dart.jumpToLineColInUri", helloWorldMainFile, 5, 9);

			const editor = currentEditor();
			assert.equal(fsPath(editor.document.uri), fsPath(helloWorldMainFile));
			assert.equal(editor.selection.start.line, 4);
			assert.equal(editor.selection.start.character, 8);
			assert.equal(editor.selection.isEmpty, true);
		});

		it("falls back to firstNonWhitespaceCharacterIndex when columnNumber is omitted or past end of line", async () => {
			await vs.commands.executeCommand("_dart.jumpToLineColInUri", helloWorldMainFile, 25);
			assert.equal(currentEditor().selection.start.line, 24);
			assert.equal(currentEditor().selection.start.character, 4);

			select(new vs.Range(0, 0, 0, 0));
			await vs.commands.executeCommand("_dart.jumpToLineColInUri", helloWorldMainFile, 25, 999);
			assert.equal(currentEditor().selection.start.line, 24);
			assert.equal(currentEditor().selection.start.character, 4);
		});

		it("handles inOtherEditorColumn with and without an existing editor column", async () => {
			const showTextDocument = sb.spy(vs.window, "showTextDocument");

			await vs.commands.executeCommand("_dart.jumpToLineColInUri", helloWorldMainFile, 1, 1, true);
			assert.ok(showTextDocument.calledOnce);
			assert.equal(showTextDocument.firstCall.args[1], vs.ViewColumn.One);
			assert.equal(showTextDocument.firstCall.args[2], true);

			showTextDocument.resetHistory();
			await closeAllOpenFiles();

			await vs.commands.executeCommand("_dart.jumpToLineColInUri", helloWorldMainFile, 1, 1, true);
			assert.ok(showTextDocument.calledOnce);
			assert.equal(showTextDocument.firstCall.args[1], vs.ViewColumn.Beside);
			assert.equal(showTextDocument.firstCall.args[2], true);
		});
	});
});
