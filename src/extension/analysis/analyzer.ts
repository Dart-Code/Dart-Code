import * as vs from "vscode";
import { PromiseCompleter } from "../../shared/utils";
import { config } from "../config";
import { LogCategory } from "../debug/utils";
import { escapeShell, extensionVersion, reloadExtension, versionIsAtLeast } from "../utils";
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
	// 1.26.0 is stable Flutter at time of writing. Unclear what version had Outline, but
	// we don't need to support older.
	get supportsFlutterOutline() { return versionIsAtLeast(this.version, "1.26.0"); }
	get supportsGetDeclerations() { return versionIsAtLeast(this.version, "1.18.7"); }
	get supportsGetDeclerationsForFile() { return versionIsAtLeast(this.version, "1.19.0"); }
	get supportsGetSignature() { return versionIsAtLeast(this.version, "1.20.5"); }
	get isDart2() { return versionIsAtLeast(this.version, "1.19.0"); }
	get supportsAvailableSuggestions() { return versionIsAtLeast(this.version, "1.26.0"); }
}

export class Analyzer extends AnalyzerGen {
	private lastDiagnostics?: as.ContextData[];
	private launchArgs: string[];
	private version?: string;
	private isAnalyzing = false;
	private currentAnalysisCompleter?: PromiseCompleter<void>;
	public capabilities: AnalyzerCapabilities = AnalyzerCapabilities.empty;

	constructor(dartVMPath: string, analyzerPath: string) {
		super(() => config.analyzerLogFile, config.maxLogLineLength);

		let analyzerArgs = [];

		// Optionally start Observatory for the analyzer.
		if (config.analyzerObservatoryPort)
			analyzerArgs.push(`--enable-vm-service=${config.analyzerObservatoryPort}`);

		analyzerArgs.push(analyzerPath);

		// Optionally start the analyzer's diagnostic web server on the given port.
		if (config.analyzerDiagnosticsPort)
			analyzerArgs.push(`--port=${config.analyzerDiagnosticsPort}`);

		// Add info about the extension that will be collected for crash reports etc.
		analyzerArgs.push(`--client-id=Dart-Code.dart-code`);
		analyzerArgs.push(`--client-version=${extensionVersion}`);

		// The analysis server supports a verbose instrumentation log file.
		if (config.analyzerInstrumentationLogFile)
			analyzerArgs.push(`--instrumentation-log-file=${config.analyzerInstrumentationLogFile}`);

		// Allow arbitrary args to be passed to the analysis server.
		if (config.analyzerAdditionalArgs)
			analyzerArgs = analyzerArgs.concat(config.analyzerAdditionalArgs);

		this.launchArgs = analyzerArgs;

		// Hook error subscriptions so we can try and get diagnostic info if this happens.
		this.registerForServerError((e) => this.requestDiagnosticsUpdate());
		this.registerForRequestError((e) => this.requestDiagnosticsUpdate());

		// Register for version.
		this.registerForServerConnected((e) => { this.version = e.version; this.capabilities.version = this.version; });

		let binaryPath = dartVMPath;
		let processArgs = analyzerArgs.slice();

		// Since we communicate with the analysis server over STDOUT/STDIN, it is trivial for us
		// to support launching it on a remote machine over SSH. This can be useful if the codebase
		// is being modified remotely over SSHFS, and running the analysis server locally would
		// result in excessive file reading over SSHFS.
		if (config.analyzerSshHost) {
			binaryPath = "ssh";
			processArgs.unshift(dartVMPath);
			processArgs = [
				// SSH quiet mode, which prevents SSH from interfering with the STDOUT/STDIN communication
				// with the analysis server.
				"-q",
				config.analyzerSshHost,
				escapeShell(processArgs),
			];
		}

		this.createProcess(undefined, binaryPath, processArgs);

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
						this.currentAnalysisCompleter = undefined;
					}
				}
			}
		});
	}

	private resolvedPromise = Promise.resolve();
	public get currentAnalysis(): Promise<void> {
		if (!this.isAnalyzing)
			return this.resolvedPromise;

		if (!this.currentAnalysisCompleter)
			this.currentAnalysisCompleter = new PromiseCompleter<void>();
		return this.currentAnalysisCompleter.promise;
	}

	protected sendMessage<T>(json: string) {
		try {
			super.sendMessage(json);
		} catch (e) {
			const message = this.version
				? "The Dart Analyzer has terminated."
				: "The Dart Analyzer could not be started.";
			reloadExtension(message, undefined, true);
			throw e;
		}
	}

	protected shouldHandleMessage(message: string): boolean {
		// This will include things like Observatory output and some analyzer logging code.
		return !message.startsWith("--- ")
			&& !message.startsWith("+++ ")
			&& !message.startsWith("Observatory listening on")
			&& !message.startsWith("Observatory server");
	}

	private async requestDiagnosticsUpdate() {
		this.lastDiagnostics = undefined;

		if (!this.capabilities.supportsDiagnostics)
			return;

		this.lastDiagnostics = (await this.diagnosticGetDiagnostics()).contexts;
	}

	public getLastDiagnostics(): as.ContextData[] | undefined {
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
			let searchResultsID: string | undefined; // ID that'll be set once we get it back.

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
		case "MIXIN":
			return vs.SymbolKind.Class;
		case "COMPILATION_UNIT":
			return vs.SymbolKind.Module;
		case "CONSTRUCTOR":
		case "CONSTRUCTOR_INVOCATION":
			return vs.SymbolKind.Constructor;
		case "ENUM":
			return vs.SymbolKind.Enum;
		case "ENUM_CONSTANT":
			return vs.SymbolKind.EnumMember;
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
			logError(`Unknown kind: ${kind}`, LogCategory.Analyzer);
			return vs.SymbolKind.Object;
	}
}
