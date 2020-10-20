import * as path from "path";
import * as vs from "vscode";
import { DART_TEST_GROUP_NODE_CONTEXT, DART_TEST_SUITE_NODE_CONTEXT, DART_TEST_SUITE_NODE_WITH_FAILURES_CONTEXT, DART_TEST_TEST_NODE_CONTEXT } from "../../shared/constants";
import { TestStatus } from "../../shared/enums";
import { Logger } from "../../shared/interfaces";
import { TestSessionCoordindator } from "../../shared/test/coordindator";
import { GroupNode, SuiteNode, TestNode, TestTreeModel, TreeNode } from "../../shared/test/test_model";
import { ErrorNotification, PrintNotification } from "../../shared/test_protocol";
import { disposeAll } from "../../shared/utils";
import { brightRed, yellow } from "../../shared/utils/colors";
import { fsPath, getRandomInt } from "../../shared/utils/fs";
import { getLaunchConfig } from "../../shared/utils/test";
import { extensionPath } from "../../shared/vscode/extension_utils";
import { LspAnalyzer } from "../analysis/analyzer_lsp";
import { isTestFile } from "../utils";

type SuiteWithFailures = [SuiteNode, string[]];

export class TestResultsProvider implements vs.Disposable, vs.TreeDataProvider<TreeNode> {
	private disposables: vs.Disposable[] = [];
	private onDidChangeTreeDataEmitter: vs.EventEmitter<TreeNode | undefined> = new vs.EventEmitter<TreeNode | undefined>();
	public readonly onDidChangeTreeData: vs.Event<TreeNode | undefined> = this.onDidChangeTreeDataEmitter.event;
	private currentSelectedNode: TreeNode | undefined;
	private currentTestTerminal: [vs.Terminal, vs.EventEmitter<string>] | undefined;

	public setSelectedNodes(item: TreeNode | undefined): void {
		this.currentSelectedNode = item;
	}

	constructor(private readonly logger: Logger, private readonly data: TestTreeModel, private readonly coordindator: TestSessionCoordindator, analyzer: LspAnalyzer | undefined) {
		this.disposables.push(data.onDidChangeTreeData.listen((node) => this.onDidChangeTreeDataEmitter.fire(node)));

		this.disposables.push(vs.debug.onDidReceiveDebugSessionCustomEvent((e) => this.handleDebugSessionCustomEvent(e)));
		this.disposables.push(vs.debug.onDidTerminateDebugSession((session) => this.handleDebugSessionEnd(session)));
		this.disposables.push(vs.commands.registerCommand("dart.startDebuggingTest", (treeNode: SuiteNode | GroupNode | TestNode) => this.runTests(treeNode, this.getTestNames(treeNode, false), true, false)));
		this.disposables.push(vs.commands.registerCommand("dart.startWithoutDebuggingTest", (treeNode: SuiteNode | GroupNode | TestNode) => this.runTests(treeNode, this.getTestNames(treeNode, false), false, false)));
		this.disposables.push(vs.commands.registerCommand("dart.startDebuggingFailedTests", (treeNode: SuiteNode | GroupNode | TestNode) => this.runTests(treeNode, this.getTestNames(treeNode, true), true, false)));
		this.disposables.push(vs.commands.registerCommand("dart.startWithoutDebuggingFailedTests", (treeNode: SuiteNode | GroupNode | TestNode) => this.runTests(treeNode, this.getTestNames(treeNode, true), false, false)));
		this.disposables.push(vs.commands.registerCommand("dart.runAllFailedTestsWithoutDebugging", () => this.runAllFailedTests()));

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
			this.writeTestOutput(treeNode);
			if (!treeNode.path)
				return;
			return vs.commands.executeCommand(
				"_dart.jumpToLineColInUri",
				vs.Uri.file(treeNode.path),
				treeNode.line,
				treeNode.column,
			);
		}));

		if (analyzer) {
			this.disposables.push(analyzer.fileTracker.onOutline.listen((outline) => {
				const suitePath = fsPath(vs.Uri.parse(outline.uri));
				if (isTestFile(suitePath)) {
					// Force creation of a node.
					const [suite, didCreate] = this.data.getOrCreateSuite(suitePath);

					if (didCreate) {
						// TODO: Create a heirarchical visitor to create groups/tests
						// and add them similar to findOrCreateSuite above.
						// const visitor = new LspTestOutlineVisitor(this.logger, suitePath);
						// visitor.visit(outline.outline);

						// for (const test of visitor.tests) {
						// 	test.
						// }
					}

					this.updateNode(suite.node);
					this.updateNode();
				}
			}));
		}
	}

	public handleDebugSessionCustomEvent(e: { session: vs.DebugSession; event: string; body?: any; }) {
		this.coordindator.handleDebugSessionCustomEvent(e);
	}

	public handleDebugSessionEnd(session: vs.DebugSession) {
		this.coordindator.handleDebugSessionEnd(session.id);
	}

	private async runAllFailedTests(): Promise<void> {
		const topLevelNodes = this.getChildren() || [];
		const suitesWithFailures = topLevelNodes
			.filter((node) => node instanceof SuiteNode && node.hasFailures)
			.map((m) => [m as SuiteNode, this.getTestNames(m, true)] as SuiteWithFailures);
		if (suitesWithFailures.length === 0)
			return;

		const percentProgressPerTest = 99 / suitesWithFailures.map((swf) => swf[1].length).reduce((a, b) => a + b);
		await vs.window.withProgress(
			{
				cancellable: true,
				location: vs.ProgressLocation.Notification,
				title: "Re-running failed tests",
			},
			async (progress, token) => {
				progress.report({ increment: 1 });
				for (const suite of suitesWithFailures) {
					const node = suite[0];
					const failedTestNames = suite[1];
					if (token.isCancellationRequested)
						break;
					const suiteName = path.basename(node.suiteData.path);
					progress.report({ message: suiteName });
					await this.runTests(node, failedTestNames, false, true, token);
					progress.report({ message: suiteName, increment: failedTestNames.length * percentProgressPerTest });
				}
			},
		);
	}

	private async runTests(treeNode: GroupNode | SuiteNode | TestNode, testNames: string[] | undefined, debug: boolean, suppressPromptOnErrors: boolean, token?: vs.CancellationToken) {
		const subs: vs.Disposable[] = [];
		return new Promise(async (resolve, reject) => {
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
			const didStart = await vs.debug.startDebugging(
				vs.workspace.getWorkspaceFolder(vs.Uri.file(treeNode.suiteData.path)),
				{
					dartCodeDebugSessionID,
					suppressPromptOnErrors,
					...getLaunchConfig(
						!debug,
						programPath,
						testNames,
						treeNode instanceof GroupNode
					),
					name: `Tests ${path.basename(programPath)}`,
				}
			);
			if (!didStart)
				reject();
		}).finally(() => disposeAll(subs));
	}

	private getTestNames(treeNode: TreeNode, failedOnly: boolean): string[] | undefined {
		// If we're not running failed only, we can just use the test name/group name (or undefined for suite)
		// directly.
		if (!failedOnly) {
			if ((treeNode instanceof TestNode || treeNode instanceof GroupNode) && treeNode.name !== undefined)
				return [treeNode.name]
			return undefined;
		}

		// Otherwise, collect all descendants tests that are failed.
		let names: string[] = [];
		if (treeNode instanceof SuiteNode || treeNode instanceof GroupNode) {
			for (const child of treeNode.children) {
				const childNames = this.getTestNames(child, failedOnly);
				if (childNames)
					names = names.concat(childNames);
			}
		} else if (treeNode instanceof TestNode && treeNode.hasFailures) {
			if (treeNode.name !== undefined)
				names.push(treeNode.name);
		}

		return names;
	}

	private async writeTestOutput(treeNode: TestNode) {
		if (this.currentTestTerminal) {
			this.currentTestTerminal[0].dispose();
			this.currentTestTerminal = undefined;
		}

		const emitter = new vs.EventEmitter<string>();
		const pseudoterminal: vs.Pseudoterminal = {
			close: () => { },
			onDidWrite: emitter.event,
			open: () => {
				emitter.fire(`Output for ${treeNode.name}\r\n`);

				if (!treeNode.outputEvents.length)
					emitter.fire(`(no output)\r\n`);

				for (const o of treeNode.outputEvents) {
					this.appendTestOutput(o, emitter);
				}
			},
		};
		this.currentTestTerminal = [
			vs.window.createTerminal({ name: "Test Output", pty: pseudoterminal }),
			emitter,
		];
		this.currentTestTerminal[0].show();
	}

	private appendTestOutput(event: PrintNotification | ErrorNotification, emitter = this.currentTestTerminal ? this.currentTestTerminal[1] : undefined) {
		if (!emitter)
			return;
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

		if (output)
			emitter.fire(output.replace(/\n/g, "\r\n"));
	}



	public getTreeItem(element: TreeNode): vs.TreeItem {
		if (element instanceof SuiteNode) {
			return treeItemBuilder.createSuiteNode(element);
		} else if (element instanceof GroupNode) {
			return treeItemBuilder.createGroupNode(element);
		} else if (element instanceof TestNode) {
			return treeItemBuilder.createTestNode(element);
		} else {
			throw `Unrecognised tree node type: ${element}`;
		}
	}

	public getChildren(element?: TreeNode): TreeNode[] {
		// Nodes with children.
		if (element instanceof SuiteNode || element instanceof GroupNode)
			return element.children;

		// Notes without children (TestNode, or other unknown).
		if (element)
			return [];

		// All top-level suites.
		return Object.values(this.data.suites)
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

	private updateNode(node?: TreeNode): void {
		this.onDidChangeTreeDataEmitter.fire(node);
	}



	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
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
		case TestStatus.Errored:
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
	public createSuiteNode(node: SuiteNode): vs.TreeItem {
		// TODO: children is quite expensive, we should add a faster way.
		const collapseState = node.children?.length || 0 > 0 ? vs.TreeItemCollapsibleState.Collapsed : vs.TreeItemCollapsibleState.None;
		const treeItem = new vs.TreeItem(vs.Uri.file(node.suiteData.path), collapseState);
		treeItem.contextValue = node.hasFailures
			? DART_TEST_SUITE_NODE_WITH_FAILURES_CONTEXT
			: DART_TEST_SUITE_NODE_CONTEXT;
		treeItem.id = `suite_${node.suiteData.path}_${node.suiteRunNumber}`;
		treeItem.iconPath = getIconPath(node.status, node.isStale);
		treeItem.description = node.description || true;
		treeItem.command = { command: "_dart.displaySuite", arguments: [node], title: "" };
		return treeItem;
	}

	public createGroupNode(node: GroupNode): vs.TreeItem {
		const collapseState = node.children?.length || 0 > 0 ? vs.TreeItemCollapsibleState.Collapsed : vs.TreeItemCollapsibleState.None;
		const treeItem = new vs.TreeItem(node.label || "<unnamed>", collapseState);
		treeItem.contextValue = DART_TEST_GROUP_NODE_CONTEXT;
		treeItem.resourceUri = vs.Uri.file(node.suiteData.path);
		treeItem.id = `suite_${node.suiteData.path}_${node.suiteRunNumber}_group_${node.id}`;
		treeItem.iconPath = getIconPath(node.status, node.isStale);
		treeItem.description = node.description;
		treeItem.command = { command: "_dart.displayGroup", arguments: [node], title: "" };
		return treeItem;
	}

	public createTestNode(node: TestNode): vs.TreeItem {
		const treeItem = new vs.TreeItem(node.label || "<unnamed>", vs.TreeItemCollapsibleState.None);
		treeItem.contextValue = DART_TEST_TEST_NODE_CONTEXT;
		treeItem.resourceUri = vs.Uri.file(node.suiteData.path);
		treeItem.id = `suite_${node.suiteData.path}_${node.suiteRunNumber}_test_${node.id}`;
		treeItem.iconPath = getIconPath(node.status, node.isStale);
		treeItem.description = node.description;
		treeItem.command = { command: "_dart.displayTest", arguments: [node], title: "" };
		return treeItem;
	}
}
const treeItemBuilder = new TreeItemBuilder();


