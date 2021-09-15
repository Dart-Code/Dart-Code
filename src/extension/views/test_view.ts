import * as path from "path";
import * as vs from "vscode";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { DART_TEST_CAN_RUN_SKIPPED_CONTEXT, DART_TEST_CONTAINER_NODE_WITH_FAILURES_CONTEXT, DART_TEST_CONTAINER_NODE_WITH_SKIPS_CONTEXT, DART_TEST_GROUP_NODE_CONTEXT, DART_TEST_SUITE_NODE_CONTEXT, DART_TEST_TEST_NODE_CONTEXT } from "../../shared/constants";
import { TestStatus } from "../../shared/enums";
import { GroupNode, SuiteNode, TestContainerNode, TestModel, TestNode, TreeNode } from "../../shared/test/test_model";
import { ErrorNotification, PrintNotification } from "../../shared/test_protocol";
import { disposeAll } from "../../shared/utils";
import { brightRed, yellow } from "../../shared/utils/colors";
import { extensionPath } from "../../shared/vscode/extension_utils";
import { config } from "../config";
import { writeToPseudoTerminal } from "../utils/vscode/terminals";

export class TestResultsProvider implements vs.Disposable, vs.TreeDataProvider<TreeNode> {
	private disposables: vs.Disposable[] = [];
	private onDidChangeTreeDataEmitter: vs.EventEmitter<TreeNode | undefined> = new vs.EventEmitter<TreeNode | undefined>();
	public readonly onDidChangeTreeData: vs.Event<TreeNode | undefined> = this.onDidChangeTreeDataEmitter.event;
	private currentTestTerminal: [vs.Terminal, vs.EventEmitter<string>] | undefined;
	private readonly treeItemBuilder: TreeItemBuilder;

	constructor(private readonly data: TestModel, readonly flutterCapabilities: FlutterCapabilities) {
		this.treeItemBuilder = new TreeItemBuilder(flutterCapabilities);
		this.disposables.push(data.onDidChangeTreeData.listen((node) => this.onDidChangeTreeDataEmitter.fire(node)));
		this.disposables.push(vs.workspace.onDidChangeConfiguration((e) => this.handleConfigChange(e)));

		this.disposables.push(vs.commands.registerCommand("_dart.toggleSkippedTestVisibilityOff", () => config.setShowSkippedTests(false)));
		this.disposables.push(vs.commands.registerCommand("_dart.toggleSkippedTestVisibilityOn", () => config.setShowSkippedTests(true)));

		this.disposables.push(vs.commands.registerCommand("dart.clearTestResults", () => {
			// The command shouldn't ordinarily be available in debug mode, but check just in case it was dynamically invoked.
			if (vs.debug.activeDebugSession)
				return;

			return this.data.clearAllResults();
		}));

		this.disposables.push(vs.commands.registerCommand("_dart.displaySuite", (treeNode: SuiteNode) => vs.commands.executeCommand("_dart.jumpToLineColInUri", vs.Uri.file(treeNode.suiteData.path))));
		this.disposables.push(vs.commands.registerCommand("_dart.displayGroup", (treeNode: GroupNode) => {
			if (!treeNode.path)
				return;
			return vs.commands.executeCommand(
				"_dart.jumpToLineColInUri",
				vs.Uri.file(treeNode.path),
				treeNode.line,
				treeNode.column,
			);
		}));
		this.disposables.push(vs.commands.registerCommand("_dart.displayTest", (treeNode: TestNode) => {
			if (!treeNode.path)
				return;
			return vs.commands.executeCommand(
				"_dart.jumpToLineColInUri",
				vs.Uri.file(treeNode.path),
				treeNode.line,
				treeNode.column,
			);
		}));
		this.disposables.push(vs.commands.registerCommand("_dart.displayTestOutput", this.writeTestOutput, this));
	}

	private handleConfigChange(e: vs.ConfigurationChangeEvent) {
		if (e.affectsConfiguration("dart.showSkippedTests"))
			this.data.handleConfigChange();
	}

	private async writeTestOutput(treeNode: TestNode) {
		if (this.currentTestTerminal) {
			this.currentTestTerminal[0].dispose();
			this.currentTestTerminal = undefined;
		}

		const messages: string[] = [];
		messages.push(`Output for ${treeNode.name}\r\n`);

		if (!treeNode.outputEvents.length)
			messages.push(`(no output)\r\n`);

		for (const o of treeNode.outputEvents) {
			messages.push(this.getColoredTestOutput(o));
		}

		this.currentTestTerminal = writeToPseudoTerminal(messages);
	}

	private getColoredTestOutput(event: PrintNotification | ErrorNotification) {
		let output: string | undefined;
		if (event.type === "error") {
			event = event as ErrorNotification;
			output = brightRed(`${event.error}\n${event.stackTrace}\n`);
		} else if (event.type === "print") {
			event = event as PrintNotification;
			output = `${event.message}\n`;
		} else {
			output = yellow(`Unknown message type '${event.type}'.\n`);
		}

		return output;
	}

	public getTreeItem(element: TreeNode): vs.TreeItem {
		if (element instanceof SuiteNode) {
			return this.treeItemBuilder.createSuiteNode(element);
		} else if (element instanceof GroupNode) {
			return this.treeItemBuilder.createGroupNode(element);
		} else if (element instanceof TestNode) {
			return this.treeItemBuilder.createTestNode(element);
		} else {
			throw new Error(`Unrecognised tree node type: ${element}`);
		}
	}

	private skippedSettingFilter(node: TreeNode): boolean {
		if (config.showSkippedTests)
			return true;

		if (node instanceof TestNode) {
			// Show only if not skipped.
			return node.status !== TestStatus.Skipped;
		} else if (node instanceof GroupNode) {
			// Show only if status is not exactly skipped.
			return node.statuses.size !== 1 || !node.statuses.has(TestStatus.Skipped);
		} else {
			// Otherwise show (though nothing should get here).
			return true;
		}
	}

	public getChildren(element?: TreeNode): TreeNode[] {
		// Nodes with children.
		if (element instanceof SuiteNode || element instanceof GroupNode)
			return element.children.filter(this.skippedSettingFilter);

		// Nodes without children (TestNode, or other unknown).
		if (element)
			return [];

		// All top-level suites.
		return Object.values(this.data.suites)
			// We don't filter skipped out, as we want the node as a convenient
			// way for the user to click the node and run Run Skipped Tests
			// for the suite.
			.map((suite) => suite.node);
	}

	public getParent?(element: vs.TreeItem): SuiteNode | GroupNode | undefined {
		if (element instanceof TestNode || element instanceof GroupNode)
			return element.parent;
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

function getIconPath(status: TestStatus, isStale: boolean): vs.Uri | undefined {
	let file: string | undefined;
	// TODO: Should we have faded icons for stale versions?
	switch (status) {
		case TestStatus.Running:
			file = "running";
			break;
		case TestStatus.Passed:
			file = isStale ? "pass_stale" : "pass";
			break;
		case TestStatus.Failed:
			file = isStale ? "fail_stale" : "fail";
			break;
		case TestStatus.Skipped:
			file = isStale ? "skip_stale" : "skip";
			break;
		case TestStatus.Unknown:
			file = "unknown";
			break;
		case TestStatus.Waiting:
			file = "loading";
			break;
		default:
			file = undefined;
	}

	return file && extensionPath
		? vs.Uri.file(path.join(extensionPath, `media/icons/tests/${file}.svg`))
		: undefined;
}

class TreeItemBuilder {
	constructor(private readonly flutterCapabilities: FlutterCapabilities) { }

	public createSuiteNode(node: SuiteNode): vs.TreeItem {
		// TODO: children is quite expensive, we should add a faster way.
		const collapseState = node.children?.length || 0 > 0 ? vs.TreeItemCollapsibleState.Collapsed : vs.TreeItemCollapsibleState.None;
		const treeItem = new vs.TreeItem(vs.Uri.file(node.suiteData.path), collapseState);
		treeItem.contextValue = this.getContextValueForNode(node);
		treeItem.iconPath = getIconPath(node.getHighestStatus(config.showSkippedTests), node.isStale);
		treeItem.description = node.description;
		treeItem.command = { command: "_dart.displaySuite", arguments: [node], title: "" };
		return treeItem;
	}

	public createGroupNode(node: GroupNode): vs.TreeItem {
		const collapseState = node.children?.length || 0 > 0 ? vs.TreeItemCollapsibleState.Collapsed : vs.TreeItemCollapsibleState.None;
		const treeItem = new vs.TreeItem(this.cleanLabel(node.label || "<unnamed>"), collapseState);
		treeItem.contextValue = this.getContextValueForNode(node);
		treeItem.resourceUri = vs.Uri.file(node.suiteData.path);
		treeItem.iconPath = getIconPath(node.getHighestStatus(config.showSkippedTests), node.isStale);
		treeItem.description = node.description;
		treeItem.command = { command: "_dart.displayGroup", arguments: [node], title: "" };
		return treeItem;
	}

	public createTestNode(node: TestNode): vs.TreeItem {
		const treeItem = new vs.TreeItem(this.cleanLabel(node.label || "<unnamed>"), vs.TreeItemCollapsibleState.None);
		treeItem.contextValue = this.getContextValueForNode(node);
		treeItem.resourceUri = vs.Uri.file(node.suiteData.path);
		treeItem.iconPath = getIconPath(node.status, node.isStale);
		treeItem.description = node.description;
		treeItem.command = { command: "_dart.displayTest", arguments: [node], title: "" };
		return treeItem;
	}

	private cleanLabel(label: string) {
		return label.trim().split("\n").map((l) => l.trim()).join(" ");
	}

	private getContextValueForNode(node: TestContainerNode | TestNode): string {
		let contexts = "";

		if (node instanceof SuiteNode)
			contexts = `${DART_TEST_SUITE_NODE_CONTEXT} `;
		else if (node instanceof GroupNode)
			contexts = `${DART_TEST_GROUP_NODE_CONTEXT} `;
		else
			contexts = `${DART_TEST_TEST_NODE_CONTEXT} `;

		if (node instanceof TestContainerNode) {
			if (node.hasStatus(TestStatus.Failed))
				contexts += `${DART_TEST_CONTAINER_NODE_WITH_FAILURES_CONTEXT} `;

			if (node.hasStatus(TestStatus.Skipped))
				contexts += `${DART_TEST_CONTAINER_NODE_WITH_SKIPS_CONTEXT} `;
		}

		// Don't mark a node as skipable unless it's non-Flutter or the current Flutter version
		// supports run-skipped.
		if (!node.suiteData.isFlutterSuite || this.flutterCapabilities.supportsRunSkippedTests)
			contexts += `${DART_TEST_CAN_RUN_SKIPPED_CONTEXT} `;

		return contexts.trimEnd();
	}
}
