import * as _ from "lodash";
import * as path from "path";
import * as vs from "vscode";
import { getChannel } from "../commands/channels";
import { extensionPath } from "../extension";
import { fsPath } from "../utils";
import { getLaunchConfig } from "../utils/test";
import { ErrorNotification, Group, GroupNotification, PrintNotification, Suite, SuiteNotification, Test, TestDoneNotification, TestStartNotification } from "./test_protocol";

const DART_TEST_SUITE_NODE = "dart-code:testSuiteNode";
const DART_TEST_GROUP_NODE = "dart-code:testGroupNode";
const DART_TEST_TEST_NODE = "dart-code:testTestNode";

const suites: { [key: string]: SuiteData } = {};

export class TestResultsProvider implements vs.Disposable, vs.TreeDataProvider<object> {
	private disposables: vs.Disposable[] = [];
	private onDidChangeTreeDataEmitter: vs.EventEmitter<vs.TreeItem | undefined> = new vs.EventEmitter<vs.TreeItem | undefined>();
	public readonly onDidChangeTreeData: vs.Event<vs.TreeItem | undefined> = this.onDidChangeTreeDataEmitter.event;
	private onDidStartTestsEmitter: vs.EventEmitter<vs.TreeItem | undefined> = new vs.EventEmitter<vs.TreeItem | undefined>();
	public readonly onDidStartTests: vs.Event<vs.TreeItem | undefined> = this.onDidStartTestsEmitter.event;
	private onFirstFailureEmitter: vs.EventEmitter<vs.TreeItem | undefined> = new vs.EventEmitter<vs.TreeItem | undefined>();
	public readonly onFirstFailure: vs.Event<vs.TreeItem | undefined> = this.onFirstFailureEmitter.event;
	private currentSelectedNode: vs.TreeItem;

	// Set this flag we know when a new run starts so we can show the tree; however
	// we can't show it until we render a node (we can only call reveal on a node) so
	// we need to delay this until the suite starts.
	private static isNewTestRun = true;
	private static nextFailureIsFirst = true;

	public static flagStart(): void {
		TestResultsProvider.isNewTestRun = true;
		TestResultsProvider.nextFailureIsFirst = true;
	}

	public setSelectedNodes(item: vs.TreeItem): void {
		this.currentSelectedNode = item;
	}

	private owningDebugSessions: { [key: string]: vs.DebugSession } = {};

	constructor() {
		this.disposables.push(vs.debug.onDidReceiveDebugSessionCustomEvent((e) => this.handleDebugSessionCustomEvent(e)));
		this.disposables.push(vs.debug.onDidTerminateDebugSession((session) => this.handleSessionEnd(session)));
		this.disposables.push(vs.commands.registerCommand("dart.startDebuggingTest", (treeNode: SuiteTreeItem | GroupTreeItem | TestTreeItem) => {
			vs.debug.startDebugging(
				vs.workspace.getWorkspaceFolder(treeNode.resourceUri),
				getLaunchConfig(
					false,
					fsPath(treeNode.resourceUri),
					treeNode instanceof TestTreeItem ? treeNode.test.name : treeNode instanceof GroupTreeItem ? treeNode.group.name : undefined,
					treeNode instanceof GroupTreeItem,
				),
			);
		}));
		this.disposables.push(vs.commands.registerCommand("dart.startWithoutDebuggingTest", (treeNode: SuiteTreeItem | GroupTreeItem | TestTreeItem) => {
			vs.debug.startDebugging(
				vs.workspace.getWorkspaceFolder(treeNode.resourceUri),
				getLaunchConfig(
					true,
					fsPath(treeNode.resourceUri),
					treeNode instanceof TestTreeItem ? treeNode.test.name : treeNode instanceof GroupTreeItem ? treeNode.group.name : undefined,
					treeNode instanceof GroupTreeItem,
				),
			);
		}));

		this.disposables.push(vs.commands.registerCommand("_dart.displaySuite", (treeNode: SuiteTreeItem) => {
			return vs.commands.executeCommand("_dart.jumpToLineColInUri", vs.Uri.file(treeNode.suite.path));
		}));
		this.disposables.push(vs.commands.registerCommand("_dart.displayGroup", (treeNode: GroupTreeItem) => {
			return vs.commands.executeCommand(
				"_dart.jumpToLineColInUri",
				vs.Uri.parse(treeNode.group.url || treeNode.group.root_url),
				treeNode.group.root_line || treeNode.group.line,
				treeNode.group.root_column || treeNode.group.column,
			);
		}));
		this.disposables.push(vs.commands.registerCommand("_dart.displayTest", (treeNode: TestTreeItem) => {
			const output = getChannel("Test Output");
			output.clear();
			if (treeNode.outputEvents.length) {
				output.show(true);
				output.appendLine(`${treeNode.test.name}:\n`);
				for (let o of treeNode.outputEvents) {
					if (o.type === "error") {
						o = o as ErrorNotification;
						output.appendLine(`ERROR: ${o.error}`);
						output.appendLine(o.stackTrace);
					} else if (o.type === "print") {
						o = o as PrintNotification;
						output.appendLine(o.message);
					} else {
						output.appendLine(`Unknown message type '${o.type}'.`);
					}
				}
			}
			return vs.commands.executeCommand(
				"_dart.jumpToLineColInUri",
				vs.Uri.parse(treeNode.test.root_url || treeNode.test.url),
				treeNode.test.root_line || treeNode.test.line,
				treeNode.test.root_column || treeNode.test.column,
			);
		}));
	}

	public handleDebugSessionCustomEvent(e: vs.DebugSessionCustomEvent) {
		if (e.event === "dart.testRunNotification") {
			// If we're starting a suite, record us as the owner so we can clean up later
			if (e.body.notification.type === "suite")
				this.owningDebugSessions[e.body.suitePath] = e.session;

			this.handleNotification(e.body.suitePath, e.body.notification);
		}
	}

	public getTreeItem(element: vs.TreeItem): vs.TreeItem {
		return element;
	}

	public getChildren(element?: vs.TreeItem): TestItemTreeItem[] {
		let items = !element
			? Object.keys(suites).map((k) => suites[k].node)
			: (element instanceof SuiteTreeItem || element instanceof GroupTreeItem)
				? element.children
				: [];
		items = items.filter((item) => item);
		// Only sort suites, as tests may have a useful order themselves.
		if (!element) {
			items = _.sortBy(items, [
				(t: TestItemTreeItem) => t.sort,
				(t: TestItemTreeItem) => t.label,
			]);
		}
		return items;
	}

	public getParent?(element: vs.TreeItem): SuiteTreeItem | GroupTreeItem {
		if (element instanceof TestTreeItem || element instanceof GroupTreeItem)
			return element.parent;
	}

	private updateNode(node?: TestItemTreeItem): void {
		this.onDidChangeTreeDataEmitter.fire(node);
	}

	private updateAllStatuses(suite: SuiteData) {
		// Walk the tree to get the status.
		this.updateStatusFromChildren(suite.node);

		// Update top level list, as we could've changed order.
		this.updateNode();
	}

	private updateStatusFromChildren(node: SuiteTreeItem | GroupTreeItem): TestStatus {
		const childStatuses = node.children.length
			? node.children.filter((c) =>
				(c instanceof GroupTreeItem && !c.isPhantomGroup)
				|| (c instanceof TestTreeItem && !c.hidden),
			).map((c) => {
				if (c instanceof GroupTreeItem)
					return this.updateStatusFromChildren(c);
				if (c instanceof TestTreeItem)
					return c.status;
				return TestStatus.Unknown;
			})
			: [TestStatus.Unknown];

		const newStatus = Math.max.apply(Math, childStatuses);
		if (newStatus !== node.status) {
			node.status = newStatus;
			node.iconPath = getIconPath(node.status);
			this.updateNode(node);
		}
		return node.status;
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}

	private handleNotification(suitePath: string, evt: any) {
		const suite = suites[suitePath];
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
		let suite = suites[evt.suite.path];
		if (!suite) {
			suite = new SuiteData(suitePath, new SuiteTreeItem(evt.suite));
			suites[evt.suite.path] = suite;
		}
		suite.groups.forEach((g) => g.status = TestStatus.Stale);
		suite.tests.forEach((t) => t.status = TestStatus.Stale);
		suite.node.status = TestStatus.Waiting;
		this.updateNode(suite.node);
		this.updateNode();
		// If this is the first suite, we've started a run and can show the tree.
		// We need to wait for the tree node to have been rendered though so setTimeout :(
		if (TestResultsProvider.isNewTestRun) {
			TestResultsProvider.isNewTestRun = false;
			this.onDidStartTestsEmitter.fire(suite.node);
		}
	}

	private handleTestStartNotifcation(suite: SuiteData, evt: TestStartNotification) {
		const isExistingTest = !!suite.tests[evt.test.id];
		const testNode = suite.tests[evt.test.id] || new TestTreeItem(suite, evt.test);
		let oldParent: SuiteTreeItem | GroupTreeItem;

		if (!isExistingTest)
			suite.tests[evt.test.id] = testNode;
		else
			oldParent = testNode.parent;
		testNode.test = evt.test;

		// If this is a "loading" test then mark it as hidden because it looks wonky in
		// the tree with a full path and we already have the "running" icon on the suite.
		if (testNode.test.name.startsWith("loading ") && testNode.parent instanceof SuiteTreeItem)
			testNode.hidden = true;
		else
			testNode.hidden = false;

		// Remove from old parent if required.
		if (oldParent && oldParent !== testNode.parent) {
			oldParent.tests.splice(oldParent.tests.indexOf(testNode), 1);
			this.updateNode(oldParent);
		}

		// Push to new parent if required.
		if (!isExistingTest)
			testNode.parent.tests.push(testNode);

		this.updateNode(testNode);
		this.updateNode(testNode.parent);
		if (!testNode.hidden)
			this.updateAllStatuses(suite);
	}

	private handleTestDoneNotification(suite: SuiteData, evt: TestDoneNotification) {
		const testNode = suite.tests[evt.testID];

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

		this.updateNode(testNode);
		this.updateNode(testNode.parent);
		this.updateAllStatuses(suite);

		if (testNode.status === TestStatus.Failed && TestResultsProvider.nextFailureIsFirst) {
			TestResultsProvider.nextFailureIsFirst = false;
			this.onFirstFailureEmitter.fire(suite.node);
		}
	}

	private handleGroupNotification(suite: SuiteData, evt: GroupNotification) {
		let groupNode: GroupTreeItem;
		if (suite.groups[evt.group.id]) {
			groupNode = suite.groups[evt.group.id];
			groupNode.group = evt.group;
			// TODO: Change parent if required...
		} else {
			groupNode = new GroupTreeItem(suite, evt.group);
			suite.groups[evt.group.id] = groupNode;
			groupNode.parent.groups.push(groupNode);
		}
		suite.groups[evt.group.id].status = TestStatus.Running;
		this.updateNode(groupNode);
		this.updateNode(groupNode.parent);
	}

	private handleSessionEnd(session: vs.DebugSession) {
		// Get the suite paths that have us as the owning debug session.
		const suitePaths = Object.keys(this.owningDebugSessions).filter((suitePath) => this.owningDebugSessions[suitePath] === session);
		// End them all and remove from the lookup.
		for (const suitePath of suitePaths) {
			this.handleSuiteEnd(suites[suitePath]);
			delete this.owningDebugSessions[suitePath];
		}
	}

	private handleSuiteEnd(suite: SuiteData) {
		if (!suite)
			return;

		// TODO: Some notification that things are complete?
		// TODO: Maybe a progress bar during the run?

		// We have to hide all stale results here because we have no reliable way
		// to match up new tests with the previos run. Consider the user runs 10 tests
		// and then runs just one. The ID of the single run in the second run is "1" sp
		// we overwrite the node for "1" and update it's ID, but if it was previously
		// test "5" then we now have a dupe in the tree (one updated, one stale) and
		// the original "1" has vanished.
		suite.tests.filter((t) => t.status === TestStatus.Stale).forEach((t) => {
			t.hidden = true;
			this.updateNode(t.parent);
		});

		// Anything marked as running should be set back to Unknown
		suite.tests.filter((t) => t.status === TestStatus.Running).forEach((t) => {
			t.status = TestStatus.Unknown;
			this.updateNode(t);
		});

		this.updateAllStatuses(suite);
	}

	private handlePrintNotification(suite: SuiteData, evt: PrintNotification) {
		suite.tests[evt.testID].outputEvents.push(evt);
		console.log(`${evt.message}\n`);
	}

	private handleErrorNotification(suite: SuiteData, evt: ErrorNotification) {
		suite.tests[evt.testID].outputEvents.push(evt);
		console.error(evt.error);
		if (evt.stackTrace)
			console.error(evt.stackTrace);
	}
}

class SuiteData {
	public readonly groups: GroupTreeItem[] = [];
	public readonly tests: TestTreeItem[] = [];
	constructor(public readonly path: string, public readonly node: SuiteTreeItem) {
	}
}

class TestItemTreeItem extends vs.TreeItem {
	private _status: TestStatus = TestStatus.Unknown; // tslint:disable-line:variable-name
	// To avoid the sort changing on every status change (stale, running, etc.) this
	// field will be the last status the user would care about (pass/fail/skip).
	// Default to Passed just so things default to the most likely (hopefully) place. This should
	// never be used for rendering; only sorting.
	private _sort: TestSortOrder = TestSortOrder.Middle; // tslint:disable-line:variable-name

	get status(): TestStatus {
		return this._status;
	}

	set status(status: TestStatus) {
		this._status = status;
		this.iconPath = getIconPath(status);

		if (status === TestStatus.Errored || status === TestStatus.Failed
			|| status === TestStatus.Passed
			|| status === TestStatus.Skipped) {
			this._sort = getTestSortOrder(status);
		}
	}

	get sort(): TestSortOrder {
		return this._sort;
	}
}

export class SuiteTreeItem extends TestItemTreeItem {
	private _suite: Suite; // tslint:disable-line:variable-name
	public readonly groups: GroupTreeItem[] = [];
	public readonly tests: TestTreeItem[] = [];

	constructor(suite: Suite) {
		super(vs.Uri.file(suite.path), vs.TreeItemCollapsibleState.Collapsed);
		this.suite = suite;
		this.contextValue = DART_TEST_SUITE_NODE;
		this.resourceUri = vs.Uri.file(suite.path);
		this.id = `suite_${this.suite.path}_${this.suite.id}`;
		this.status = TestStatus.Unknown;
		this.command = { command: "_dart.displaySuite", arguments: [this], title: "" };
	}

	private getLabel(file: string): string {
		const ws = vs.workspace.getWorkspaceFolder(vs.Uri.file(file));
		if (!ws)
			return path.basename(file);
		const rel = path.relative(fsPath(ws.uri), file);
		return rel.startsWith("test/")
			? rel.substr(5)
			: rel;
	}

	get children(): TestItemTreeItem[] {
		// Children should be:
		// 1. All children of any of our phantom groups
		// 2. Our children excluding our phantom groups
		return []
			.concat(_.flatMap(this.groups.filter((g) => g.isPhantomGroup), (g) => g.children))
			.concat(this.groups.filter((g) => !g.isPhantomGroup && !g.hidden))
			.concat(this.tests.filter((t) => !t.hidden));
	}

	get suite(): Suite {
		return this._suite;
	}

	set suite(suite: Suite) {
		this._suite = suite;
		this.label = this.getLabel(suite.path);
	}
}

class GroupTreeItem extends TestItemTreeItem {
	private _group: Group; // tslint:disable-line:variable-name
	public readonly groups: GroupTreeItem[] = [];
	public readonly tests: TestTreeItem[] = [];

	constructor(public suite: SuiteData, group: Group) {
		super(group.name, vs.TreeItemCollapsibleState.Collapsed);
		this.group = group;
		this.contextValue = DART_TEST_GROUP_NODE;
		this.resourceUri = vs.Uri.file(suite.path);
		this.id = `suite_${this.suite.path}_group_${this.group.id}`;
		this.status = TestStatus.Unknown;
		this.command = { command: "_dart.displayGroup", arguments: [this], title: "" };
	}

	get isPhantomGroup() {
		return !this.group.name && this.parent instanceof SuiteTreeItem;
	}

	get hidden(): boolean {
		// If every child is hidden, we are hidden.
		return this.children.every((c) => {
			return (c instanceof GroupTreeItem && c.hidden)
				|| (c instanceof TestTreeItem && c.hidden);
		});
	}

	get parent(): SuiteTreeItem | GroupTreeItem {
		const parent = this.group.parentID
			? this.suite.groups[this.group.parentID]
			: this.suite.node;

		// If our parent is a phantom group at the top level, then just bounce over it.
		if (parent instanceof GroupTreeItem && parent.isPhantomGroup)
			return parent.parent;
		return parent;
	}

	get children(): TestItemTreeItem[] {
		return []
			.concat(this.groups.filter((t) => !t.hidden))
			.concat(this.tests.filter((t) => !t.hidden));
	}

	get group(): Group {
		return this._group;
	}

	set group(group: Group) {
		this._group = group;
		this.label = group.name;
	}
}

class TestTreeItem extends TestItemTreeItem {
	public readonly outputEvents: Array<PrintNotification | ErrorNotification> = [];
	private _test: Test; // tslint:disable-line:variable-name
	constructor(public suite: SuiteData, test: Test, public hidden = false) {
		super(test.name, vs.TreeItemCollapsibleState.None);
		this.test = test;
		this.contextValue = DART_TEST_TEST_NODE;
		this.resourceUri = vs.Uri.file(suite.path);
		this.id = `suite_${this.suite.path}_test_${this.test.id}`;
		this.status = TestStatus.Unknown;
		this.command = { command: "_dart.displayTest", arguments: [this], title: "" };
	}

	get parent(): SuiteTreeItem | GroupTreeItem {
		const parent = this.test.groupIDs && this.test.groupIDs.length
			? this.suite.groups[this.test.groupIDs[this.test.groupIDs.length - 1]]
			: this.suite.node;

		// If our parent is a phantom group at the top level, then just bounce over it.
		if (parent instanceof GroupTreeItem && parent.isPhantomGroup)
			return parent.parent;
		return parent;
	}

	get test(): Test {
		return this._test;
	}

	set test(test: Test) {
		this._test = test;
		this.label = test.name;
		this.outputEvents.length = 0;
	}
}

function getIconPath(status: TestStatus): vs.Uri {
	let file: string;
	switch (status) {
		case TestStatus.Running:
			file = "running";
			break;
		case TestStatus.Passed:
			file = "pass";
			break;
		case TestStatus.Failed:
		case TestStatus.Errored:
			file = "fail";
			break;
		case TestStatus.Skipped:
			file = "skip";
			break;
		case TestStatus.Stale:
		case TestStatus.Unknown:
			file = "stale";
			break;
		case TestStatus.Waiting:
			file = "loading";
			break;
		default:
			file = undefined;
	}

	return file
		? vs.Uri.file(path.join(extensionPath, `media/icons/tests/${file}.svg`))
		: undefined;
}

export enum TestStatus {
	// This should be in order such that the highest number is the one to show
	// when aggregating (eg. from children).
	Stale,
	Waiting,
	Passed,
	Skipped,
	Unknown,
	Failed,
	Errored,
	Running,
}

enum TestSortOrder {
	Top, // Fails
	Middle, // Passes
	Bottom, // Skips
}

function getTestSortOrder(status: TestStatus): TestSortOrder {
	if (status === TestStatus.Failed || status === TestStatus.Errored)
		return TestSortOrder.Top;
	if (status === TestStatus.Skipped)
		return TestSortOrder.Bottom;
	return TestSortOrder.Middle;
}
