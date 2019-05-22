import { DebugSession, DebugSessionCustomEvent, TreeDataProvider, TreeItem } from "vscode";
import { FlutterService, FlutterServiceExtension, TestStatus } from "./enums";

export interface ITestResultsProvider extends TreeDataProvider<ITestItemTreeItem> {
	handleDebugSessionEnd(session: DebugSession): void;
	handleDebugSessionCustomEvent(e: DebugSessionCustomEvent): void;
}

export interface ITestItemTreeItem extends TreeItem {
	status: TestStatus;
}

export interface DebugCommandHandler {
	flutterExtensions: {
		serviceIsRegistered(service: FlutterService): boolean;
		serviceExtensionIsLoaded(extension: FlutterServiceExtension): boolean;
	};
	handleDebugSessionStart(session: DebugSession): void;
	handleDebugSessionEnd(session: DebugSession): void;
	handleDebugSessionCustomEvent(e: DebugSessionCustomEvent): void;
}
