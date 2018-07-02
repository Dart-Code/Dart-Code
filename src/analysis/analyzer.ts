import * as vs from "vscode";
import { config } from "../config";
import { PromiseCompleter } from "../debug/utils";
import { extensionVersion, reloadExtension, versionIsAtLeast } from "../utils";
import { logError } from "../utils/log";
import * as as from "./analysis_server_types";
import { AnalyzerGen } from "./analyzer_gen";

export class AnalyzerCapabilities {
	public static get empty() { return new AnalyzerCapabilities("0.0.0"); }

	public version: string;

	constructor(analyzerVersion: string) {
		this.version = analyzerVersion;
	}

	get mayRequiresPackageFolderWorkaround() { return !versionIsAtLeast(this.version, "1.20.1"); }
	get hasCompleteStatementFix() { return versionIsAtLeast(this.version, "1.20.2"); }
	get supportsAnalyzingHtmlFiles() { return versionIsAtLeast(this.version, "1.18.5"); }
	get supportsPriorityFilesOutsideAnalysisRoots() { return versionIsAtLeast(this.version, "1.18.2"); }
	get supportsDiagnostics() { return versionIsAtLeast(this.version, "1.18.1"); }
	get supportsClosingLabels() { return versionIsAtLeast(this.version, "1.18.4"); }
	get supportsCustomFolding() { return versionIsAtLeast(this.version, "1.20.3"); }
	get supportsGetDeclerations() { return versionIsAtLeast(this.version, "1.18.7"); }
	get supportsGetDeclerationsForFile() { return versionIsAtLeast(this.version, "1.19.0"); }
	get isDart2() { return versionIsAtLeast(this.version, "1.19.0"); }
	get expressionEvaluationIsBroken() { return !versionIsAtLeast(this.version, "1.20.3"); }

	// TODO: Remove this after next beta update, it's to stop tests failing on
	// "stable"(beta) builds because of an upcoming change.
	get hasUpdatedWidgetSnippets() { return versionIsAtLeast(this.version, "1.20.1"); }
}

export class Analyzer extends AnalyzerGen {
	private lastDiagnostics: as.ContextData[];
	private launchArgs: string[];
	private version: string;
	private isAnalyzing = false;
	private currentAnalysisCompleter: PromiseCompleter<void>;
	public capabilities: AnalyzerCapabilities = AnalyzerCapabilities.empty;

	constructor(dartVMPath: string, analyzerPath: string) {
		super(() => config.analyzerLogFile);

		let args = [];

		// Optionally start Observatory for the analyzer.
		if (config.analyzerObservatoryPort)
			args.push(`--observe=${config.analyzerObservatoryPort}`);

		args.push(analyzerPath);

		// Optionally start the analyzer's diagnostic web server on the given port.
		if (config.analyzerDiagnosticsPort)
			args.push(`--port=${config.analyzerDiagnosticsPort}`);

		// Add info about the extension that will be collected for crash reports etc.
		args.push(`--client-id=Dart-Code.dart-code`);
		args.push(`--client-version=${extensionVersion}`);

		// The analysis server supports a verbose instrumentation log file.
		if (config.analyzerInstrumentationLogFile)
			args.push(`--instrumentation-log-file=${config.analyzerInstrumentationLogFile}`);

		// Allow arbitrary args to be passed to the analysis server.
		if (config.analyzerAdditionalArgs)
			args = args.concat(config.analyzerAdditionalArgs);

		this.launchArgs = args;

		// Hook error subscriptions so we can try and get diagnostic info if this happens.
		this.registerForServerError((e) => this.requestDiagnosticsUpdate());
		this.registerForRequestError((e) => this.requestDiagnosticsUpdate());

		// Register for version.
		this.registerForServerConnected((e) => { this.version = e.version; this.capabilities.version = this.version; });

		this.createProcess(undefined, dartVMPath, args);

		this.serverSetSubscriptions({
			subscriptions: ["STATUS"],
		});

		this.registerForServerStatus((n) => {
			if (n.analysis) {
				if (n.analysis.isAnalyzing) {
					this.isAnalyzing = true;
				} else {
					this.isAnalyzing = false;
					if (this.currentAnalysisCompleter) {
						this.currentAnalysisCompleter.resolve();
						this.currentAnalysisCompleter = null;
					}
				}
			}
		});
	}

	private resolvedPromise = Promise.resolve();
	public get currentAnalysis(): Promise<void> {
		// If we're analyzing and don't already have a completer, set one up
		// for the analyzer to signal when done. We do this here so it's lazy, so
		// we're not needlessly creating them on every analysis (which can be on
		// every key press).
		if (this.isAnalyzing && !this.currentAnalysisCompleter) {
			this.currentAnalysisCompleter = new PromiseCompleter<void>();
		}
		return this.isAnalyzing
			? this.currentAnalysisCompleter.promise
			: this.resolvedPromise;
	}

	protected sendMessage<T>(json: string) {
		try {
			super.sendMessage(json);
		} catch (e) {
			const message = this.version
				? "The Dart Analyzer has terminated."
				: "The Dart Analyzer could not be started. Please set the `dart.analyzerLog` option and review the log file for errors.";
			reloadExtension(message);
			throw e;
		}
	}

	protected shouldHandleMessage(message: string): boolean {
		// This will include things like Observatory output and some analyzer logging code.
		return !message.startsWith("--- ") && !message.startsWith("+++ ");
	}

	private async requestDiagnosticsUpdate() {
		this.lastDiagnostics = null;

		if (!this.capabilities.supportsDiagnostics)
			return;

		this.lastDiagnostics = (await this.diagnosticGetDiagnostics()).contexts;
	}

	public getLastDiagnostics(): as.ContextData[] {
		return this.lastDiagnostics;
	}

	public getAnalyzerLaunchArgs(): string[] {
		return this.launchArgs;
	}

	public forceNotificationsFor(file: string) {
		// Send a dummy edit (https://github.com/dart-lang/sdk/issues/30238)
		const files: { [key: string]: as.ChangeContentOverlay } = {};
		files[file] = {
			edits: [{ offset: 0, length: 0, replacement: "", id: "" }],
			type: "change",
		};
		this.analysisUpdateContent({ files });
	}

	// Wraps completionGetSuggestions to return the final result automatically in the original promise
	// to avoid race conditions.
	// https://github.com/Dart-Code/Dart-Code/issues/471
	public completionGetSuggestionsResults(request: as.CompletionGetSuggestionsRequest): Promise<as.CompletionResultsNotification> {
		return this.requestWithStreamedResults(
			() => this.completionGetSuggestions(request),
			this.registerForCompletionResults,
		);
	}

	// Wraps searchFindElementReferences to return the final result automatically in the original promise
	// to avoid race conditions.
	// https://github.com/Dart-Code/Dart-Code/issues/471
	public searchFindElementReferencesResults(request: as.SearchFindElementReferencesRequest): Promise<as.SearchResultsNotification> {
		return this.requestWithStreamedResults(
			() => this.searchFindElementReferences(request),
			this.registerForSearchResults,
		);
	}

	// Wraps searchFindTopLevelDeclarations to return the final result automatically in the original promise
	// to avoid race conditions.
	// https://github.com/Dart-Code/Dart-Code/issues/471
	public searchFindTopLevelDeclarationsResults(request: as.SearchFindTopLevelDeclarationsRequest): Promise<as.SearchResultsNotification> {
		return this.requestWithStreamedResults(
			() => this.searchFindTopLevelDeclarations(request),
			this.registerForSearchResults,
		);
	}

	// Wraps searchFindMemberDeclarations to return the final result automatically in the original promise
	// to avoid race conditions.
	// https://github.com/Dart-Code/Dart-Code/issues/471
	public searchFindMemberDeclarationsResults(request: as.SearchFindMemberDeclarationsRequest): Promise<as.SearchResultsNotification> {
		return this.requestWithStreamedResults(
			() => this.searchFindMemberDeclarations(request),
			this.registerForSearchResults,
		);
	}

	// We need to subscribe before we send the request to avoid races in registering
	// for results (see https://github.com/Dart-Code/Dart-Code/issues/471).
	// Since we don't have the ID yet, we'll have to buffer them for the duration
	// and check inside the buffer when we get the ID back.
	private requestWithStreamedResults<TResponse extends { id: string; isLast: boolean }>(
		sendRequest: () => Thenable<{ id?: string }>,
		registerForResults: (subscriber: (notification: TResponse) => void) => vs.Disposable,
	): Promise<TResponse> {
		return new Promise<TResponse>((resolve, reject) => {
			const buffer: TResponse[] = []; // Buffer to store results that come in before we're ready.
			let searchResultsID: string = null; // ID that'll be set once we get it back.

			const disposable = registerForResults.bind(this)((notification: TResponse) => {
				// If we know our ID and this is it, and it's the last result, then resolve.
				if (searchResultsID && notification.id === searchResultsID && notification.isLast) {
					disposable.dispose();
					resolve(notification);
				} else if (!searchResultsID && notification.isLast) // Otherwise if we didn't know our ID and this might be what we want, stash it.
					buffer.push(notification);
			});

			// Now we have the above handler set up, send the actual request.
			sendRequest.bind(this)().then((resp: { id?: string }) => {
				if (!resp.id) {
					disposable.dispose();
					reject();
				}
				// When the ID comes back, stash it...
				searchResultsID = resp.id;
				// And also check the buffer.
				const result = buffer.find((b) => b.id === searchResultsID);
				if (result) {
					disposable.dispose();
					resolve(result);
				}
			}, () => reject());
		});
	}
}

export function getSymbolKindForElementKind(kind: as.ElementKind): vs.SymbolKind {
	switch (kind) {
		case "CLASS":
		case "CLASS_TYPE_ALIAS":
			return vs.SymbolKind.Class;
		case "COMPILATION_UNIT":
			return vs.SymbolKind.Module;
		case "CONSTRUCTOR":
		case "CONSTRUCTOR_INVOCATION":
			return vs.SymbolKind.Constructor;
		case "ENUM":
		case "ENUM_CONSTANT":
			return vs.SymbolKind.Enum;
		case "FIELD":
			return vs.SymbolKind.Field;
		case "FILE":
			return vs.SymbolKind.File;
		case "FUNCTION":
		case "FUNCTION_INVOCATION":
		case "FUNCTION_TYPE_ALIAS":
			return vs.SymbolKind.Function;
		case "GETTER":
			return vs.SymbolKind.Property;
		case "LABEL":
			return vs.SymbolKind.Module;
		case "LIBRARY":
			return vs.SymbolKind.Namespace;
		case "LOCAL_VARIABLE":
			return vs.SymbolKind.Variable;
		case "METHOD":
			return vs.SymbolKind.Method;
		case "PARAMETER":
		case "PREFIX":
			return vs.SymbolKind.Variable;
		case "SETTER":
			return vs.SymbolKind.Property;
		case "TOP_LEVEL_VARIABLE":
		case "TYPE_PARAMETER":
			return vs.SymbolKind.Variable;
		case "UNIT_TEST_GROUP":
			return vs.SymbolKind.Module;
		case "UNIT_TEST_TEST":
			return vs.SymbolKind.Method;
		case "UNKNOWN":
			return vs.SymbolKind.Object;
		default:
			logError(`Unknown kind: ${kind}`);
			return vs.SymbolKind.Object;
	}
}
