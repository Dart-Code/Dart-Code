import * as path from "path";
import * as stream from "stream";
import * as vs from "vscode";
import * as ls from "vscode-languageclient";
import { ProvideDocumentColorsSignature } from "vscode-languageclient/lib/common/colorProvider";
import { LanguageClient, StreamInfo, StreamMessageReader, StreamMessageWriter } from "vscode-languageclient/node";
import { AnalyzerStatusNotification, CompleteStatementRequest, DiagnosticServerRequest, ReanalyzeRequest, SuperRequest } from "../../shared/analysis/lsp/custom_protocol";
import { Analyzer } from "../../shared/analyzer";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { dartVMPath, validClassNameRegex, validMethodNameRegex } from "../../shared/constants";
import { LogCategory } from "../../shared/enums";
import { DartSdks, Logger } from "../../shared/interfaces";
import { CategoryLogger } from "../../shared/logging";
import { PromiseCompleter } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { cleanDartdoc, createMarkdownString } from "../../shared/vscode/extension_utils";
import { WorkspaceContext } from "../../shared/workspace";
import { config } from "../config";
import { DART_MODE } from "../extension";
import { InteractiveRefactors } from "../lsp/interactive_refactors";
import { IgnoreLintCodeActionProvider } from "../providers/ignore_lint_code_action_provider";
import { reportAnalyzerTerminatedWithError } from "../utils/misc";
import { safeToolSpawn } from "../utils/processes";
import { getAnalyzerArgs } from "./analyzer";
import { SnippetTextEditFeature } from "./analyzer_lsp_snippet_text_edits";
import { LspFileTracker } from "./file_tracker_lsp";

export class LspAnalyzer extends Analyzer {
	public readonly client: LanguageClient;
	public readonly fileTracker: LspFileTracker;
	public readonly vmServicePort: number | undefined;
	private readonly snippetTextEdits: SnippetTextEditFeature;
	private readonly refactors: InteractiveRefactors;

	protected readonly onDocumentColorsRequestedCompleter = new PromiseCompleter<void>();
	public readonly onDocumentColorsRequested = this.onDocumentColorsRequestedCompleter.promise;

	constructor(logger: Logger, sdks: DartSdks, private readonly dartCapabilities: DartCapabilities, wsContext: WorkspaceContext) {
		super(new CategoryLogger(logger, LogCategory.Analyzer));
		this.vmServicePort = config.analyzerVmServicePort;
		this.snippetTextEdits = new SnippetTextEditFeature(dartCapabilities);
		this.refactors = new InteractiveRefactors(logger);
		this.client = createClient(this.logger, sdks, dartCapabilities, wsContext, this.buildMiddleware(), this.vmServicePort);
		this.fileTracker = new LspFileTracker(logger, this.client, wsContext);
		this.client.registerFeature(this.snippetTextEdits.feature);
		this.disposables.push({ dispose: () => this.client.stop() });
		this.disposables.push(this.fileTracker);
		this.disposables.push(this.snippetTextEdits);
		this.disposables.push(this.refactors);

		// tslint:disable-next-line: no-floating-promises
		this.client.start().then(() => {
			// Reminder: These onNotification calls only hold ONE handler!
			// https://github.com/microsoft/vscode-languageserver-node/issues/174
			// TODO: Remove this once Dart/Flutter stable LSP servers are using $/progress.
			this.client.onNotification(AnalyzerStatusNotification.type, (params) => {
				this.onAnalysisStatusChangeEmitter.fire({ isAnalyzing: params.isAnalyzing });
			});
			this.onReadyCompleter.resolve();
		});
	}

	private buildMiddleware(): ls.Middleware {
		// Why need this 🤷‍♂️?
		function isLanguageValuePair(input: any): input is { language: string; value: string } {
			return "language" in input && typeof input.language === "string" && "value" in input && typeof input.value === "string";
		}

		function cleanDocString<T extends vs.MarkedString | vs.MarkdownString | string>(input: T): T {
			if (input instanceof vs.MarkdownString)
				return createMarkdownString(cleanDartdoc(input.value)) as T;
			else if (typeof input === "string")
				return cleanDartdoc(input) as T;
			else if (isLanguageValuePair(input))
				return { language: input.language, value: cleanDartdoc(input.value) } as T;
			else
				return input;
		}

		/// Whether or not to trigger completion again when completing on this item. This is used
		/// for convenience, eg. when completing the "import '';" snippet people expect completion
		/// to immediately reopen.
		function shouldTriggerCompletionAgain(item: vs.CompletionItem): boolean {
			const label = typeof item.label === "string" ? item.label : item.label.label;

			if (label === "import '';")
				return true;

			// When completing on named args, re-trigger for the value.
			if (label.trimRight().endsWith(":"))
				return true;

			if (item.kind === vs.CompletionItemKind.Folder) {
				const label = typeof item.label === "string" ? item.label : item.label.label;
				return label.endsWith("/");
			}

			return false;
		}

		const signatureHelpValidPattern = new RegExp("\\(\\${?[01]");

		/// Whether or not to trigger signature help on this item. This is used because if a user doesn't
		/// type the ( manually (but it's inserted as part of the completion) then the parameter hints do
		/// not show up.
		function shouldTriggerSignatureHelp(item: vs.CompletionItem): boolean {
			let insertText: string | undefined;
			if (item.insertText) {
				if (typeof item.insertText === "string")
					insertText = item.insertText;
				else
					insertText = item.insertText.value;
			} else {
				const label = typeof item.label === "string" ? item.label : item.label.label;
				insertText = label;
			}
			if (insertText && signatureHelpValidPattern.test(insertText))
				return true;

			return false;
		}

		const refactors = this.refactors;
		const snippetTextEdits = this.snippetTextEdits;
		const ignoreActionProvider = new IgnoreLintCodeActionProvider(DART_MODE);

		const startTimer = (message: string): ({ end: (message: string | undefined) => void }) => {
			const startTime = process.hrtime();
			return {
				end: (endMessage?: string) => {
					const timeTaken = process.hrtime(startTime);
					const timeTakenMs = Math.round(timeTaken[0] * 1000 + timeTaken[1] / 1000000);
					this.logger.info(`[ ${timeTakenMs} ms ] ${message} ${endMessage}`.trim(), LogCategory.AnalyzerTiming);
				},
			};
		};

		return {
			handleWorkDoneProgress: (token: ls.ProgressToken, params: ls.WorkDoneProgressBegin | ls.WorkDoneProgressReport | ls.WorkDoneProgressEnd, next: ls.HandleWorkDoneProgressSignature) => {
				if (params.kind === "begin")
					this.onAnalysisStatusChangeEmitter.fire({ isAnalyzing: true, suppressProgress: true });
				else if (params.kind === "end")
					this.onAnalysisStatusChangeEmitter.fire({ isAnalyzing: false, suppressProgress: true });

				next(token, params);
			},

			provideCompletionItem: async (document: vs.TextDocument, position: vs.Position, context: vs.CompletionContext, token: vs.CancellationToken, next: ls.ProvideCompletionItemsSignature) => {
				const range = document.getWordRangeAtPosition(position);
				const prefix = range ? document.getText(range) : undefined;
				const timer = startTimer(`Completion: ${prefix ?? ""}`);
				const results = await next(document, position, context, token);
				let items: vs.CompletionItem[];
				let isIncomplete = false;

				// Handle either a CompletionItem[] or CompletionList.
				if (!results) {
					items = [];
				} else if ("isIncomplete" in results) {
					items = results.items;
					isIncomplete = results.isIncomplete ?? false;
				} else {
					items = results as vs.CompletionItem[];
				}
				timer.end(`${items.length} results ${isIncomplete ? "(incomplete)" : ""} ${token.isCancellationRequested ? "(cancelled)" : ""}`);

				if (!items.length)
					return;

				const parameterHintsEnabled = !!vs.workspace.getConfiguration("editor").get("parameterHints.enabled");
				for (const item of items) {
					if (shouldTriggerCompletionAgain(item)) {
						item.command = {
							command: "editor.action.triggerSuggest",
							title: "Suggest",
						};
					} else if (parameterHintsEnabled && shouldTriggerSignatureHelp(item)) {
						item.command = {
							command: "editor.action.triggerParameterHints",
							title: "Suggest",
						};
					}
				}

				return results;
			},

			resolveCompletionItem: (item: vs.CompletionItem, token: vs.CancellationToken, next: ls.ResolveCompletionItemSignature) => {
				if (item.documentation)
					item.documentation = cleanDocString(item.documentation);
				return next(item, token);
			},

			provideHover: async (document: vs.TextDocument, position: vs.Position, token: vs.CancellationToken, next: ls.ProvideHoverSignature) => {
				const item = await next(document, position, token);
				if (item?.contents)
					item.contents = item.contents.map((s) => cleanDocString(s));
				return item;
			},

			provideDocumentColors: (document: vs.TextDocument, token: vs.CancellationToken, next: ProvideDocumentColorsSignature) => {
				this.onDocumentColorsRequestedCompleter.resolve();
				return next(document, token);
			},

			async provideCodeActions(document: vs.TextDocument, range: vs.Range, context: vs.CodeActionContext, token: vs.CancellationToken, next: ls.ProvideCodeActionsSignature) {
				const documentVersion = document.version;
				let res = await next(document, range, context, token) || [];

				snippetTextEdits.rewriteSnippetTextEditsToCommands(documentVersion, res);
				if (config.experimentalNewRefactors)
					refactors.rewriteCommands(res);

				const hasExistingIgnoreActions = res.find((r) => r.title.startsWith("Ignore "));
				if (!hasExistingIgnoreActions) {
					const ignoreActions = ignoreActionProvider.provideCodeActions(document, range, context, token);
					if (ignoreActions)
						res = res.concat(ignoreActions);
				}

				return res;
			},

			executeCommand: async (command: string, args: any[], next: ls.ExecuteCommandSignature) => {
				if (command === "refactor.perform") {
					// Handle both the old way (6 args as a list) and the new way (a single arg that's a map).
					const mapArgsIndex = 0;
					const listArgsKindIndex = 0;
					const listArgsOptionsIndex = 5;
					const isValidListArgs = args.length === 6;
					const isValidMapsArgs = args.length === 1 && args[mapArgsIndex]?.path !== undefined;
					if (args && (isValidListArgs || isValidMapsArgs)) {
						const refactorFailedErrorCode = -32011;
						const mapArgs = args[mapArgsIndex];
						const refactorKind = isValidListArgs ? args[listArgsKindIndex] : mapArgs.kind;
						// Intercept EXTRACT_METHOD and EXTRACT_WIDGET to prompt the user for a name, but first call the validation
						// so we don't ask for a name if it will fail for a reason like a closure with an argument.
						const willPrompt = refactorKind === "EXTRACT_METHOD" || refactorKind === "EXTRACT_WIDGET";
						if (willPrompt) {
							if (this.dartCapabilities.supportsRefactorValidate) {
								try {
									const validateResult = await next("refactor.validate", args);
									if (validateResult.valid === false) {
										vs.window.showErrorMessage(validateResult.message as string);
										return;
									}
								} catch (e) {
									// If an error occurs, we'll just continue as if validation passed.
									this.logger.error(e);
								}
							}

							let name: string | undefined;
							switch (refactorKind) {
								case "EXTRACT_METHOD":
									name = await vs.window.showInputBox({
										prompt: "Enter a name for the method",
										validateInput: (s) => validMethodNameRegex.test(s) ? undefined : "Enter a valid method name",
										value: "newMethod",
									});
									if (!name)
										return;
									break;
								case "EXTRACT_WIDGET":
									name = await vs.window.showInputBox({
										prompt: "Enter a name for the widget",
										validateInput: (s) => validClassNameRegex.test(s) ? undefined : "Enter a valid widget name",
										value: "NewWidget",
									});
									if (!name)
										return;
									break;
							}

							if (name) {
								if (isValidListArgs)
									args[listArgsOptionsIndex] = Object.assign({}, args[listArgsOptionsIndex], { name });
								else
									args[0].options = Object.assign({}, args[0].options, { name });
							}
						}

						// The server may return errors for things like invalid names, so
						// capture the errors and present the error better if it's a refactor
						// error.
						try {
							return await next(command, args);
						} catch (e: any) {
							if (e?.code === refactorFailedErrorCode) {
								vs.window.showErrorMessage(e.message as string);
								return;
							} else {
								throw e;
							}
						}
					}
				}
				return next(command, args);
			},

			workspace: {
				configuration: async (params: ls.ConfigurationParams, token: vs.CancellationToken, next: ls.ConfigurationRequest.HandlerSignature) => {
					const results = await next(params, token);

					// Replace any instance of enableSnippets with the value of enableServerSnippets.
					if (Array.isArray(results)) {
						for (const result of results) {
							result.enableSnippets = config.enableServerSnippets && this.dartCapabilities.supportsServerSnippets;
						}
					}

					return results;
				},
			},
		};
	}

	public async getDiagnosticServerPort(): Promise<{ port: number }> {
		return this.client.sendRequest(DiagnosticServerRequest.type);
	}

	public async forceReanalyze(): Promise<void> {
		try {
			return await this.client.sendRequest(ReanalyzeRequest.type);
		} catch (e) {
			vs.window.showErrorMessage("Reanalyze is not supported by this version of the Dart SDK's LSP server.");
		}
	}

	public async getSuper(params: ls.TextDocumentPositionParams): Promise<ls.Location | null> {
		return this.client.sendRequest(
			SuperRequest.type,
			params,
		);
	}

	public async completeStatement(params: ls.TextDocumentPositionParams): Promise<ls.WorkspaceEdit | null> {
		return this.client.sendRequest(
			CompleteStatementRequest.type,
			params,
		);
	}
}

function createClient(logger: Logger, sdks: DartSdks, dartCapabilities: DartCapabilities, wsContext: WorkspaceContext, middleware: ls.Middleware, vmServicePort: number | undefined): LanguageClient {
	const clientOptions: ls.LanguageClientOptions = {
		initializationOptions: {
			closingLabels: config.closingLabels,
			flutterOutline: wsContext.hasAnyFlutterProjects,
			onlyAnalyzeProjectsWithOpenFiles: config.onlyAnalyzeProjectsWithOpenFiles,
			outline: true,
			previewNotImportedCompletions: config.previewNotImportedCompletions,
			suggestFromUnimportedLibraries: config.autoImportCompletions,
		},
		markdown: {
			supportHtml: true,
		},
		middleware,
		outputChannelName: "LSP",
		revealOutputChannelOn: ls.RevealOutputChannelOn.Never,
		uriConverters: {
			code2Protocol: (uri) => vs.Uri.file(fsPath(uri, { useRealCasing: !!config.normalizeFileCasing })).toString(),
			protocol2Code: (file) => vs.Uri.parse(file),
		},
	};

	const client = new LanguageClient(
		"dartAnalysisLSP",
		"Dart Analysis Server",
		async () => {
			const streamInfo = await spawnServer(logger, sdks, dartCapabilities, vmServicePort);
			const jsonEncoder = ls.RAL().applicationJson.encoder;

			return {
				detached: streamInfo.detached,
				reader: new StreamMessageReader(streamInfo.reader),
				writer: new StreamMessageWriter(streamInfo.writer, {
					contentTypeEncoder: {
						encode: (msg, options) => {
							(msg as any).clientRequestTime = Date.now();
							return jsonEncoder.encode(msg, options);
						},
						name: "withTiming",
					},
				}),
			};
		},
		clientOptions,
	);

	// HACK: Override the asCodeActionResult result to use our own custom asWorkspaceEdit so we can carry
	//       insertTextFormat from the protocol through to the middleware to handle snippets.
	//       This can be removed when we have a better way to do this.
	//       https://github.com/microsoft/vscode-languageserver-node/issues/1000
	const p2c = (client as any)._p2c; // eslint-disable-line no-underscore-dangle
	const originalAsWorkspaceEdit = p2c.asWorkspaceEdit as Function; // eslint-disable-line @typescript-eslint/ban-types
	const originalAsCodeAction = p2c.asCodeAction as Function; // eslint-disable-line @typescript-eslint/ban-types

	async function asWorkspaceEdit(item: ls.WorkspaceEdit | undefined | null, token?: vs.CancellationToken): Promise<vs.WorkspaceEdit | undefined> {
		const result = (await originalAsWorkspaceEdit(item, token)) as vs.WorkspaceEdit | undefined;
		if (!result) return;

		const snippetTypes = new Set<string>();
		// Figure out which are Snippets.
		for (const change of item?.documentChanges ?? []) {
			if (ls.TextDocumentEdit.is(change)) {
				const uri = vs.Uri.parse(change.textDocument.uri);
				for (const edit of change.edits) {
					if ((edit as any).insertTextFormat === ls.InsertTextFormat.Snippet) {
						snippetTypes.add(`${fsPath(uri)}:${edit.newText}:${edit.range.start.line}:${edit.range.start.character}`);
					}
				}
			}
		}
		for (const uriString of Object.keys(item?.changes ?? {})) {
			const uri = vs.Uri.parse(uriString);
			for (const edit of item!.changes![uriString]) {
				if ((edit as any).insertTextFormat === ls.InsertTextFormat.Snippet) {
					snippetTypes.add(`${fsPath(uri)}:${edit.newText}:${edit.range.start.line}:${edit.range.start.character}`);
				}
			}
		}

		if (snippetTypes.size > 0) {
			for (const changeset of result.entries()) {
				const uri = changeset[0];
				const changes = changeset[1];
				for (const change of changes) {
					if (snippetTypes.has(`${fsPath(uri)}:${change.newText}:${change.range.start.line}:${change.range.start.character}`)) {
						(change as any).insertTextFormat = ls.InsertTextFormat.Snippet;
					}
				}
			}
		}

		return result;
	}

	async function asCodeAction(item: ls.CodeAction | undefined | null, token?: vs.CancellationToken): Promise<vs.CodeAction | undefined> {
		const result = (await originalAsCodeAction(item, token)) as vs.CodeAction | undefined;
		if (item?.edit !== undefined) {
			(result as any).edit = await asWorkspaceEdit(item.edit, token);
		}
		return result;
	}

	function asCodeActionResult(items: Array<ls.Command | ls.CodeAction>, token?: vs.CancellationToken): Promise<Array<vs.Command | vs.CodeAction>> {
		return Promise.all(items.map(async (item) => {
			if (ls.Command.is(item)) {
				return p2c.asCommand(item);
			} else {
				return asCodeAction(item, token);
			}
		}));
	}

	p2c.asWorkspaceEdit = asWorkspaceEdit;
	p2c.asCodeAction = asCodeAction;
	p2c.asCodeActionResult = asCodeActionResult;

	return client;
}

function spawnServer(logger: Logger, sdks: DartSdks, dartCapabilities: DartCapabilities, vmServicePort: number | undefined): Promise<StreamInfo> {
	// TODO: Replace with constructing an Analyzer that passes LSP flag (but still reads config
	// from paths etc) and provide it's process.
	const vmPath = path.join(sdks.dart, dartVMPath);
	const args = getAnalyzerArgs(logger, sdks, dartCapabilities, true, vmServicePort);

	logger.info(`Spawning ${vmPath} with args ${JSON.stringify(args)}`);
	const process = safeToolSpawn(undefined, vmPath, args);
	logger.info(`    PID: ${process.pid}`);

	const reader = process.stdout.pipe(new LoggingTransform(logger, "<=="));
	const writer = new LoggingTransform(logger, "==>");
	writer.pipe(process.stdin);

	process.stderr.on("data", (data) => logger.error(data.toString()));
	process.on("exit", (code, signal) => {
		if (code)
			reportAnalyzerTerminatedWithError();
	});

	return Promise.resolve({ reader, writer });
}

class LoggingTransform extends stream.Transform {
	constructor(private readonly logger: Logger, private readonly prefix: string, opts?: stream.TransformOptions) {
		super(opts);
	}
	public _transform(chunk: any, encoding: BufferEncoding, callback: () => void): void {
		this.logger.info(`${this.prefix} ${chunk}`);
		this.push(chunk, encoding);
		callback();
	}
}
