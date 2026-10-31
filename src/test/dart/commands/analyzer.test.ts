import { strict as assert } from "assert";
import * as os from "os";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import * as ls from "vscode-languageclient";
import { AugmentationRequest, AugmentedRequest, DiagnosticServerRequest, ImportsRequest, OpenUriNotification, ReanalyzeRequest, SuperRequest } from "../../../shared/analysis/lsp/custom_protocol";
import { SpawnedProcess } from "../../../shared/interfaces";
import { DartToolingDaemon } from "../../../shared/services/tooling_daemon";
import { fsPath } from "../../../shared/utils/fs";
import { activate, fakeCancellationToken, helloWorldFolder, helloWorldMainFile, privateApi, sb, setConfigForTest } from "../../helpers";

describe("toggle show TODOs", () => {
	const settingName = "showTodos";
	let config: vs.WorkspaceConfiguration;

	function refresh(): void {
		config = vs.workspace.getConfiguration("dart");
	}

	beforeEach(async () => {
		await activate(helloWorldMainFile);
		refresh();
		// Clear overrides to start from a clean state.
		await config.update(settingName, undefined, vs.ConfigurationTarget.Global);
		await config.update(settingName, undefined, vs.ConfigurationTarget.Workspace);
		refresh();
	});

	// (multi-root) Workspaces are tested in the 'multi_root' tests. This test project is a single folder.

	it("toggles in User settings when not defined anywhere", async () => {
		// Default is true.
		refresh();
		assert.strictEqual(config.get(settingName), true);

		await vs.commands.executeCommand("dart.toggleShowTodos");
		refresh();
		assert.strictEqual(config.get(settingName), false);
		assert.strictEqual(config.inspect(settingName)?.globalValue, false);
		assert.strictEqual(config.inspect(settingName)?.workspaceValue, undefined);

		await vs.commands.executeCommand("dart.toggleShowTodos");
		refresh();
		assert.strictEqual(config.get(settingName), true);
		assert.strictEqual(config.inspect(settingName)?.globalValue, true);
		assert.strictEqual(config.inspect(settingName)?.workspaceValue, undefined);
	});

	it("toggles in User settings when defined in User settings", async () => {
		await config.update(settingName, false, vs.ConfigurationTarget.Global);
		refresh();
		assert.strictEqual(config.get(settingName), false);

		await vs.commands.executeCommand("dart.toggleShowTodos");
		refresh();
		assert.strictEqual(config.get(settingName), true);
		assert.strictEqual(config.inspect(settingName)?.globalValue, true);
		assert.strictEqual(config.inspect(settingName)?.workspaceValue, undefined);
		assert.strictEqual(config.inspect(settingName)?.workspaceFolderValue, undefined);

		await vs.commands.executeCommand("dart.toggleShowTodos");
		refresh();
		assert.strictEqual(config.get(settingName), false);
		assert.strictEqual(config.inspect(settingName)?.globalValue, false);
		assert.strictEqual(config.inspect(settingName)?.workspaceValue, undefined);
		assert.strictEqual(config.inspect(settingName)?.workspaceFolderValue, undefined);
	});

	it("toggles in User settings when defined in User settings as an array", async () => {
		await config.update(settingName, ["TODO", "HACK"], vs.ConfigurationTarget.Global);
		refresh();
		assert.deepStrictEqual(config.get(settingName), ["TODO", "HACK"]);

		await vs.commands.executeCommand("dart.toggleShowTodos");
		refresh();
		assert.strictEqual(config.get(settingName), false);
		assert.strictEqual(config.inspect(settingName)?.globalValue, false);
		assert.strictEqual(config.inspect(settingName)?.workspaceValue, undefined);
		assert.strictEqual(config.inspect(settingName)?.workspaceFolderValue, undefined);

		await vs.commands.executeCommand("dart.toggleShowTodos");
		refresh();
		assert.strictEqual(config.get(settingName), true);
		assert.strictEqual(config.inspect(settingName)?.globalValue, true);
		assert.strictEqual(config.inspect(settingName)?.workspaceValue, undefined);
		assert.strictEqual(config.inspect(settingName)?.workspaceFolderValue, undefined);
	});

	it("toggles in Workspace (Folder) settings when defined in Workspace (Folder) settings (single-root workspace)", async () => {
		await config.update(settingName, false, vs.ConfigurationTarget.Workspace);
		refresh();
		assert.strictEqual(config.get(settingName), false);

		await vs.commands.executeCommand("dart.toggleShowTodos");
		refresh();
		assert.strictEqual(config.get(settingName), true);
		assert.strictEqual(config.inspect(settingName)?.globalValue, undefined);
		assert.strictEqual(config.inspect(settingName)?.workspaceValue, true);

		await vs.commands.executeCommand("dart.toggleShowTodos");
		refresh();
		assert.strictEqual(config.get(settingName), false);
		assert.strictEqual(config.inspect(settingName)?.globalValue, undefined);
		assert.strictEqual(config.inspect(settingName)?.workspaceValue, false);
	});
});

describe("analyzer", () => {
	beforeEach("activate", () => activate(helloWorldMainFile));

	describe("OpenUriNotification", () => {
		function getOpenUriHandler(): (params: { uri: string }) => void {
			const client = privateApi.analyzer.client;
			return (client as any)._notificationHandlers.get(OpenUriNotification.type.method) as (params: { uri: string }) => void; // eslint-disable-line no-underscore-dangle
		}

		it("opens file: URIs using showTextDocument", () => {
			const showTextDocument = sb.stub(vs.window, "showTextDocument").resolves();
			const handler = getOpenUriHandler();

			handler({ uri: helloWorldMainFile.toString() });

			assert.ok(showTextDocument.calledOnce);
			assert.equal(showTextDocument.firstCall.args[0].toString(), helloWorldMainFile.toString());
		});

		it("opens http: and https: URIs using envUtils.openInBrowser", () => {
			const openInBrowser = sb.stub(privateApi.envUtils, "openInBrowser").resolves(true);
			const handler = getOpenUriHandler();

			handler({ uri: "http://example.com/foo" });
			handler({ uri: "https://example.com/bar" });

			assert.ok(openInBrowser.calledTwice);
			assert.equal(openInBrowser.firstCall.args[0], "http://example.com/foo");
			assert.equal(openInBrowser.secondCall.args[0], "https://example.com/bar");
		});

		it("logs an error for unknown URI schemes", () => {
			const loggerError = sb.stub(privateApi.logger, "error");
			const handler = getOpenUriHandler();

			handler({ uri: "ftp://example.com/file" });

			assert.ok(loggerError.calledOnce);
			assert.ok(loggerError.firstCall.args[0].includes("Unable to open URI ftp://example.com/file as requested by LSP server. Unknown scheme."));
		});
	});

	describe("middleware", () => {
		function getMiddleware(): ls.Middleware {
			return privateApi.analyzer.client.clientOptions.middleware!;
		}

		it("cleans doc strings in resolveCompletionItem with string documentation", async () => {
			const middleware = getMiddleware();
			const itemString = new vs.CompletionItem("test1");
			itemString.documentation = "Doc 1\n{@template foo}\nTemplate body\n{@endtemplate}";

			const resolvedString = await middleware.resolveCompletionItem!(itemString, fakeCancellationToken, async (i: vs.CompletionItem) => i);
			assert.equal(resolvedString?.documentation, "Doc 1\nTemplate body");
		});

		it("cleans doc strings in resolveCompletionItem with MarkdownString documentation", async () => {
			const middleware = getMiddleware();
			const itemMd = new vs.CompletionItem("test2");
			itemMd.documentation = new vs.MarkdownString("Doc 2\n{@template bar}\nMarkdown body\n{@endtemplate}");

			const resolvedMd = await middleware.resolveCompletionItem!(itemMd, fakeCancellationToken, async (i: vs.CompletionItem) => i);
			assert.ok(resolvedMd?.documentation instanceof vs.MarkdownString);
			assert.equal((resolvedMd.documentation).value, "Doc 2\nMarkdown body");
		});

		it("preserves undefined documentation in resolveCompletionItem", async () => {
			const middleware = getMiddleware();
			const itemNoDoc = new vs.CompletionItem("test3");

			const resolvedNoDoc = await middleware.resolveCompletionItem!(itemNoDoc, fakeCancellationToken, async (i: vs.CompletionItem) => i);
			assert.equal(resolvedNoDoc?.documentation, undefined);
		});

		it("cleans doc strings in provideHover", async () => {
			const middleware = getMiddleware();
			const doc = await vs.workspace.openTextDocument(helloWorldMainFile);
			const pos = new vs.Position(0, 0);
			const unknownObj = { other: 123 } as unknown as vs.MarkedString;
			const hoverResult = await middleware.provideHover!(doc, pos, fakeCancellationToken, async () => ({
				contents: [
					"Hover string\n{@template s}\nS\n{@endtemplate}",
					new vs.MarkdownString("Hover md\n{@template m}\nM\n{@endtemplate}"),
					{ language: "dart", value: "void f() {}\n{@template l}\nL\n{@endtemplate}" },
					unknownObj,
				],
			}));

			assert.ok(hoverResult);
			assert.equal(hoverResult.contents[0], "Hover string\nS");
			assert.ok(hoverResult.contents[1] instanceof vs.MarkdownString);
			assert.equal((hoverResult.contents[1]).value, "Hover md\nM");
			assert.deepEqual(hoverResult.contents[2], { language: "dart", value: "void f() {}\nL" });
			assert.strictEqual(hoverResult.contents[3], unknownObj);
		});

		it("returns null in provideHover when underlying hover is null", async () => {
			const middleware = getMiddleware();
			const doc = await vs.workspace.openTextDocument(helloWorldMainFile);
			const pos = new vs.Position(0, 0);

			const nullHover = await middleware.provideHover!(doc, pos, fakeCancellationToken, async () => null);
			assert.equal(nullHover, null);
		});

		it("returns undefined in provideCompletionItem when underlying result is null", async () => {
			const middleware = getMiddleware();
			const doc = await vs.workspace.openTextDocument(helloWorldMainFile);
			const pos = new vs.Position(0, 0);
			const context: vs.CompletionContext = { triggerKind: vs.CompletionTriggerKind.Invoke, triggerCharacter: undefined };

			const nullRes = await middleware.provideCompletionItem!(doc, pos, context, fakeCancellationToken, async () => null);
			assert.equal(nullRes, undefined);
		});

		it("returns undefined in provideCompletionItem when cancelled with an empty incomplete list", async () => {
			const middleware = getMiddleware();
			const doc = await vs.workspace.openTextDocument(helloWorldMainFile);
			const pos = new vs.Position(0, 0);
			const context: vs.CompletionContext = { triggerKind: vs.CompletionTriggerKind.Invoke, triggerCharacter: undefined };
			const cancelledToken: vs.CancellationToken = {
				isCancellationRequested: true,
				onCancellationRequested: () => ({ dispose: () => undefined }),
			};

			const emptyListRes = await middleware.provideCompletionItem!(doc, pos, context, cancelledToken, async () => new vs.CompletionList([], true));
			assert.equal(emptyListRes, undefined);
		});

		it("attaches triggerSuggest command to completion items that require re-triggering", async () => {
			const middleware = getMiddleware();
			const doc = await vs.workspace.openTextDocument(helloWorldMainFile);
			const pos = new vs.Position(0, 0);
			const context: vs.CompletionContext = { triggerKind: vs.CompletionTriggerKind.Invoke, triggerCharacter: undefined };

			const importItem = new vs.CompletionItem("import '';");
			const namedArgItem = new vs.CompletionItem({ label: "namedArg: " });
			const folderWithSlash = new vs.CompletionItem("sub/", vs.CompletionItemKind.Folder);
			const folderLabelObjWithSlash = new vs.CompletionItem({ label: "sub2/" }, vs.CompletionItemKind.Folder);
			const folderWithoutSlash = new vs.CompletionItem("sub_no_slash", vs.CompletionItemKind.Folder);
			const plainItem = new vs.CompletionItem("plain");

			const list = {
				isIncomplete: undefined,
				items: [
					importItem,
					namedArgItem,
					folderWithSlash,
					folderLabelObjWithSlash,
					folderWithoutSlash,
					plainItem,
				],
			} as vs.CompletionList;

			await middleware.provideCompletionItem!(doc, pos, context, fakeCancellationToken, async () => list);

			assert.equal(importItem.command?.command, "editor.action.triggerSuggest");
			assert.equal(namedArgItem.command?.command, "editor.action.triggerSuggest");
			assert.equal(folderWithSlash.command?.command, "editor.action.triggerSuggest");
			assert.equal(folderLabelObjWithSlash.command?.command, "editor.action.triggerSuggest");
			assert.equal(folderWithoutSlash.command, undefined);
			assert.equal(plainItem.command, undefined);
		});

		it("attaches triggerParameterHints command to completion items with parameter placeholders when enabled", async () => {
			await setConfigForTest("editor", "parameterHints.enabled", true);
			const middleware = getMiddleware();
			const doc = await vs.workspace.openTextDocument(helloWorldMainFile);
			const pos = new vs.Position(0, 0);
			const context: vs.CompletionContext = { triggerKind: vs.CompletionTriggerKind.Invoke, triggerCharacter: undefined };

			const sigHelpStringItem = new vs.CompletionItem("fn1");
			sigHelpStringItem.insertText = "fn1(${1:a})";
			const sigHelpSnippetItem = new vs.CompletionItem("fn2");
			sigHelpSnippetItem.insertText = new vs.SnippetString("fn2($0)");
			const sigHelpLabelFallbackItem = new vs.CompletionItem({ label: "fn3(${1:b})" });
			const plainItem = new vs.CompletionItem("plain");

			const list = new vs.CompletionList([
				sigHelpStringItem,
				sigHelpSnippetItem,
				sigHelpLabelFallbackItem,
				plainItem,
			]);

			await middleware.provideCompletionItem!(doc, pos, context, fakeCancellationToken, async () => list);

			assert.equal(sigHelpStringItem.command?.command, "editor.action.triggerParameterHints");
			assert.equal(sigHelpSnippetItem.command?.command, "editor.action.triggerParameterHints");
			assert.equal(sigHelpLabelFallbackItem.command?.command, "editor.action.triggerParameterHints");
			assert.equal(plainItem.command, undefined);
		});

		it("handles array results in provideCompletionItem", async () => {
			const middleware = getMiddleware();
			const doc = await vs.workspace.openTextDocument(helloWorldMainFile);
			const context: vs.CompletionContext = { triggerKind: vs.CompletionTriggerKind.Invoke, triggerCharacter: undefined };

			const arrayItems = [new vs.CompletionItem("import '';")];
			const arrayRes = await middleware.provideCompletionItem!(doc, new vs.Position(1, 2), context, fakeCancellationToken, async () => arrayItems);
			assert.strictEqual(arrayRes, arrayItems);
			assert.equal(arrayItems[0].command?.command, "editor.action.triggerSuggest");
		});

		it("appends case-only rename hint for file_names diagnostic in handleDiagnostics", () => {
			const middleware = getMiddleware();
			const range = new vs.Range(new vs.Position(0, 0), new vs.Position(0, 5));
			const fileNamesDiag = new vs.Diagnostic(range, "Bad file name.");
			fileNamesDiag.code = "file_names";
			const otherDiag = new vs.Diagnostic(range, "Other error.");
			otherDiag.code = "unused_local_variable";

			let passedDiagnostics: vs.Diagnostic[] | undefined;
			middleware.handleDiagnostics!(helloWorldMainFile, [fileNamesDiag, otherDiag], (_uri: vs.Uri, diags: vs.Diagnostic[]) => {
				passedDiagnostics = diags;
			});

			assert.equal(
				fileNamesDiag.message,
				"Bad file name.\nYou may need to close the file and restart VS Code after renaming a file by only casing.",
			);
			assert.equal(otherDiag.message, "Other error.");
			assert.deepEqual(passedDiagnostics, [fileNamesDiag, otherDiag]);
		});

		it("injects default dart configuration values in workspace.configuration middleware", async () => {
			// Our custom `workspace.configuration` middleware in `analyzer.ts` intercepts `workspace/configuration`
			// requests from the LSP server and mutates any requested `"dart"` configuration sections to:
			//   1. Override `enableSnippets` with `config.enableServerSnippets`.
			//   2. Supply default values for `maxCompletionItems` and `documentation` if not explicitly configured.
			//   3. Leave non-`"dart"` configuration sections (such as `"editor"`) unmodified.
			const middleware = getMiddleware();
			const params: ls.ConfigurationParams = {
				items: [
					{ section: "dart" },
					{ section: "dart" },
					{ section: "editor" },
				],
			};

			const results = await middleware.workspace!.configuration!(
				params,
				fakeCancellationToken,
				async () => [
					// 1. A `"dart"` section where `maxCompletionItems` and `documentation` are not set by the user.
					{},
					// 2. A `"dart"` section where `maxCompletionItems` and `documentation` are explicitly set by the user.
					{ maxCompletionItems: 50, documentation: "summary" },
					// 3. A non-`"dart"` section that should be returned untouched.
					{ formatOnSave: true },
				],
			);

			assert.ok(Array.isArray(results));
			assert.equal(results[0].maxCompletionItems, 100000);
			assert.equal(results[0].documentation, "full");
			assert.equal(typeof results[0].enableSnippets, "boolean");

			assert.equal(results[1].maxCompletionItems, 50);
			assert.equal(results[1].documentation, "summary");
			assert.equal(typeof results[1].enableSnippets, "boolean");

			assert.deepEqual(results[2], { formatOnSave: true });
		});
	});

	describe("custom LSP requests", () => {
		it("getDiagnosticServerPort returns the server port", async () => {
			const sendRequest = sb.stub(privateApi.analyzer.client, "sendRequest");
			sendRequest.withArgs(DiagnosticServerRequest.type, sinon.match.any).resolves({ port: 12345 });

			const portRes = await privateApi.analyzer.getDiagnosticServerPort();
			assert.deepEqual(portRes, { port: 12345 });
		});

		it("getDiagnosticServerPort returns undefined when cancelled", async () => {
			const sendRequest = sb.stub(privateApi.analyzer.client, "sendRequest");
			sendRequest.withArgs(DiagnosticServerRequest.type, sinon.match.any).callsFake(async (_type: any, token: vs.CancellationToken) => {
				if (typeof (token as any).cancel === "function")
					(token as any).cancel();
				else
					Object.defineProperty(token, "isCancellationRequested", { value: true });
				throw new Error("Request cancelled");
			});

			const cancelledRes = await privateApi.analyzer.getDiagnosticServerPort();
			assert.equal(cancelledRes, undefined);
		});

		it("getDiagnosticServerPort rethrows non-cancellation errors", async () => {
			const sendRequest = sb.stub(privateApi.analyzer.client, "sendRequest");
			sendRequest.withArgs(DiagnosticServerRequest.type, sinon.match.any).rejects(new Error("Server error"));

			await assert.rejects(() => privateApi.analyzer.getDiagnosticServerPort(), /Server error/);
		});

		it("forceReanalyze sends ReanalyzeRequest", async () => {
			const sendRequest = sb.stub(privateApi.analyzer.client, "sendRequest");
			const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves();

			sendRequest.withArgs(ReanalyzeRequest.type).resolves();
			await privateApi.analyzer.forceReanalyze();
			assert.ok(showErrorMessage.notCalled);
		});

		it("forceReanalyze shows an error message when ReanalyzeRequest fails", async () => {
			const sendRequest = sb.stub(privateApi.analyzer.client, "sendRequest");
			const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves();

			sendRequest.withArgs(ReanalyzeRequest.type).rejects(new Error("Unsupported"));
			await privateApi.analyzer.forceReanalyze();
			assert.ok(showErrorMessage.calledOnceWithExactly("Reanalyze is not supported by this version of the Dart SDK's LSP server."));
		});

		it("forwards getSuper, getImports, getAugmented, and getAugmentation requests", async () => {
			const sendRequest = sb.stub(privateApi.analyzer.client, "sendRequest").resolves(null);
			const params: ls.TextDocumentPositionParams = {
				textDocument: { uri: helloWorldMainFile.toString() },
				position: { line: 0, character: 0 },
			};

			await privateApi.analyzer.getSuper(params);
			assert.ok(sendRequest.calledWithExactly(SuperRequest.type, params));

			await privateApi.analyzer.getImports(params);
			assert.ok(sendRequest.calledWithExactly(ImportsRequest.type, params));

			await privateApi.analyzer.getAugmented(params);
			assert.ok(sendRequest.calledWithExactly(AugmentedRequest.type, params));

			await privateApi.analyzer.getAugmentation(params);
			assert.ok(sendRequest.calledWithExactly(AugmentationRequest.type, params));
		});
	});

	describe("WorkspaceEdit conversion and unofficial snippet edits", () => {
		function getP2c() {
			return privateApi.analyzer.client.protocol2CodeConverter;
		}

		it("converts documentChanges including file ops, annotations, SnippetTextEdit with keepWhitespace, and unofficial snippets", async () => {
			const p2c = getP2c();

			assert.equal(await p2c.asWorkspaceEdit(undefined), undefined);

			const fileUri = helloWorldMainFile.toString();
			const wsEdit: ls.WorkspaceEdit = {
				changeAnnotations: {
					ann1: {
						label: "Annotation 1",
						needsConfirmation: true,
						description: "Test annotation",
					},
				},
				documentChanges: [
					ls.CreateFile.create("file:///test/new.dart", { overwrite: true }, "ann1"),
					ls.RenameFile.create("file:///test/old.dart", "file:///test/renamed.dart", { ignoreIfExists: true }, "ann1"),
					ls.DeleteFile.create("file:///test/delete.dart", { recursive: false }),
					{
						textDocument: { uri: fileUri, version: 1 },
						edits: [
							ls.AnnotatedTextEdit.replace(
								ls.Range.create(0, 0, 0, 5),
								"annotatedText",
								"ann1",
							),
							{
								range: ls.Range.create(1, 0, 1, 5),
								snippet: { kind: "snippet", value: "stdSnippet($1)" },
								annotationId: "ann1",
							},
							ls.TextEdit.replace(
								ls.Range.create(2, 0, 2, 5),
								"plainText",
							),
							{
								range: ls.Range.create(3, 0, 3, 5),
								newText: "customSnippet($0)",
								insertTextFormat: ls.InsertTextFormat.Snippet,
							} as unknown as ls.TextEdit,
						],
					},
				],
			};

			const setSpy = sb.spy(vs.WorkspaceEdit.prototype, "set");
			const result = await p2c.asWorkspaceEdit(wsEdit);
			assert.ok(result);

			assert.ok(setSpy.calledOnce);
			const setEdits = setSpy.firstCall.args[1] as Array<[vs.TextEdit | vs.SnippetTextEdit, vs.WorkspaceEditEntryMetadata | undefined]>;
			assert.equal(setEdits.length, 4);

			assert.ok(setEdits[0][0] instanceof vs.TextEdit);
			assert.equal(setEdits[0][0].newText, "annotatedText");
			assert.equal((setEdits[0][0] as any).isCustomSnippet, undefined);
			assert.equal(setEdits[0][1]?.label, "Annotation 1");

			assert.ok(setEdits[1][0] instanceof vs.SnippetTextEdit);
			assert.equal(setEdits[1][0].snippet.value, "stdSnippet($1)");
			assert.equal(setEdits[1][0].keepWhitespace, true);
			assert.equal(setEdits[1][1]?.label, "Annotation 1");

			assert.ok(setEdits[2][0] instanceof vs.TextEdit);
			assert.equal(setEdits[2][0].newText, "plainText");
			assert.equal((setEdits[2][0] as any).isCustomSnippet, undefined);
			assert.equal(setEdits[2][1], undefined);

			assert.ok(setEdits[3][0] instanceof vs.TextEdit);
			assert.equal(setEdits[3][0].newText, "customSnippet($0)");
			assert.equal((setEdits[3][0] as any).isCustomSnippet, true);
			assert.equal(setEdits[3][1], undefined);
		});

		it("converts legacy changes map and marks unofficial snippet edits", async () => {
			const p2c = getP2c();
			const fileUri = helloWorldMainFile.toString();

			const wsEdit: ls.WorkspaceEdit = {
				changes: {
					[fileUri]: [
						{
							range: ls.Range.create(0, 0, 0, 3),
							newText: "legacySnippet($1)",
							insertTextFormat: ls.InsertTextFormat.Snippet,
						} as any,
						ls.TextEdit.replace(ls.Range.create(1, 0, 1, 3), "legacyPlain"),
					],
				},
			};

			const result = await p2c.asWorkspaceEdit(wsEdit);
			assert.ok(result);
			const edits = result.get(helloWorldMainFile);
			assert.equal(edits.length, 2);
			assert.equal(edits[0].newText, "legacySnippet($1)");
			assert.equal((edits[0] as any).isCustomSnippet, true);
			assert.equal(edits[1].newText, "legacyPlain");
			assert.equal((edits[1] as any).isCustomSnippet, undefined);
		});

		it("throws on unknown workspace edit change type", async () => {
			const p2c = getP2c();
			const invalidEdit: ls.WorkspaceEdit = {
				documentChanges: [{ kind: "unknownChangeKind" } as any],
			};

			await assert.rejects(() => p2c.asWorkspaceEdit(invalidEdit), /Unknown workspace edit change received/);
		});

		it("converts commands and code actions in asCodeActionResult", async () => {
			const p2c = getP2c();
			const fileUri = helloWorldMainFile.toString();

			const items: Array<ls.Command | ls.CodeAction> = [
				ls.Command.create("My Command", "dart.myCommand", "arg1"),
				{
					title: "Action With Edit",
					edit: {
						changes: {
							[fileUri]: [
								{
									range: ls.Range.create(0, 0, 0, 1),
									newText: "actionSnippet($0)",
									insertTextFormat: ls.InsertTextFormat.Snippet,
								} as any,
							],
						},
					},
				},
				{
					title: "Action Without Edit",
				},
			];

			const results = await p2c.asCodeActionResult(items);
			assert.equal(results.length, 3);
			assert.equal((results[0] as vs.Command).command, "dart.myCommand");

			const actionWithEdit = results[1] as vs.CodeAction;
			assert.ok(actionWithEdit.edit);
			const edits = actionWithEdit.edit.get(helloWorldMainFile);
			assert.equal(edits.length, 1);
			assert.equal((edits[0] as any).isCustomSnippet, true);

			const actionWithoutEdit = results[2] as vs.CodeAction;
			assert.equal(actionWithoutEdit.edit, undefined);
		});
	});

	describe("getAnalyzerArgs", () => {
		function getConfig() {
			return (privateApi.testModel as any).config as Record<string, unknown>;
		}

		it("throws and shows error when custom analyzerPath does not exist", () => {
			const missingPath = path.join(fsPath(helloWorldFolder), "non_existent_analyzer.snapshot");
			sb.stub(getConfig(), "analyzerPath").get(() => missingPath);

			const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves();
			const errorSpy = sb.spy();
			const fakeLogger = { error: errorSpy, info: () => undefined, warn: () => undefined };
			const expectedMessage = `Could not find a Dart Analysis Server at ${missingPath}`;

			assert.throws(
				() => privateApi.analyzer.spawnServer(fakeLogger, privateApi.workspaceContext.sdks),
				new RegExp(`^Error: Could not find a Dart Analysis Server at ${missingPath.replace(/\\/g, "\\\\")}$`),
			);
			assert.ok(showErrorMessage.calledOnceWithExactly(expectedMessage));
			assert.ok(errorSpy.calledOnceWithExactly(expectedMessage));
		});

		it("includes configured VM service, port, log files, and additional args", () => {
			const existingAnalyzerPath = fsPath(helloWorldMainFile);
			const instrLog = path.join(os.tmpdir(), "dart_instr.log");
			const sessionLog = path.join(os.tmpdir(), "dart_session.log");

			const config = getConfig();
			sb.stub(config, "analyzerPath").get(() => existingAnalyzerPath);
			sb.stub(config, "analyzerVmServicePort").get(() => 8123);
			sb.stub(config, "analyzerVmAdditionalArgs").get(() => ["--vm-custom-flag"]);
			sb.stub(config, "analyzerDiagnosticsPort").get(() => 9123);
			sb.stub(config, "analyzerInstrumentationLogFile").get(() => instrLog);
			sb.stub(config, "analyzerSessionLogFile").get(() => sessionLog);
			sb.stub(config, "analyzerAdditionalArgs").get(() => ["--analyzer-custom-flag"]);

			let capturedArgs: string[] | undefined;
			const fakeLogger = {
				error: () => undefined,
				info: (msg: string) => {
					const prefix = " with args ";
					const idx = msg.indexOf(prefix);
					if (idx !== -1) {
						capturedArgs = JSON.parse(msg.substring(idx + prefix.length)) as string[];
						throw new Error("STOP_BEFORE_SPAWN");
					}
				},
				warn: () => undefined,
			};

			assert.throws(
				() => privateApi.analyzer.spawnServer(fakeLogger, privateApi.workspaceContext.sdks),
				/STOP_BEFORE_SPAWN/,
			);

			assert.ok(capturedArgs);
			assert.ok(capturedArgs.includes("--enable-vm-service=8123"));
			assert.ok(capturedArgs.includes("-DSILENT_OBSERVATORY=true"));
			assert.ok(capturedArgs.includes("-DSILENT_VM_SERVICE=true"));
			assert.ok(capturedArgs.includes("--disable-service-auth-codes"));
			assert.ok(capturedArgs.includes("--no-dds"));
			assert.ok(capturedArgs.includes("--no-serve-devtools"));
			assert.ok(capturedArgs.includes("--vm-custom-flag"));
			assert.ok(capturedArgs.includes(existingAnalyzerPath));
			assert.ok(capturedArgs.includes("--lsp"));
			assert.ok(capturedArgs.includes("--port=9123"));
			assert.ok(capturedArgs.includes(`--instrumentation-log-file=${instrLog}`));
			assert.ok(capturedArgs.includes(`--session-log=${sessionLog}`));
			assert.ok(capturedArgs.includes("--analyzer-custom-flag"));
		});
	});

	describe("DartErrorHandler", () => {
		function createErrorHandler(): ls.ErrorHandler & { restarts: number[] } {
			const ErrorHandlerClass = privateApi.analyzer.client.clientOptions.errorHandler!.constructor as new (logger: typeof privateApi.logger) => ls.ErrorHandler & { restarts: number[] };
			return new ErrorHandlerClass(privateApi.logger);
		}

		it("continues on error before maxRestartCount and shuts down at maxRestartCount", () => {
			const handler = createErrorHandler();
			const msg: ls.Message = { jsonrpc: "2.0" };

			assert.deepEqual(handler.error(new Error("err1"), msg, 1), { action: ls.ErrorAction.Continue });
			assert.deepEqual(handler.error(new Error("err2"), msg, 2), { action: ls.ErrorAction.Shutdown });
			assert.deepEqual(handler.error(new Error("err0"), msg, 0), { action: ls.ErrorAction.Shutdown });
		});

		it("restarts on close up to maxRestartCount and stops if crashing repeatedly within 3 minutes", () => {
			const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves();
			const handler = createErrorHandler();

			// First 2 closes always restart.
			assert.deepEqual(handler.closed(), { action: ls.CloseAction.Restart });
			assert.deepEqual(handler.closed(), { action: ls.CloseAction.Restart });

			// If oldest restart was > 3 minutes ago, shifts and restarts.
			handler.restarts[0] = Date.now() - (4 * 60 * 1000);
			assert.deepEqual(handler.closed(), { action: ls.CloseAction.Restart });
			assert.equal(handler.restarts.length, 2);

			// Next close within 3 minutes exceeds maxRestartCount and does not restart.
			assert.deepEqual(handler.closed(), { action: ls.CloseAction.DoNotRestart, handled: true });
			assert.ok(showErrorMessage.calledOnce);
			assert.ok(showErrorMessage.firstCall.args[0].includes("The Dart Analysis Server crashed 3 times in the last 3 minutes and will not restart."));
		});
	});

	describe("lifecycle and DTD helpers", () => {
		it("connectToDtd handles undefined DTD and logs error on failure", async () => {
			await privateApi.analyzer.connectToDtd(undefined);

			const loggerError = sb.stub(privateApi.logger, "error");
			sb.stub(privateApi.analyzer.client, "sendRequest").rejects(new Error("DTD error"));
			await privateApi.analyzer.connectToDtd({ dtdUri: Promise.resolve("ws://127.0.0.1:1234/ws") } as unknown as DartToolingDaemon);
			if (privateApi.dartCapabilities.supportsLspOverDtd)
				assert.ok(loggerError.calledOnce);
		});

		it("initializationFailedHandler logs warning and returns false", () => {
			const res = privateApi.analyzer.client.clientOptions.initializationFailedHandler!(new Error("init failed"));
			assert.equal(res, false);
		});

		it("handleDisposeCleanup resolves immediately when process has already exited", async () => {
			await privateApi.analyzer.handleDisposeCleanup({ exitCode: 0, signalCode: null } as SpawnedProcess);
		});

		it("handleDisposeCleanup resolves when process exits before timeout", async () => {
			let exitCb: (() => void) | undefined;
			const exitingProc = {
				exitCode: null,
				signalCode: null,
				once: (_event: string, cb: () => void) => { exitCb = cb; },
				kill: sb.spy(),
			};

			const p1 = privateApi.analyzer.handleDisposeCleanup(exitingProc as unknown as SpawnedProcess);
			exitCb!();
			await p1;
			assert.ok(exitingProc.kill.notCalled);
		});

		it("handleDisposeCleanup kills process if it does not exit within timeout", async () => {
			const clock = sb.useFakeTimers();
			try {
				const hungProc = {
					exitCode: null,
					signalCode: null,
					once: () => undefined,
					kill: sb.spy(),
				};
				const p2 = privateApi.analyzer.handleDisposeCleanup(hungProc as unknown as SpawnedProcess);
				clock.tick(3000);
				await p2;
				assert.ok(hungProc.kill.calledOnce);
			} finally {
				clock.restore();
			}
		});
	});
});

