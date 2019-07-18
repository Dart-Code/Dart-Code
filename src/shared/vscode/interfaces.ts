import * as child_process from "child_process";
import { CompletionItem, CompletionItemProvider, DebugConfigurationProvider, DebugSession, DebugSessionCustomEvent, MarkdownString, RenameProvider, TextDocument, TreeDataProvider, TreeItem, Uri } from "vscode";
import { AvailableSuggestion, FlutterOutline, Outline } from "../analysis_server_types";
import { FlutterService, FlutterServiceExtension, TestStatus, VersionStatus } from "../enums";
import { EmittingLogger } from "../logging";
import { WorkspaceContext } from "../workspace";
import { Context } from "./workspace";

export interface DebugCommandHandler {
	flutterExtensions: {
		serviceIsRegistered(service: FlutterService): boolean;
		serviceExtensionIsLoaded(extension: FlutterServiceExtension): boolean;
	};
	handleDebugSessionStart(session: DebugSession): void;
	handleDebugSessionEnd(session: DebugSession): void;
	handleDebugSessionCustomEvent(e: DebugSessionCustomEvent): void;
}

export interface InternalExtensionApi {
	analyzerCapabilities: {
		supportsGetSignature: boolean;
		isDart2: boolean;
		hasNewSignatureFormat: boolean;
		hasNewHoverLibraryFormat: boolean;
		supportsAvailableSuggestions: boolean;
		supportsIncludedImports: boolean;
		version: string;
	};
	cancelAllAnalysisRequests: () => void;
	completionItemProvider: CompletionItemProvider;
	context: Context;
	currentAnalysis: () => Promise<void>;
	cursorIsInTest: boolean;
	dartCapabilities: {
		supportsDevTools: boolean;
		includesSourceForSdkLibs: boolean;
		handlesBreakpointsInPartFiles: boolean;
		supportsDisableServiceTokens: boolean;
	};
	debugCommands: DebugCommandHandler;
	debugProvider: DebugConfigurationProvider;
	fileTracker: {
		getOutlineFor(file: Uri): Outline | undefined;
		getFlutterOutlineFor(file: Uri): FlutterOutline | undefined;
		getLastPriorityFiles(): string[];
		getLastSubscribedFiles(): string[];
	};
	flutterCapabilities: {
		supportsPidFileForMachine: boolean;
		supportsMultipleSamplesPerElement: boolean;
		supportsDevTools: boolean;
		hasTestGroupFix: boolean;
		hasEvictBug: boolean;
		webSupportsDebugging: boolean;
	};
	flutterOutlineTreeProvider: TreeDataProvider<TreeItem> | undefined;
	getLogHeader: () => string;
	initialAnalysis: Promise<void>;
	logger: EmittingLogger;
	nextAnalysis: () => Promise<void>;
	packagesTreeProvider: TreeDataProvider<TreeItem>;
	pubGlobal: {
		promptToInstallIfRequired(packageName: string, packageID: string, moreInfoLink?: string, requiredVersion?: string, autoUpdate?: boolean): Promise<boolean>;
		getInstalledStatus(packageName: string, packageID: string, requiredVersion?: string): Promise<VersionStatus>;
		uninstall(packageID: string): Promise<void>;
	};
	reanalyze: () => void;
	renameProvider: RenameProvider;
	safeSpawn: (workingDirectory: string | undefined, binPath: string, args: string[], envOverrides?: any) => child_process.ChildProcess;
	testTreeProvider: TestResultsProvider;
	workspaceContext: WorkspaceContext;
}

export interface TestResultsProvider extends TreeDataProvider<TestItemTreeItem> {
	handleDebugSessionEnd(session: DebugSession): void;
	handleDebugSessionCustomEvent(e: DebugSessionCustomEvent): void;
}

export interface TestItemTreeItem extends TreeItem {
	status: TestStatus;
}

export interface DelayedCompletionItem extends LazyCompletionItem {
	autoImportUri: string;
	document: TextDocument;
	enableCommitCharacters: boolean;
	filePath: string;
	insertArgumentPlaceholders: boolean;
	nextCharacter: string;
	offset: number;
	relevance: number;
	replacementLength: number;
	replacementOffset: number;
	suggestion: AvailableSuggestion;
	suggestionSetID: number;
}

// To avoid sending back huge docs for every completion item, we stash some data
// in our own fields (which won't serialise) and then restore them in resolve()
// on an individual completion basis.
export interface LazyCompletionItem extends CompletionItem {
	// tslint:disable-next-line: variable-name
	_documentation?: string | MarkdownString;
}

export interface FlutterSampleSnippet {
	readonly sourcePath: string;
	readonly sourceLine: number;
	readonly package: string;
	readonly library: string;
	readonly element: string;
	readonly id: string;
	readonly file: string;
	readonly description: string;
}
