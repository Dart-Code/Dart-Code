import { BreakpointsChangeEvent, CancellationToken, DebugAdapterDescriptor, DebugConfiguration, DebugConfigurationProvider, DebugSession, DebugSessionCustomEvent, McpServerDefinitionProvider, OutputChannel, Progress, QuickPickItem, TestController, TestItem, TestRunRequest, TreeDataProvider, TreeItem, Uri } from "vscode";
import { DartVsCodeLaunchArgs } from "../../shared/debug/interfaces";
import * as lsp from "../analysis/lsp/custom_protocol";
import { Analyzer } from "../analyzer";
import { DartCapabilities } from "../capabilities/dart";
import { FlutterCapabilities } from "../capabilities/flutter";
import { DebuggerType, DebugOption, VersionStatus, VmService, VmServiceExtension } from "../enums";
import { WebClient } from "../fetch";
import { CustomScript, DartWorkspaceContext, FlutterProjectTemplate, GetSDKCommandConfig, GetSDKCommandResult, SpawnedProcess } from "../interfaces";
import { EmittingLogger } from "../logging";
import { RunProcessResult } from "../processes";
import { PubDeps } from "../pub/deps";
import { PackageMapLoader } from "../pub/package_map";
import { PackageCacheData, PathPubPackage, PickablePackage } from "../pub/pub_add";
import { DartToolingDaemon } from "../services/tooling_daemon";
import { TestSessionCoordinator } from "../test/coordinator";
import { CoverageParser } from "../test/coverage";
import { TestModel, TreeNode } from "../test/test_model";
import { PromiseCompleter } from "../utils";
import { FlutterDeviceManager } from "./device_manager";
import { PickableSetting } from "./input";
import { InteractiveRefactors } from "./interactive_refactors";
import { ProjectFinder } from "./utils";
import { Context } from "./workspace";

export class DartDebugSessionInformation {
	public readonly configuration: DebugConfiguration & DartVsCodeLaunchArgs;

	public observatoryUri?: string;

	/*
	* In some environments (for ex. g3), the VM Service/DDS could be running on
	* the end user machine (eg. Mac) while the extension host is an SSH remote
	* (eg. Linux).
	*
	* `vmServiceUri` indicates a URI that is accessible to the extension host.
	* `clientVmServiceUri` indicates a URI that is already accessible on the end
	* user machine without forwarding.
	*/
	public vmServiceUri?: string;
	public clientVmServiceUri?: string;
	public readonly sessionStart: Date = new Date();

	/// Whether the Flutter app has started (if appropriate).
	// TODO(dantup): Decide if we should always set this for Dart too?
	public hasStarted = false;
	public flutterMode: string | undefined;
	public flutterDeviceId: string | undefined;
	public supportsHotReload: boolean | undefined;
	public hasEnded = false;
	public progress: Record<string, ProgressMessage> = {};
	public readonly loadedServiceExtensions: VmServiceExtension[] = [];
	public readonly debuggerType: DebuggerType;
	public readonly projectRootPath: string | undefined;
	constructor(public readonly session: DebugSession) {
		const configuration = this.configuration = session.configuration as DebugConfiguration & DartVsCodeLaunchArgs;
		this.debuggerType = configuration.debuggerType as DebuggerType;
		this.projectRootPath = configuration.projectRootPath;
	}
}

export class ProgressMessage {
	private _isComplete = false;
	constructor(private readonly reporter: Progress<{ message?: string }>, private readonly completer: PromiseCompleter<void>) { }

	public get isComplete(): boolean {
		return this._isComplete;
	}

	public report(message: string): void {
		this.reporter.report({ message });
	}

	public complete(): void {
		this._isComplete = true;
		this.completer.resolve();
	}
}

export interface DebugCommandHandler {
	applyNewDebugOption(): void;
	currentDebugOption: DebugOption;
	getDebugSession(): Promise<{ session: DebugSession } | undefined>;
	handleBreakpointChange(e: BreakpointsChangeEvent): void;
	hasPromptedAboutDebugSettings: boolean;
	vmServices: {
		serviceIsRegistered(service: VmService): boolean;
		serviceExtensionIsLoaded(extension: VmServiceExtension): boolean;
		getCurrentServiceExtensionValue(session: unknown, id: VmServiceExtension): Promise<unknown>;
		sendExtensionValue(session: unknown, id: VmServiceExtension, value: unknown): Promise<void>;
	};
	handleDebugSessionStart(session: DebugSession): DartDebugSessionInformation | undefined;
	handleDebugSessionEnd(session: DebugSession): void;
	handleDebugSessionCustomEvent(e: DebugSessionCustomEvent): void;
}

export interface FlutterCommandHandler {
	runFlutterInFolder(folder: string, args: string[], packageOrFolderDisplayName: string | undefined, alwaysShowOutput: boolean, operationProgress?: OperationProgress, customScript?: CustomScript): Promise<RunProcessResult | undefined>;
	writeDefaultLaunchJson(projectPath: string): void;
	getFlutterTemplates(): Array<QuickPickItem & { template?: FlutterProjectTemplate }>;
	getCurrentFlutterCreateSettings(): PickableSetting[];
	promptForNameWithSettings(defaultName: string, folderPath: string): Promise<string | undefined>;
}

export interface InternalExtensionApi {
	addDependencyCommand: {
		cache: PackageCacheData | undefined;
		getPackageEntries(userInput?: string): PickablePackage[];
		runFlutter(args: string[], selection: Uri | undefined, alwaysShowOutput: boolean, operationProgress?: OperationProgress, options?: { onlyShowWorkspaceRoots?: boolean; }): Promise<RunProcessResult | undefined>;
		runPub(args: string[], selection: Uri | undefined, alwaysShowOutput: boolean, operationProgress?: OperationProgress, options?: { onlyShowWorkspaceRoots?: boolean; }): Promise<RunProcessResult | undefined>;
		promptForGitRef(): Promise<string | undefined>;
		promptForGitUrl(): PromiseLike<string | undefined>;
		promptForGitPath(): PromiseLike<string | undefined>;
		promptForPackageName(name: string): Promise<string | undefined>;
		promptForPackageInfo(): Promise<string | PickablePackage | undefined>;
		promptForPathPackageInfo(packagePath?: string): Promise<PathPubPackage | undefined>;
	},
	clearCaches: () => void;
	context: Context;
	currentAnalysis: () => Promise<void>;
	interactiveRefactors: InteractiveRefactors | undefined;
	isInTestFileThatHasImplementation: boolean;
	isInImplementationFileThatCanHaveTest: boolean;
	dartCapabilities: DartCapabilities;
	debugAdapterDescriptorFactory: { descriptorForType(debuggerType: DebuggerType): DebugAdapterDescriptor },
	debugCommands: DebugCommandHandler;
	devTools: {
		start(): Promise<string | undefined>;
		devtoolsUrl: Thenable<string> | undefined;
		promptForExtensionRecommendations(): Promise<void>;
	};
	trackerFactories: any;
	debugProvider: DebugConfigurationProvider;
	debugSessions: DartDebugSessionInformation[];
	deviceManager: FlutterDeviceManager | undefined;
	envUtils: {
		openInBrowser(url: string): Promise<boolean>;
	};
	fileTracker: {
		getOutlineFor(uri: Uri): lsp.Outline | undefined;
		getFlutterOutlineFor?: (uri: Uri) => lsp.FlutterOutline | undefined;
	};
	flutterCapabilities: FlutterCapabilities;
	flutterCommands: FlutterCommandHandler;
	flutterOutlineTreeProvider: TreeDataProvider<TreeItem> | undefined;
	getLogHeader: () => string;
	getOutputChannel: (name: string) => OutputChannel;
	getOutputChannelNames: () => string[];
	getToolEnv: () => Record<string, string>;
	initialAnalysis: Promise<void>;
	logger: EmittingLogger;
	analyzer: Analyzer;
	nextAnalysis: () => Promise<void>;
	packageCommands: {
		fetchPackagesOrPrompt(uri: Uri | undefined, options?: { alwaysPrompt?: boolean, upgradeOnSdkChange?: boolean }): Promise<void>;
		getPackagesForUri(uri: Uri, operationProgress?: OperationProgress): Promise<RunProcessResult | undefined>;
		upgradePackagesForUri(uri: Uri, operationProgress?: OperationProgress): Promise<RunProcessResult | undefined>;
	},
	packagesTreeProvider: TreeDataProvider<TreeItem> & { deps?: PubDeps, packageMapLoader?: PackageMapLoader, projectFinder?: ProjectFinder };
	pubGlobal: {
		installIfRequired(options: { packageName?: string; packageID: string; moreInfoLink?: string; requiredVersion?: string; customActivateScript?: CustomScript; updateSilently?: boolean; silent?: boolean; }): Promise<string | undefined>;
		checkVersionStatus(packageID: string, installedVersion: string | undefined, requiredVersion?: string): Promise<VersionStatus>;
		getInstalledVersion(packageName: string, packageID: string): Promise<string | undefined>;
		uninstall(packageID: string): Promise<void>;
	};
	safeToolSpawn: (workingDirectory: string | undefined, binPath: string, args: string[], envOverrides?: Record<string, string | undefined>) => SpawnedProcess;
	testController: {
		controller: TestController;
		runTests(debug: boolean, includeCoverage: boolean, request: TestRunRequest, token: CancellationToken): Promise<void>;
		getLatestData(test: TestItem): TreeNode | undefined,
		handleDebugSessionEnd(e: DebugSession): void,
		coverageParser: CoverageParser,
	} | undefined;
	testCoordinator: TestSessionCoordinator;
	testDiscoverer: { forceUpdate(uri: Uri): void, ensureSuitesDiscovered(): Promise<void>, testDiscoveryPerformed: Promise<void> | undefined },
	testModel: TestModel;
	toolingDaemon: DartToolingDaemon | undefined;
	webClient: WebClient;
	workspaceContext: DartWorkspaceContext;
	// Only available in test runs.
	mcpServerProvider?: McpServerDefinitionProvider;
	sdkUtils?: {
		runCustomGetSDKCommand(command: GetSDKCommandConfig, sdkConfigName: "dart.getDartSdkCommand" | "dart.getFlutterSdkCommand", isWorkspaceSetting: boolean): Promise<GetSDKCommandResult>
	},
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

export interface OperationProgress {
	progressReporter: Progress<{ message?: string; increment?: number }>;
	cancellationToken: CancellationToken;
}
