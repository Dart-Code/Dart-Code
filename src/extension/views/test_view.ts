import * as path from "path";
import * as vs from "vscode";
import { DART_TEST_GROUP_NODE_CONTEXT, DART_TEST_SUITE_NODE_CONTEXT, DART_TEST_SUITE_NODE_WITH_FAILURES_CONTEXT, DART_TEST_TEST_NODE_CONTEXT } from "../../shared/constants";
import { TestStatus } from "../../shared/enums";
import { Logger } from "../../shared/interfaces";
import { GroupNode, SuiteData, SuiteNode, TestNode, TestTreeModel, TreeNode } from "../../shared/test/tree_model";
import { ErrorNotification, GroupNotification, Notification, PrintNotification, SuiteNotification, TestDoneNotification, TestStartNotification } from "../../shared/test_protocol";
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
	private onDidStartTestsEmitter: vs.EventEmitter<TreeNode> = new vs.EventEmitter<TreeNode>();
	public readonly onDidStartTests: vs.Event<TreeNode> = this.onDidStartTestsEmitter.event;
	private onFirstFailureEmitter: vs.EventEmitter<TreeNode> = new vs.EventEmitter<TreeNode>();
	public readonly onFirstFailure: vs.Event<TreeNode> = this.onFirstFailureEmitter.event;
	private currentSelectedNode: TreeNode | undefined;
	private currentTestTerminal: [vs.Terminal, vs.EventEmitter<string>] | undefined;

	public setSelectedNodes(item: TreeNode | undefined): void {
		this.currentSelectedNode = item;
	}

	private owningDebugSessions: { [key: string]: vs.DebugSession | undefined } = {};

	constructor(private readonly logger: Logger, private readonly data: TestTreeModel, analyzer: LspAnalyzer | undefined) {
		this.disposables.push(vs.debug.onDidReceiveDebugSessionCustomEvent((e) => this.handleDebugSessionCustomEvent(e)));
		this.disposables.push(vs.debug.onDidTerminateDebugSession((session) => this.handleDebugSessionEnd(session)));
		this.disposables.push(vs.commands.registerCommand("dart.startDebuggingTest", (treeNode: SuiteNode | GroupNode | TestNode) => this.runTests(treeNode, undefined, true, false)));
		this.disposables.push(vs.commands.registerCommand("dart.startWithoutDebuggingTest", (treeNode: SuiteNode | GroupNode | TestNode) => this.runTests(treeNode, undefined, false, false)));
		this.disposables.push(vs.commands.registerCommand("dart.startDebuggingFailedTests", (treeNode: SuiteNode | GroupNode | TestNode) => this.runTests(treeNode, this.getFailedTestNames(treeNode), true, false)));
		this.disposables.push(vs.commands.registerCommand("dart.startWithoutDebuggingFailedTests", (treeNode: SuiteNode | GroupNode | TestNode) => this.runTests(treeNode, this.getFailedTestNames(treeNode), false, false)));
		this.disposables.push(vs.commands.registerCommand("dart.runAllFailedTestsWithoutDebugging", () => this.runAllFailedTests()));

		this.disposables.push(vs.commands.registerCommand("_dart.displaySuite", (treeNode: SuiteNode) => vs.commands.executeCommand("_dart.jumpToLineColInUri", vs.Uri.file(treeNode.suiteData.path))));
		this.disposables.push(vs.commands.registerCommand("_dart.displayGroup", (treeNode: GroupNode) => {
			if (!treeNode.group.url && !treeNode.group.root_url)
				return;
			return vs.commands.executeCommand(
				"_dart.jumpToLineColInUri",
				// TODO: These are the opposite way to tests, this seems likely a bug?
				vs.Uri.parse((treeNode.group.url || treeNode.group.root_url)!),
				treeNode.group.root_line || treeNode.group.line,
				treeNode.group.root_column || treeNode.group.column,
			);
		}));
		this.disposables.push(vs.commands.registerCommand("_dart.displayTest", (treeNode: TestNode) => {
			this.writeTestOutput(treeNode);
			if (!treeNode.test.url && !treeNode.test.root_url)
				return;
			return vs.commands.executeCommand(
				"_dart.jumpToLineColInUri",
				vs.Uri.parse((treeNode.test.root_url || treeNode.test.url)!),
				treeNode.test.root_line || treeNode.test.line,
				treeNode.test.root_column || treeNode.test.column,
			);
		}));

		if (analyzer) {
			this.disposables.push(analyzer.fileTracker.onOutline.listen((outline) => {
				const suitePath = fsPath(vs.Uri.parse(outline.uri));
				if (isTestFile(suitePath)) {
					// Force creation of a node.
					const [suite, didCreate] = this.data.findOrCreateSuite(suitePath);

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

	private async runAllFailedTests(): Promise<void> {
		const topLevelNodes = this.getChildren() || [];
		const suitesWithFailures = topLevelNodes
			.filter((node) => node instanceof SuiteNode && node.hasFailures)
			.map((m) => [m as SuiteNode, this.getFailedTestNames(m)] as SuiteWithFailures);
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
					const suiteName = path.basename(node.suite.path);
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

	private getFailedTestNames(treeNode: TreeNode): string[] {
		let names: string[] = [];
		if (treeNode instanceof SuiteNode || treeNode instanceof GroupNode) {
			for (const child of treeNode.children) {
				const childNames = this.getFailedTestNames(child);
				if (childNames)
					names = names.concat(childNames);
			}
		} else if (treeNode instanceof TestNode && treeNode.hasFailures) {
			if (treeNode.test.name !== undefined)
				names.push(treeNode.test.name);
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
				emitter.fire(`Output for ${treeNode.fullName}\r\n`);

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

	public handleDebugSessionCustomEvent(e: vs.DebugSessionCustomEvent) {
		if (e.event === "dart.testRunNotification") {
			// If we're starting a suite, record us as the owner so we can clean up later
			if (e.body.notification.type === "suite")
				this.owningDebugSessions[e.body.suitePath] = e.session;

			// tslint:disable-next-line: no-floating-promises
			this.handleNotification(e.body.suitePath, e.body.notification).catch((e) => this.logger.error(e));
		}
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
		let items = !element
			? Object.values(this.data.suites).map((suite) => suite.node)
			: (element instanceof SuiteNode || element instanceof GroupNode)
				? element.children
				: [];
		items = items.filter((item) => item);
		// Only sort suites, as tests may have a useful order themselves.
		if (!element) {
			items = items.sort((a, b) => {
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
		return items;
	}

	public getParent?(element: vs.TreeItem): SuiteNode | GroupNode | undefined {
		if (element instanceof TestNode || element instanceof GroupNode)
			return element.parent;
	}

	private updateNode(node?: TreeNode): void {
		this.onDidChangeTreeDataEmitter.fire(node);
	}

	private updateAllStatuses(suite: SuiteData) {
		// Walk the tree to get the status.
		this.updateStatusFromChildren(suite.node);

		// Update top level list, as we could've changed order.
		this.updateNode();
	}

	private updateStatusFromChildren(node: SuiteNode | GroupNode): TestStatus {
		const childStatuses = node.children.length
			? node.children.filter((c) =>
				(c instanceof GroupNode && !c.isPhantomGroup)
				|| (c instanceof TestNode && !c.hidden),
			).map((c) => {
				if (c instanceof GroupNode)
					return this.updateStatusFromChildren(c);
				if (c instanceof TestNode)
					return c.status;
				return TestStatus.Unknown;
			})
			: [TestStatus.Unknown];

		const newStatus = Math.max(...childStatuses);
		if (newStatus !== node.status) {
			node.status = newStatus;
			this.updateNode(node);
		}

		node.description = `${node.testPassCount}/${node.testCount} passed, ${node.duration}ms`;

		return node.status;
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}

	private async handleNotification(suitePath: string, evt: Notification): Promise<void> {
		const suite = this.data.suites[suitePath];
		switch (evt.type) {
			// We won't get notifications that aren't directly tied to Suites because
			// of how the DA works.
			// case "start":
			// 	this.handleStartNotification(evt as StartNotification);
			// 	break;
			// We won't get notifications that aren't directly tied to Suites because
			// of how the DA works.
			// case "allSuites":
			// 	this.handleAllSuitesNotification(evt as AllSuitesNotification);
			// 	break;
			case "suite":
				this.handleSuiteNotification(suitePath, evt as SuiteNotification);
				break;
			case "testStart":
				this.handleTestStartNotifcation(suite, evt as TestStartNotification);
				break;
			case "testDone":
				this.handleTestDoneNotification(suite, evt as TestDoneNotification);
				break;
			case "group":
				this.handleGroupNotification(suite, evt as GroupNotification);
				break;
			// We won't get notifications that aren't directly tied to Suites because
			// of how the DA works.
			// case "done":
			// 	this.handleDoneNotification(suite, evt as DoneNotification);
			// 	break;
			case "print":
				this.handlePrintNotification(suite, evt as PrintNotification);
				break;
			case "error":
				this.handleErrorNotification(suite, evt as ErrorNotification);
				break;
		}
	}

	private handleSuiteNotification(suitePath: string, evt: SuiteNotification) {
		const [suite, didCreate] = this.data.findOrCreateSuite(evt.suite.path, evt.suite.id);
		suite.node.status = TestStatus.Waiting;
		this.updateNode(suite.node);
		this.updateNode();
		// If this is the first suite, we've started a run and can show the tree.
		// We need to wait for the tree node to have been rendered though so setTimeout :(
		if (this.data.isNewTestRun) {
			this.data.isNewTestRun = false;
			this.onDidStartTestsEmitter.fire(suite.node);
		}
	}

	private handleTestStartNotifcation(suite: SuiteData, evt: TestStartNotification) {
		let oldParent: SuiteNode | GroupNode | undefined;
		const existingTest = suite.getCurrentTest(evt.test.id) || suite.reuseMatchingTest(suite.currentRunNumber, evt.test, (parent) => oldParent = parent);
		const testNode = existingTest || new TestNode(suite, evt.test);

		if (!existingTest)
			suite.storeTest(evt.test.id, testNode);
		testNode.test = evt.test;
		testNode.testStartTime = evt.time;

		// If this is a "loading" test then mark it as hidden because it looks wonky in
		// the tree with a full path and we already have the "running" icon on the suite.
		if (testNode.test.name && testNode.test.name.startsWith("loading ") && testNode.parent instanceof SuiteNode)
			testNode.hidden = true;
		else
			testNode.hidden = false;

		// Remove from old parent if required.
		const hasChangedParent = oldParent && oldParent !== testNode.parent;
		if (oldParent && hasChangedParent) {
			oldParent.tests.splice(oldParent.tests.indexOf(testNode), 1);
			this.updateNode(oldParent);
		}

		// Push to new parent if required.
		if (!existingTest || hasChangedParent)
			testNode.parent.tests.push(testNode);

		testNode.status = TestStatus.Running;
		this.updateNode(testNode);
		this.updateNode(testNode.parent);
		if (!testNode.hidden)
			this.updateAllStatuses(suite);
	}

	private handleTestDoneNotification(suite: SuiteData, evt: TestDoneNotification) {
		const testNode = suite.getCurrentTest(evt.testID);

		testNode.hidden = evt.hidden;
		if (evt.skipped) {
			testNode.status = TestStatus.Skipped;
		} else if (evt.result === "success") {
			testNode.status = TestStatus.Passed;
		} else if (evt.result === "failure") {
			testNode.status = TestStatus.Failed;
		} else if (evt.result === "error")
			testNode.status = TestStatus.Errored;
		else {
			testNode.status = TestStatus.Unknown;
		}
		if (evt.time && testNode.testStartTime) {
			testNode.duration = evt.time - testNode.testStartTime;
			testNode.description = `${testNode.duration}ms`;
			testNode.testStartTime = undefined;
		}

		this.updateNode(testNode);
		this.updateNode(testNode.parent);
		this.updateAllStatuses(suite);

		if ((testNode.status === TestStatus.Failed || testNode.status === TestStatus.Errored) && this.data.nextFailureIsFirst) {
			this.data.nextFailureIsFirst = false;
			this.onFirstFailureEmitter.fire(testNode);
		}
	}

	private handleGroupNotification(suite: SuiteData, evt: GroupNotification) {
		let oldParent: SuiteNode | GroupNode | undefined;
		const existingGroup = suite.getCurrentGroup(evt.group.id) || suite.reuseMatchingGroup(suite.currentRunNumber, evt.group, (parent) => oldParent = parent);
		const groupNode = existingGroup || new GroupNode(suite, evt.group);

		if (!existingGroup)
			suite.storeGroup(evt.group.id, groupNode);
		groupNode.group = evt.group;

		// Remove from old parent if required
		const hasChangedParent = oldParent && oldParent !== groupNode.parent;
		if (oldParent && hasChangedParent) {
			oldParent.groups.splice(oldParent.groups.indexOf(groupNode), 1);
			this.updateNode(oldParent);
		}

		// Push to new parent if required.
		if (!existingGroup || hasChangedParent)
			groupNode.parent.groups.push(groupNode);

		groupNode.status = TestStatus.Running;
		this.updateNode(groupNode);
		this.updateNode(groupNode.parent);
	}

	public handleDebugSessionEnd(session: vs.DebugSession) {
		// Get the suite paths that have us as the owning debug session.
		const suitePaths = Object.keys(this.owningDebugSessions).filter((suitePath) => {
			const owningSession = this.owningDebugSessions[suitePath];
			return session
				&& owningSession
				&& owningSession.id === session.id;
		});

		// End them all and remove from the lookup.
		for (const suitePath of suitePaths) {
			this.handleSuiteEnd(this.data.suites[suitePath]);
			this.owningDebugSessions[suitePath] = undefined;
			delete this.owningDebugSessions[suitePath];
		}
	}

	private handleSuiteEnd(suite: SuiteData) {
		if (!suite)
			return;

		// TODO: Some notification that things are complete?
		// TODO: Maybe a progress bar during the run?

		// Hide nodes that were marked as potentially deleted and then never updated.
		// This means they weren't run in the last run, so probably were deleted (or
		// renamed and got new nodes, which still means the old ones should be removed).
		suite.getAllTests(true).filter((t) => t.isPotentiallyDeleted || t.hidden).forEach((t) => {
			t.hidden = true;
			this.updateNode(t.parent);
		});

		// Anything marked as running should be set back to Unknown
		suite.getAllTests().filter((t) => t.status === TestStatus.Running).forEach((t) => {
			t.status = TestStatus.Unknown;
			this.updateNode(t);
		});

		this.updateAllStatuses(suite);
	}

	private handlePrintNotification(suite: SuiteData, evt: PrintNotification) {
		const test = suite.getCurrentTest(evt.testID);
		test.outputEvents.push(evt);
		if (test === this.currentSelectedNode)
			this.appendTestOutput(evt);
	}

	private handleErrorNotification(suite: SuiteData, evt: ErrorNotification) {
		const test = suite.getCurrentTest(evt.testID);
		test.outputEvents.push(evt);
		if (test === this.currentSelectedNode)
			this.appendTestOutput(evt);
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
		const treeItem = new vs.TreeItem(vs.Uri.file(node.suite.path), collapseState);
		treeItem.contextValue = node.hasFailures
			? DART_TEST_SUITE_NODE_WITH_FAILURES_CONTEXT
			: DART_TEST_SUITE_NODE_CONTEXT;
		treeItem.id = `suite_${node.suite.path}_${node.suiteRunNumber}_${node.suite.id}`;
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
		treeItem.id = `suite_${node.suiteData.path}_${node.suiteRunNumber}_group_${node.group.id}`;
		treeItem.iconPath = getIconPath(node.status, node.isStale);
		treeItem.description = node.description;
		treeItem.command = { command: "_dart.displayGroup", arguments: [node], title: "" };
		return treeItem;
	}

	public createTestNode(node: TestNode): vs.TreeItem {
		const treeItem = new vs.TreeItem(node.label || "<unnamed>", vs.TreeItemCollapsibleState.None);
		treeItem.contextValue = DART_TEST_TEST_NODE_CONTEXT;
		treeItem.resourceUri = vs.Uri.file(node.suiteData.path);
		treeItem.id = `suite_${node.suiteData.path}_${node.suiteRunNumber}_test_${node.test.id}`;
		treeItem.iconPath = getIconPath(node.status, node.isStale);
		treeItem.description = node.description;
		treeItem.command = { command: "_dart.displayTest", arguments: [node], title: "" };
		return treeItem;
	}
}
const treeItemBuilder = new TreeItemBuilder();

