import { CompletionItemProvider, DebugConfigurationProvider, DebugSession, DebugSessionCustomEvent, DefinitionProvider, ReferenceProvider, RenameProvider, TreeDataProvider, TreeItem, Uri } from "vscode";
import { Outline } from "../../extension/analysis/analysis_server_types";
import { LogCategory, LogSeverity, TestStatus, VersionStatus } from "../enums";
import { DebugCommandHandler } from "../interfaces";
import { WorkspaceContext } from "../workspace";
import { Context } from "./workspace";

export interface InternalExtensionApi {
	analyzerCapabilities: {
		supportsGetSignature: boolean;
		isDart2: boolean;
		supportsAvailableSuggestions: boolean;
		version: string;
	};
	cancelAllAnalysisRequests: () => void;
	completionItemProvider: CompletionItemProvider;
	context: Context;
	currentAnalysis: () => Promise<void>;
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
	initialAnalysis: Promise<void>;
	log: (message: string, severity?: LogSeverity, category?: LogCategory) => void;
	nextAnalysis: () => Promise<void>;
	packagesTreeProvider: TreeDataProvider<TreeItem>;
	pubGlobal: {
		promptToInstallIfRequired(packageName: string, packageID: string, moreInfoLink?: string, requiredVersion?: string, autoUpdate?: boolean): Promise<boolean>;
		getInstalledStatus(packageName: string, packageID: string, requiredVersion?: string): Promise<VersionStatus>;
		uninstall(packageID: string): Promise<void>;
	};
	reanalyze: () => void;
	referenceProvider: ReferenceProvider & DefinitionProvider;
	renameProvider: RenameProvider;
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
