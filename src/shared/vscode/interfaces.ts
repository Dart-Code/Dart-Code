import { CancellationToken, CompletionItem, CompletionItemProvider, DebugAdapterDescriptor, DebugConfigurationProvider, DebugSession, DebugSessionCustomEvent, MarkdownString, OutputChannel, RenameProvider, TestController, TestItem, TestRunRequest, TextDocument, TreeDataProvider, TreeItem, Uri } from "vscode";
import * as lsp from "../analysis/lsp/custom_protocol";
import { AvailableSuggestion, FlutterOutline, Outline } from "../analysis_server_types";
import { Analyzer } from "../analyzer";
import { DartCapabilities } from "../capabilities/dart";
import { FlutterCapabilities } from "../capabilities/flutter";
import { DebuggerType, VersionStatus, VmService, VmServiceExtension } from "../enums";
import { WebClient } from "../fetch";
import { CustomScript, DartWorkspaceContext, SpawnedProcess } from "../interfaces";
import { EmittingLogger } from "../logging";
import { DartToolingDaemon } from "../services/tooling_daemon";
import { TestSessionCoordinator } from "../test/coordinator";
import { TestModel, TreeNode } from "../test/test_model";
import { FlutterDeviceManager } from "./device_manager";
import { InteractiveRefactors } from "./interactive_refactors";
import { Context } from "./workspace";

export interface DebugCommandHandler {
	vmServices: {
		serviceIsRegistered(service: VmService): boolean;
		serviceExtensionIsLoaded(extension: VmServiceExtension): boolean;
		getCurrentServiceExtensionValue(session: unknown, id: VmServiceExtension): Promise<unknown>;
		sendExtensionValue(session: unknown, id: VmServiceExtension, value: unknown): Promise<void>;
	};
	handleDebugSessionStart(session: DebugSession): void;
	handleDebugSessionEnd(session: DebugSession): void;
	handleDebugSessionCustomEvent(e: DebugSessionCustomEvent): void;
}

export interface InternalExtensionApi {
	addDependencyCommand: any,
	analyzerCapabilities?: {
		supportsGetSignature: boolean;
		supportsAvailableSuggestions: boolean;
		supportsIncludedImports: boolean;
	};
	cancelAllAnalysisRequests: () => void;
	completionItemProvider: CompletionItemProvider;
	context: Context;
	currentAnalysis: () => Promise<void>;
	interactiveRefactors: InteractiveRefactors | undefined;
	isInTestFileThatHasImplementation: boolean;
	isInImplementationFileThatCanHaveTest: boolean;
	isLsp: boolean;
	dartCapabilities: DartCapabilities;
	debugAdapterDescriptorFactory: { descriptorForType(debuggerType: DebuggerType): DebugAdapterDescriptor },
	debugCommands: DebugCommandHandler;
	devTools: {
		start(): Promise<string | undefined>;
		devtoolsUrl: Thenable<string> | undefined;
		promptForExtensionRecommendations(allowList: string[]): Promise<void>;
	};
	trackerFactories: any;
	debugProvider: DebugConfigurationProvider;
	debugSessions: Array<{ session: { name?: string }, loadedServiceExtensions: VmServiceExtension[] }>;
	deviceManager: FlutterDeviceManager | undefined;
	envUtils: {
		openInBrowser(url: string): Promise<boolean>;
	};
	fileTracker: {
		getOutlineFor(file: Uri): Outline | lsp.Outline | undefined;
		getFlutterOutlineFor?: (file: Uri) => FlutterOutline | lsp.FlutterOutline | undefined;
		getLastPriorityFiles?: () => string[];
		getLastSubscribedFiles?: () => string[];
	};
	flutterCapabilities: FlutterCapabilities;
	flutterOutlineTreeProvider: TreeDataProvider<TreeNode> | undefined;
	getLogHeader: () => string;
	getOutputChannel: (name: string) => OutputChannel;
	getToolEnv: () => any;
	initialAnalysis: Promise<void>;
	logger: EmittingLogger;
	analyzer: Analyzer;
	nextAnalysis: () => Promise<void>;
	packagesTreeProvider: TreeDataProvider<TreeItem>;
	pubGlobal: {
		installIfRequired(options: { packageName?: string; packageID: string; moreInfoLink?: string; requiredVersion?: string; customActivateScript?: CustomScript; updateSilently?: boolean; silent?: boolean; }): Promise<string | undefined>;
		checkVersionStatus(packageID: string, installedVersion: string | undefined, requiredVersion?: string): Promise<VersionStatus>;
		getInstalledVersion(packageName: string, packageID: string): Promise<string | undefined>;
		uninstall(packageID: string): Promise<void>;
	};
	renameProvider: RenameProvider | undefined;
	safeToolSpawn: (workingDirectory: string | undefined, binPath: string, args: string[], envOverrides?: { [key: string]: string | undefined }) => SpawnedProcess;
	testController: {
		controller: TestController;
		runTests(debug: boolean, request: TestRunRequest, token: CancellationToken): Promise<void>;
		getLatestData(test: TestItem): TreeNode | undefined,
		handleDebugSessionEnd(e: DebugSession): void,
		discoverer?: { ensureSuitesDiscovered(): Promise<void> }
	};
	testCoordinator: TestSessionCoordinator;
	testDiscoverer: { forceUpdate(uri: Uri): void, ensureSuitesDiscovered(): Promise<void>, testDiscoveryPerformed: Promise<void> | undefined } | undefined,
	testModel: TestModel;
	toolingDaemon: DartToolingDaemon;
	webClient: WebClient;
	workspaceContext: DartWorkspaceContext;
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
