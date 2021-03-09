import * as path from "path";
import * as vs from "vscode";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { DART_TEST_CAN_RUN_SKIPPED_CONTEXT, DART_TEST_CONTAINER_NODE_WITH_FAILURES_CONTEXT, DART_TEST_CONTAINER_NODE_WITH_SKIPS_CONTEXT, DART_TEST_GROUP_NODE_CONTEXT, DART_TEST_SUITE_NODE_CONTEXT, DART_TEST_TEST_NODE_CONTEXT } from "../../shared/constants";
import { TestStatus } from "../../shared/enums";
import { TestSessionCoordinator } from "../../shared/test/coordinator";
import { GroupNode, SuiteNode, TestContainerNode, TestNode, TestTreeModel, TreeNode } from "../../shared/test/test_model";
import { ErrorNotification, PrintNotification } from "../../shared/test_protocol";
import { disposeAll } from "../../shared/utils";
import { brightRed, yellow } from "../../shared/utils/colors";
import { fsPath, getRandomInt } from "../../shared/utils/fs";
import { getLaunchConfig } from "../../shared/utils/test";
import { extensionPath } from "../../shared/vscode/extension_utils";
import { config } from "../config";
import { isInsideFlutterProject } from "../utils";
import { writeToPseudoTerminal } from "../utils/vscode/terminals";

type SuiteList = [SuiteNode, string[]];

export class TestResultsProvider implements vs.Disposable, vs.TreeDataProvider<TreeNode> {
	private disposables: vs.Disposable[] = [];
	private onDidChangeTreeDataEmitter: vs.EventEmitter<TreeNode | undefined> = new vs.EventEmitter<TreeNode | undefined>();
	public readonly onDidChangeTreeData: vs.Event<TreeNode | undefined> = this.onDidChangeTreeDataEmitter.event;
	private currentTestTerminal: [vs.Terminal, vs.EventEmitter<string>] | undefined;
	private readonly treeItemBuilder: TreeItemBuilder;

	constructor(private readonly data: TestTreeModel, private readonly coordinator: TestSessionCoordinator, private readonly flutterCapabilities: FlutterCapabilities) {
		this.treeItemBuilder = new TreeItemBuilder(flutterCapabilities);
		this.disposables.push(data.onDidChangeTreeData.listen((node) => this.onDidChangeTreeDataEmitter.fire(node)));
		this.disposables.push(vs.workspace.onDidChangeConfiguration((e) => this.handleConfigChange(e)));

		this.disposables.push(vs.debug.onDidReceiveDebugSessionCustomEvent((e) => this.handleDebugSessionCustomEvent(e)));
		this.disposables.push(vs.debug.onDidTerminateDebugSession((session) => this.handleDebugSessionEnd(session)));
		this.disposables.push(vs.commands.registerCommand("_dart.toggleSkippedTestVisibilityOff", () => config.setShowSkippedTests(false)));
		this.disposables.push(vs.commands.registerCommand("_dart.toggleSkippedTestVisibilityOn", () => config.setShowSkippedTests(true)));
		this.disposables.push(vs.commands.registerCommand("dart.startDebuggingTest", (treeNode: SuiteNode | GroupNode | TestNode) => this.runTests(treeNode, this.getTestNames(treeNode), true, false, treeNode instanceof TestNode)));
		this.disposables.push(vs.commands.registerCommand("dart.startWithoutDebuggingTest", (treeNode: SuiteNode | GroupNode | TestNode) => this.runTests(treeNode, this.getTestNames(treeNode), false, false, treeNode instanceof TestNode)));
		this.disposables.push(vs.commands.registerCommand("dart.startDebuggingSkippedTests", (treeNode: SuiteNode | GroupNode | TestNode) => this.runTests(treeNode, this.getTestNames(treeNode, TestStatus.Skipped), true, false, true)));
		this.disposables.push(vs.commands.registerCommand("dart.startWithoutDebuggingSkippedTests", (treeNode: SuiteNode | GroupNode | TestNode) => this.runTests(treeNode, this.getTestNames(treeNode, TestStatus.Skipped), false, false, true)));
		this.disposables.push(vs.commands.registerCommand("dart.startDebuggingFailedTests", (treeNode: SuiteNode | GroupNode | TestNode) => this.runTests(treeNode, this.getTestNames(treeNode, TestStatus.Failed), true, false, false)));
		this.disposables.push(vs.commands.registerCommand("dart.startWithoutDebuggingFailedTests", (treeNode: SuiteNode | GroupNode | TestNode) => this.runTests(treeNode, this.getTestNames(treeNode, TestStatus.Failed), false, false, false)));
		this.disposables.push(vs.commands.registerCommand("dart.runAllSkippedTestsWithoutDebugging", () => this.runAllSkippedTests()));
		this.disposables.push(vs.commands.registerCommand("dart.runAllFailedTestsWithoutDebugging", () => this.runAllFailedTests()));

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

	public handleDebugSessionCustomEvent(e: { session: vs.DebugSession; event: string; body?: any; }) {
		this.coordinator.handleDebugSessionCustomEvent(e);
	}

	public handleDebugSessionEnd(session: vs.DebugSession) {
		this.coordinator.handleDebugSessionEnd(session.id);
	}

	private async runAllSkippedTests(): Promise<void> {
		await this.runAllTests(TestStatus.Skipped);
	}

	private async runAllFailedTests(): Promise<void> {
		await this.runAllTests(TestStatus.Failed);
	}

	private async runAllTests(onlyOfType: TestStatus): Promise<void> {
		const topLevelNodes = this.getChildren() || [];
		const suiteList = topLevelNodes
			.filter((node) => node instanceof SuiteNode && node.hasStatus(onlyOfType))
			.map((m) => [m as SuiteNode, this.getTestNames(m, onlyOfType)] as SuiteList);
		if (suiteList.length === 0)
			return;

		const percentProgressPerTest = 99 / suiteList.map((sl) => sl[1].length).reduce((a, b) => a + b);
		await vs.window.withProgress(
			{
				cancellable: true,
				location: vs.ProgressLocation.Notification,
				title: `Running ${TestStatus[onlyOfType].toString().toLowerCase()} tests`,
			},
			async (progress, token) => {
				progress.report({ increment: 1 });
				for (const suite of suiteList) {
					const node = suite[0];
					const failedTestNames = suite[1];
					if (token.isCancellationRequested)
						break;
					const suiteName = path.basename(node.suiteData.path);
					progress.report({ message: suiteName });
					await this.runTests(node, failedTestNames, false, true, onlyOfType === TestStatus.Skipped, token);
					progress.report({ message: suiteName, increment: failedTestNames.length * percentProgressPerTest });
				}
			},
		);
	}

	private async runTests(treeNode: GroupNode | SuiteNode | TestNode, testNames: string[] | undefined, debug: boolean, suppressPromptOnErrors: boolean, runSkippedTests: boolean, token?: vs.CancellationToken) {
		const subs: vs.Disposable[] = [];
		return new Promise<void>(async (resolve, reject) => {
			// Construct a unique ID for this session so we can track when it completes.
			const dartCodeDebugSessionID = `session-${getRandomInt(0x1000, 0x10000).toString(16)}`;
			if (token) {
				subs.push(vs.debug.onDidStartDebugSession((e) => {
					if (e.configuration.dartCodeDebugSessionID === dartCodeDebugSessionID)
						subs.push(token.onCancellationRequested(() => e.customRequest("disconnect")));
				}));
			}
			subs.push(vs.debug.onDidTerminateDebugSession((e) => {
				if (e.configuration.dartCodeDebugSessionID === dartCodeDebugSessionID)
					resolve();
			}));
			const programPath = fsPath(treeNode.suiteData.path);
			const canRunSkippedTest = this.flutterCapabilities.supportsRunSkippedTests || !isInsideFlutterProject(vs.Uri.file(treeNode.suiteData.path));
			const shouldRunSkippedTests = runSkippedTests && canRunSkippedTest;
			const didStart = await vs.debug.startDebugging(
				vs.workspace.getWorkspaceFolder(vs.Uri.file(treeNode.suiteData.path)),
				{
					dartCodeDebugSessionID,
					suppressPromptOnErrors,
					...getLaunchConfig(
						!debug,
						programPath,
						testNames,
						treeNode instanceof GroupNode,
						shouldRunSkippedTests,
					),
					name: `Tests ${path.basename(programPath)}`,
				}
			);
			if (!didStart)
				reject();
		}).finally(() => disposeAll(subs));
	}

	private getTestNames(treeNode: TreeNode, onlyOfStatus?: TestStatus): string[] | undefined {
		// If we're getting all tests, we can just use the test name/group name (or undefined for suite) directly.
		if (onlyOfStatus === undefined) {
			if ((treeNode instanceof TestNode || treeNode instanceof GroupNode) && treeNode.name !== undefined)
				return [treeNode.name];

			return undefined;
		}

		// Otherwise, collect all descendant tests that are of the specified type.
		let names: string[] = [];
		if (treeNode instanceof SuiteNode || treeNode instanceof GroupNode) {
			for (const child of treeNode.children) {
				const childNames = this.getTestNames(child, onlyOfStatus);
				if (childNames)
					names = names.concat(childNames);
			}
		} else if (treeNode instanceof TestNode && treeNode.name !== undefined) {
			if (treeNode.status === onlyOfStatus)
				names.push(treeNode.name);
		}

		return names;
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

		// Notes without children (TestNode, or other unknown).
		if (element)
			return [];

		// All top-level suites.
		return Object.values(this.data.suites)
			// We don't filter skipped out, as we want the node as a convenient
			// way for the user to click the node and run Run Skipped Tests
			// for the suite.
			.map((suite) => suite.node)
			.sort((a, b) => {
				// Sort by .sort first.
				if (a.sort > b.sort) return 1;
				if (a.sort < b.sort) return -1;
				// If they're the same, sort by label.
				const aLabel = a.label || (a.suiteData.path || "");
				const bLabel = b.label || (b.suiteData.path || "");
				if (aLabel > bLabel) return 1;
				if (aLabel < bLabel) return -1;
				return 0;
			});
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
