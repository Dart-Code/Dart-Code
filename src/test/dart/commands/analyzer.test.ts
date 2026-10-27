import { strict as assert } from "assert";
import * as os from "os";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import * as ls from "vscode-languageclient";
import { AugmentationRequest, AugmentedRequest, DiagnosticServerRequest, ImportsRequest, OpenUriNotification, ReanalyzeRequest, SuperRequest } from "../../../shared/analysis/lsp/custom_protocol";
import { fsPath } from "../../../shared/utils/fs";
import { activate, defer, delay, fakeCancellationToken, helloWorldFolder, helloWorldMainFile, privateApi, sb, setConfigForTest } from "../../helpers";

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
			const client = (privateApi.analyzer as any).client;
			return client._notificationHandlers.get(OpenUriNotification.type.method) as (params: { uri: string }) => void; // eslint-disable-line no-underscore-dangle
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
			const loggerError = sb.stub((privateApi.analyzer as any).logger, "error");
			const handler = getOpenUriHandler();

			handler({ uri: "ftp://example.com/file" });

			assert.ok(loggerError.calledOnce);
			assert.ok(loggerError.firstCall.args[0].includes("Unable to open URI ftp://example.com/file as requested by LSP server. Unknown scheme."));
		});
	});

	describe("middleware", () => {
		function getMiddleware(): ls.Middleware {
			return (privateApi.analyzer as any).buildMiddleware() as ls.Middleware;
		}

		it("cleans doc strings in resolveCompletionItem and provideHover", async () => {
			const middleware = getMiddleware();

			// resolveCompletionItem with string documentation
			const itemString = new vs.CompletionItem("test1");
			itemString.documentation = "Doc 1\n{@template foo}\nTemplate body\n{@endtemplate}";
			const resolvedString = await middleware.resolveCompletionItem!(itemString, fakeCancellationToken, async (i: vs.CompletionItem) => i);
			assert.equal(resolvedString?.documentation, "Doc 1\nTemplate body");

			// resolveCompletionItem with MarkdownString documentation
			const itemMd = new vs.CompletionItem("test2");
			itemMd.documentation = new vs.MarkdownString("Doc 2\n{@template bar}\nMarkdown body\n{@endtemplate}");
			const resolvedMd = await middleware.resolveCompletionItem!(itemMd, fakeCancellationToken, async (i: vs.CompletionItem) => i);
			assert.ok(resolvedMd?.documentation instanceof vs.MarkdownString);
			assert.equal((resolvedMd.documentation).value, "Doc 2\nMarkdown body");

			// resolveCompletionItem without documentation
			const itemNoDoc = new vs.CompletionItem("test3");
			const resolvedNoDoc = await middleware.resolveCompletionItem!(itemNoDoc, fakeCancellationToken, async (i: vs.CompletionItem) => i);
			assert.equal(resolvedNoDoc?.documentation, undefined);

			// provideHover with string, MarkdownString, { language, value }, and unknown object
			const doc = await vs.workspace.openTextDocument(helloWorldMainFile);
			const pos = new vs.Position(0, 0);
			const unknownObj = { other: 123 } as any;
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

			const nullHover = await middleware.provideHover!(doc, pos, fakeCancellationToken, async () => null);
			assert.equal(nullHover, null);
		});

		it("handles completion re-triggering and signature help in provideCompletionItem", async () => {
			await setConfigForTest("editor", "parameterHints.enabled", true);
			const middleware = getMiddleware();
			const doc = await vs.workspace.openTextDocument(helloWorldMainFile);
			const pos = new vs.Position(0, 0);
			const context: vs.CompletionContext = { triggerKind: vs.CompletionTriggerKind.Invoke, triggerCharacter: undefined };

			// Null results
			const nullRes = await middleware.provideCompletionItem!(doc, pos, context, fakeCancellationToken, async () => null);
			assert.equal(nullRes, undefined);

			// Empty incomplete list with cancelled token
			const cancelledToken: vs.CancellationToken = {
				isCancellationRequested: true,
				onCancellationRequested: () => ({ dispose: () => undefined }),
			};
			const emptyListRes = await middleware.provideCompletionItem!(doc, pos, context, cancelledToken, async () => new vs.CompletionList([], true));
			assert.equal(emptyListRes, undefined);

			// CompletionList with various items
			const importItem = new vs.CompletionItem("import '';");
			const namedArgItem = new vs.CompletionItem({ label: "namedArg: " });
			const folderWithSlash = new vs.CompletionItem("sub/", vs.CompletionItemKind.Folder);
			const folderLabelObjWithSlash = new vs.CompletionItem({ label: "sub2/" }, vs.CompletionItemKind.Folder);
			const folderWithoutSlash = new vs.CompletionItem("sub_no_slash", vs.CompletionItemKind.Folder);
			const sigHelpStringItem = new vs.CompletionItem("fn1");
			sigHelpStringItem.insertText = "fn1(${1:a})";
			const sigHelpSnippetItem = new vs.CompletionItem("fn2");
			sigHelpSnippetItem.insertText = new vs.SnippetString("fn2($0)");
			const sigHelpLabelFallbackItem = new vs.CompletionItem({ label: "fn3(${1:b})" });
			const plainItem = new vs.CompletionItem("plain");
			const emptyLabelItem = { label: "" } as vs.CompletionItem;

			const list = {
				isIncomplete: undefined,
				items: [
					importItem,
					namedArgItem,
					folderWithSlash,
					folderLabelObjWithSlash,
					folderWithoutSlash,
					sigHelpStringItem,
					sigHelpSnippetItem,
					sigHelpLabelFallbackItem,
					plainItem,
					emptyLabelItem,
				],
			} as vs.CompletionList;

			await middleware.provideCompletionItem!(doc, pos, context, fakeCancellationToken, async () => list);

			assert.equal(importItem.command?.command, "editor.action.triggerSuggest");
			assert.equal(namedArgItem.command?.command, "editor.action.triggerSuggest");
			assert.equal(folderWithSlash.command?.command, "editor.action.triggerSuggest");
			assert.equal(folderLabelObjWithSlash.command?.command, "editor.action.triggerSuggest");
			assert.equal(folderWithoutSlash.command, undefined);
			assert.equal(sigHelpStringItem.command?.command, "editor.action.triggerParameterHints");
			assert.equal(sigHelpSnippetItem.command?.command, "editor.action.triggerParameterHints");
			assert.equal(sigHelpLabelFallbackItem.command?.command, "editor.action.triggerParameterHints");
			assert.equal(plainItem.command, undefined);

			// Array result branch
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

		it("logs a warning when an inlay hint has a negative character position or label part range", async () => {
			const middleware = getMiddleware();
			const doc = await vs.workspace.openTextDocument(helloWorldMainFile);
			const viewPort = new vs.Range(new vs.Position(0, 0), new vs.Position(10, 0));

			const validStringHint = new vs.InlayHint(new vs.Position(1, 2), "valid");
			const validPart = new vs.InlayHintLabelPart("part");
			validPart.location = new vs.Location(helloWorldMainFile, new vs.Range(new vs.Position(1, 0), new vs.Position(1, 4)));
			const validPartsHint = new vs.InlayHint(new vs.Position(1, 2), [validPart]);

			const negativePosHint = {
				position: { line: 1, character: -1 },
				label: "negPos",
			} as unknown as vs.InlayHint;

			const negRangeStartHint = {
				position: { line: 1, character: 2 },
				label: [{
					value: "negStart",
					location: {
						uri: helloWorldMainFile,
						range: { start: { line: 1, character: -1 }, end: { line: 1, character: 3 } },
					},
				}],
			} as unknown as vs.InlayHint;

			const negRangeEndHint = {
				position: { line: 1, character: 2 },
				label: [{
					value: "negEnd",
					location: {
						uri: helloWorldMainFile,
						range: { start: { line: 1, character: 0 }, end: { line: 1, character: -2 } },
					},
				}],
			} as unknown as vs.InlayHint;

			const hints = [validStringHint, validPartsHint, negativePosHint, negRangeStartHint, negRangeEndHint];
			const res = await middleware.provideInlayHints!(doc, viewPort, fakeCancellationToken, async () => hints);
			assert.strictEqual(res, hints);

			const nullRes = await middleware.provideInlayHints!(doc, viewPort, fakeCancellationToken, async () => null);
			assert.equal(nullRes, null);
		});

		it("injects default dart configuration values in workspace.configuration", async () => {
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
					{},
					{ maxCompletionItems: 50, documentation: "summary" },
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
		it("getDiagnosticServerPort returns port, handles cancellation, and rethrows other errors", async () => {
			const client = (privateApi.analyzer as any).client;
			const sendRequest = sb.stub(client, "sendRequest");

			// Success
			sendRequest.withArgs(DiagnosticServerRequest.type, sinon.match.any).resolves({ port: 12345 });
			const portRes = await privateApi.analyzer.getDiagnosticServerPort();
			assert.deepEqual(portRes, { port: 12345 });

			// Cancelled
			sendRequest.withArgs(DiagnosticServerRequest.type, sinon.match.any).callsFake(async (_type: any, token: vs.CancellationToken) => {
				if (typeof (token as any).cancel === "function")
					(token as any).cancel();
				else
					Object.defineProperty(token, "isCancellationRequested", { value: true });
				throw new Error("Request cancelled");
			});
			const cancelledRes = await privateApi.analyzer.getDiagnosticServerPort();
			assert.equal(cancelledRes, undefined);

			// Other error
			sendRequest.withArgs(DiagnosticServerRequest.type, sinon.match.any).rejects(new Error("Server error"));
			await assert.rejects(() => privateApi.analyzer.getDiagnosticServerPort(), /Server error/);
		});

		it("forceReanalyze sends request and shows error message on failure", async () => {
			const client = (privateApi.analyzer as any).client;
			const sendRequest = sb.stub(client, "sendRequest");
			const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves();

			sendRequest.withArgs(ReanalyzeRequest.type).resolves();
			await privateApi.analyzer.forceReanalyze();
			assert.ok(showErrorMessage.notCalled);

			sendRequest.withArgs(ReanalyzeRequest.type).rejects(new Error("Unsupported"));
			await privateApi.analyzer.forceReanalyze();
			assert.ok(showErrorMessage.calledOnceWithExactly("Reanalyze is not supported by this version of the Dart SDK's LSP server."));
		});

		it("forwards getSuper, getImports, getAugmented, and getAugmentation requests", async () => {
			const analyzer = privateApi.analyzer as any;
			const sendRequest = sb.stub(analyzer.client, "sendRequest").resolves(null);
			const params: ls.TextDocumentPositionParams = {
				textDocument: { uri: helloWorldMainFile.toString() },
				position: { line: 0, character: 0 },
			};

			await analyzer.getSuper(params);
			assert.ok(sendRequest.calledWithExactly(SuperRequest.type, params));

			await analyzer.getImports(params);
			assert.ok(sendRequest.calledWithExactly(ImportsRequest.type, params));

			await analyzer.getAugmented(params);
			assert.ok(sendRequest.calledWithExactly(AugmentedRequest.type, params));

			await analyzer.getAugmentation(params);
			assert.ok(sendRequest.calledWithExactly(AugmentationRequest.type, params));
		});
	});

	describe("WorkspaceEdit conversion and unofficial snippet edits", () => {
		interface P2cConverter {
			asWorkspaceEdit(item: ls.WorkspaceEdit | undefined | null, token?: vs.CancellationToken): Promise<vs.WorkspaceEdit | undefined>;
			asCodeActionResult(items: Array<ls.Command | ls.CodeAction>, token?: vs.CancellationToken): Promise<Array<vs.Command | vs.CodeAction>>;
		}

		function getP2c(): P2cConverter {
			return (privateApi.analyzer as any).client._p2c as P2cConverter; // eslint-disable-line no-underscore-dangle
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
							} as any,
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
		beforeEach("prevent extension reload on config change", () => {
			const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
			executeCommand.withArgs("_dart.reloadExtension", sinon.match.any, sinon.match.any).resolves();
			defer("Wait for config change timer", () => delay(100));
		});

		it("throws and shows error when custom analyzerPath does not exist", async () => {
			const missingPath = path.join(fsPath(helloWorldFolder), "non_existent_analyzer.snapshot");
			await setConfigForTest("dart", "analyzerPath", missingPath);

			const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves();
			const errorSpy = sb.spy();
			const fakeLogger = { error: errorSpy, info: () => undefined, warn: () => undefined };

			assert.throws(
				() => (privateApi.analyzer as any).spawnServer(fakeLogger, privateApi.workspaceContext.sdks) as unknown,
				new RegExp(`Could not find a Dart Analysis Server at ${missingPath.replace(/\\/g, "\\\\")}`),
			);
			assert.ok(showErrorMessage.calledOnce);
			assert.ok(errorSpy.calledOnce);
		});

		it("includes configured VM service, port, log files, and additional args", async () => {
			const existingAnalyzerPath = fsPath(helloWorldMainFile);
			const instrLog = path.join(os.tmpdir(), "dart_instr.log");
			const sessionLog = path.join(os.tmpdir(), "dart_session.log");

			await setConfigForTest("dart", "analyzerPath", existingAnalyzerPath);
			await setConfigForTest("dart", "analyzerVmServicePort", 8123);
			await setConfigForTest("dart", "analyzerVmAdditionalArgs", ["--vm-custom-flag"]);
			await setConfigForTest("dart", "analyzerDiagnosticsPort", 9123);
			await setConfigForTest("dart", "analyzerInstrumentationLogFile", instrLog);
			await setConfigForTest("dart", "analyzerSessionLogFile", sessionLog);
			await setConfigForTest("dart", "analyzerAdditionalArgs", ["--analyzer-custom-flag"]);

			let capturedArgs: string[] | undefined;
			const fakeLogger = {
				error: () => undefined,
				info: (msg: string) => {
					const prefix = " with args ";
					const idx = msg.indexOf(prefix);
					if (idx !== -1) {
						capturedArgs = JSON.parse(msg.substring(idx + prefix.length));
						throw new Error("STOP_BEFORE_SPAWN");
					}
				},
				warn: () => undefined,
			};

			assert.throws(
				() => (privateApi.analyzer as any).spawnServer(fakeLogger, privateApi.workspaceContext.sdks) as unknown,
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
			const ErrorHandlerClass = (privateApi.analyzer as any).client.clientOptions.errorHandler.constructor;
			return new ErrorHandlerClass(privateApi.logger) as ls.ErrorHandler & { restarts: number[] };
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
			const analyzer = privateApi.analyzer as any;
			await analyzer.connectToDtd(undefined);

			const loggerError = sb.stub(analyzer.logger, "error");
			sb.stub(analyzer.client, "sendRequest").rejects(new Error("DTD error"));
			await analyzer.connectToDtd({ dtdUri: Promise.resolve("ws://127.0.0.1:1234/ws") });
			if (privateApi.dartCapabilities.supportsLspOverDtd)
				assert.ok(loggerError.calledOnce);
		});

		it("initializationFailedHandler logs warning and returns false", () => {
			const analyzer = privateApi.analyzer as any;
			const res = analyzer.client.clientOptions.initializationFailedHandler(new Error("init failed")) as boolean;
			assert.equal(res, false);
		});

		it("handleDisposeCleanup handles already exited, normal exit, and timeout kill", async () => {
			const analyzer = privateApi.analyzer as any;

			// Already exited
			await analyzer.handleDisposeCleanup({ exitCode: 0, signalCode: null });

			// Exits on event
			let exitCb: (() => void) | undefined;
			const exitingProc = {
				exitCode: null,
				signalCode: null,
				once: (_event: string, cb: () => void) => { exitCb = cb; },
				kill: sb.spy(),
			};
			const p1 = analyzer.handleDisposeCleanup(exitingProc) as Promise<void>;
			exitCb!();
			await p1;
			assert.ok(exitingProc.kill.notCalled);

			// Timeout kill
			const clock = sb.useFakeTimers();
			try {
				const hungProc = {
					exitCode: null,
					signalCode: null,
					once: () => undefined,
					kill: sb.spy(),
				};
				const p2 = analyzer.handleDisposeCleanup(hungProc) as Promise<void>;
				clock.tick(3000);
				await p2;
				assert.ok(hungProc.kill.calledOnce);
			} finally {
				clock.restore();
			}
		});
	});
});

