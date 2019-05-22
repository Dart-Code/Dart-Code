import { DebugSession, DebugSessionCustomEvent, TreeDataProvider, TreeItem } from "vscode";
import { TestStatus } from "./enums";

export interface ITestResultsProvider extends TreeDataProvider<ITestItemTreeItem> {
	handleDebugSessionCustomEvent(e: DebugSessionCustomEvent): void;
	handleDebugSessionEnd(session: DebugSession): void;
}

export interface ITestItemTreeItem extends TreeItem {
	status: TestStatus;
}
