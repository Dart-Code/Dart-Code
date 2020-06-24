import * as path from "path";
import * as vs from "vscode";
import { DART_TEST_GROUP_NODE_CONTEXT, DART_TEST_SUITE_NODE_CONTEXT, DART_TEST_TEST_NODE_CONTEXT } from "../../shared/constants";
import { TestStatus } from "../../shared/enums";
import { Logger } from "../../shared/interfaces";
import { ErrorNotification, Group, GroupNotification, PrintNotification, Suite, SuiteNotification, Test, TestDoneNotification, TestStartNotification } from "../../shared/test_protocol";
import { flatMap, uniq } from "../../shared/utils";
import { sortBy } from "../../shared/utils/array";
import { fsPath } from "../../shared/utils/fs";
import { getLaunchConfig } from "../../shared/utils/test";
import { extensionPath } from "../../shared/vscode/extension_utils";
import { getChannel } from "../commands/channels";

// TODO: Refactor all of this crazy logic out of test_view into its own class, so that consuming the test results is much
// simpler and disconnected from the view!
const suites: { [key: string]: SuiteData } = {};

export class TestResultsProvider implements vs.Disposable, vs.TreeDataProvider<TestItemTreeItem> {
	private disposables: vs.Disposable[] = [];
	private onDidChangeTreeDataEmitter: vs.EventEmitter<TestItemTreeItem | undefined> = new vs.EventEmitter<TestItemTreeItem | undefined>();
	public readonly onDidChangeTreeData: vs.Event<TestItemTreeItem | undefined> = this.onDidChangeTreeDataEmitter.event;
	private onDidStartTestsEmitter: vs.EventEmitter<TestItemTreeItem> = new vs.EventEmitter<TestItemTreeItem>();
	public readonly onDidStartTests: vs.Event<TestItemTreeItem> = this.onDidStartTestsEmitter.event;
	private onFirstFailureEmitter: vs.EventEmitter<TestItemTreeItem> = new vs.EventEmitter<TestItemTreeItem>();
	public readonly onFirstFailure: vs.Event<TestItemTreeItem> = this.onFirstFailureEmitter.event;
	private currentSelectedNode: TestItemTreeItem | undefined;

	// Set this flag we know when a new run starts so we can show the tree; however
	// we can't show it until we render a node (we can only call reveal on a node) so
	// we need to delay this until the suite starts.
	private static isNewTestRun = true;
	private static nextFailureIsFirst = true;

	public static flagSuiteStart(suitePath: string, isRunningWholeSuite: boolean): void {
		TestResultsProvider.isNewTestRun = true;
		TestResultsProvider.nextFailureIsFirst = true;

		// When running the whole suite, we flag all tests as being potentially deleted
		// and then any tests that aren't run are removed from the tree. This is to ensure
		// if a test is renamed, we don't keep the old version of it in the test tree forever
		// since we don't have the necessary information to know the test was renamed.
		if (isRunningWholeSuite && suitePath && path.isAbsolute(suitePath)) {
			const suite = suites[fsPath(suitePath)];
			// If we didn't find the suite, we may be running the whole lot, so
			// we should mark everything from all suites as potentially deleted.
			const suitesBeingRun = suite ? [suite] : Object.values(suites);
			for (const suite of suitesBeingRun) {
				suite.getAllGroups().forEach((g) => g.isPotentiallyDeleted = true);
				suite.getAllTests().forEach((t) => t.isPotentiallyDeleted = true);
			}
		}

		// Mark all tests everywhere as "stale" which will make them faded, so that results from
		// the "new" run are more obvious in the tree.
		// All increase the currentRunNumber to ensure we know all results are from
		// the newest run.
		Object.keys(suites).forEach((p) => {
			const suite = suites[fsPath(p)];
			suite.currentRunNumber++;
			suite.getAllGroups().forEach((g) => g.isStale = true);
			suite.getAllTests().forEach((t) => t.isStale = true);
		});
	}

	public setSelectedNodes(item: TestItemTreeItem | undefined): void {
		this.currentSelectedNode = item;
	}

	private owningDebugSessions: { [key: string]: vs.DebugSession | undefined } = {};

	constructor(private readonly logger: Logger) {
		this.disposables.push(vs.debug.onDidReceiveDebugSessionCustomEvent((e) => this.handleDebugSessionCustomEvent(e)));
		this.disposables.push(vs.debug.onDidTerminateDebugSession((session) => this.handleDebugSessionEnd(session)));
		this.disposables.push(vs.commands.registerCommand("dart.startDebuggingTest", (treeNode: SuiteTreeItem | GroupTreeItem | TestTreeItem) => {
			const testName = treeNode instanceof TestTreeItem
				? treeNode.test.name
				: treeNode instanceof GroupTreeItem
					? treeNode.group.name
					: undefined;
			vs.debug.startDebugging(
				vs.workspace.getWorkspaceFolder(treeNode.resourceUri!),
				getLaunchConfig(
					false,
					fsPath(treeNode.resourceUri!),
					testName,
					treeNode instanceof GroupTreeItem,
				),
			);
		}));
		this.disposables.push(vs.commands.registerCommand("dart.startWithoutDebuggingTest", (treeNode: SuiteTreeItem | GroupTreeItem | TestTreeItem) => {
			const testName = treeNode instanceof TestTreeItem
				? treeNode.test.name
				: treeNode instanceof GroupTreeItem
					? treeNode.group.name
					: undefined;
			vs.debug.startDebugging(
				vs.workspace.getWorkspaceFolder(treeNode.resourceUri!),
				getLaunchConfig(
					true,
					fsPath(treeNode.resourceUri!),
					testName,
					treeNode instanceof GroupTreeItem,
				),
			);
		}));

		this.disposables.push(vs.commands.registerCommand("_dart.displaySuite", (treeNode: SuiteTreeItem) => {
			return vs.commands.executeCommand("_dart.jumpToLineColInUri", vs.Uri.file(treeNode.suite.path));
		}));
		this.disposables.push(vs.commands.registerCommand("_dart.displayGroup", (treeNode: GroupTreeItem) => {
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
		this.disposables.push(vs.commands.registerCommand("_dart.displayTest", (treeNode: TestTreeItem) => {
			this.writeTestOutput(treeNode, true);
			if (!treeNode.test.url && !treeNode.test.root_url)
				return;
			return vs.commands.executeCommand(
				"_dart.jumpToLineColInUri",
				vs.Uri.parse((treeNode.test.root_url || treeNode.test.url)!),
				treeNode.test.root_line || treeNode.test.line,
				treeNode.test.root_column || treeNode.test.column,
			);
		}));
	}

	private writeTestOutput(treeNode: TestTreeItem, forceShow = false) {
		const output = getChannel("Test Output");
		output.clear();
		if (forceShow)
			output.show(true);

		output.appendLine(`${treeNode.test.name}:\n`);

		if (!treeNode.outputEvents.length)
			output.appendLine(`(no output)`);

		for (const o of treeNode.outputEvents) {
			this.appendTestOutput(o, output);
		}
	}

	private appendTestOutput(event: PrintNotification | ErrorNotification, output = getChannel("Test Output")) {
		if (event.type === "error") {
			event = event as ErrorNotification;
			output.appendLine(`ERROR: ${event.error}`);
			output.appendLine(event.stackTrace);
		} else if (event.type === "print") {
			event = event as PrintNotification;
			output.appendLine(event.message);
		} else {
			output.appendLine(`Unknown message type '${event.type}'.`);
		}
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
			items = items.sort((a, b) => {
				// Sort by .sort first.
				if (a.sort > b.sort) return 1;
				if (a.sort < b.sort) return -1;
				// If they're the same, sort by label.
				const aLabel = a.label || (a.resourceUri ? a.resourceUri.toString() : "");
				const bLabel = b.label || (b.resourceUri ? b.resourceUri.toString() : "");
				if (aLabel > bLabel) return 1;
				if (aLabel < bLabel) return -1;
				return 0;
			});
		}
		return items;
	}

	public getParent?(element: vs.TreeItem): SuiteTreeItem | GroupTreeItem | undefined {
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
			node.iconPath = getIconPath(node.status, false);
			this.updateNode(node);
		}
		return node.status;
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}

	private async handleNotification(suitePath: string, evt: any): Promise<void> {
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
		let oldParent: SuiteTreeItem | GroupTreeItem | undefined;
		const existingTest = suite.getCurrentTest(evt.test.id) || suite.reuseMatchingTest(suite.currentRunNumber, evt.test, (parent) => oldParent = parent);
		const testNode = existingTest || new TestTreeItem(suite, evt.test);

		if (!existingTest)
			suite.storeTest(evt.test.id, testNode);
		testNode.test = evt.test;

		// If this is a "loading" test then mark it as hidden because it looks wonky in
		// the tree with a full path and we already have the "running" icon on the suite.
		if (testNode.test.name && testNode.test.name.startsWith("loading ") && testNode.parent instanceof SuiteTreeItem)
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
		if (evt.time)
			testNode.description = `${evt.time}ms`;

		this.updateNode(testNode);
		this.updateNode(testNode.parent);
		this.updateAllStatuses(suite);

		if ((testNode.status === TestStatus.Failed || testNode.status === TestStatus.Errored) && TestResultsProvider.nextFailureIsFirst) {
			TestResultsProvider.nextFailureIsFirst = false;
			this.onFirstFailureEmitter.fire(testNode);
		}
	}

	private handleGroupNotification(suite: SuiteData, evt: GroupNotification) {
		let oldParent: SuiteTreeItem | GroupTreeItem | undefined;
		const existingGroup = suite.getCurrentGroup(evt.group.id) || suite.reuseMatchingGroup(suite.currentRunNumber, evt.group, (parent) => oldParent = parent);
		const groupNode = existingGroup || new GroupTreeItem(suite, evt.group);

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
			this.handleSuiteEnd(suites[suitePath]);
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

class SuiteData {
	// To avoid collissions in IDs across runs, we increment this number on every
	// run of this suite and then use it as a prefix when looking up IDs. This allows
	// older (stale) results not to be looked up when using IDs.
	public currentRunNumber = 1;
	private readonly groups: { [key: string]: GroupTreeItem } = {};
	private readonly tests: { [key: string]: TestTreeItem } = {};
	constructor(public readonly path: string, public readonly node: SuiteTreeItem) { }

	public getAllGroups(includeHidden = false) {
		// Have to unique these, as we keep dupes in the lookup with the "old" IDs
		// so that stale nodes can still look up their parents.
		return uniq(
			Object.keys(this.groups)
				.map((gKey) => this.groups[gKey])
				.filter((g) => includeHidden || (!g.hidden && !g.isPhantomGroup)),
		);
	}
	public getAllTests(includeHidden = false) {
		// Have to unique these, as we keep dupes in the lookup with the "old" IDs
		// so that stale nodes can still look up their parents.
		return uniq(
			Object.keys(this.tests)
				.map((tKey) => this.tests[tKey])
				.filter((t) => includeHidden || !t.hidden),
		);
	}
	public getCurrentGroup(id: number) {
		return this.groups[`${this.currentRunNumber}_${id}`];
	}
	public getCurrentTest(id: number) {
		return this.tests[`${this.currentRunNumber}_${id}`];
	}
	public getMyGroup(suiteRunNumber: number, id: number) {
		return this.groups[`${suiteRunNumber}_${id}`];
	}
	public getMyTest(suiteRunNumber: number, id: number) {
		return this.tests[`${suiteRunNumber}_${id}`];
	}
	public storeGroup(id: number, node: GroupTreeItem) {
		return this.groups[`${this.currentRunNumber}_${id}`] = node;
	}
	public storeTest(id: number, node: TestTreeItem) {
		return this.tests[`${this.currentRunNumber}_${id}`] = node;
	}
	public reuseMatchingGroup(currentSuiteRunNumber: number, group: Group, handleOldParent: (parent: SuiteTreeItem | GroupTreeItem) => void): GroupTreeItem | undefined {
		// To reuse a node, the name must match and it must have not been used for the current run.
		const matches = this.getAllGroups().filter((g) => {
			return g.group.name === group.name
				&& g.suiteRunNumber !== currentSuiteRunNumber;
		});
		// Reuse the one nearest to the source position.
		const sortedMatches = matches.sort((g1, g2) => Math.abs((g1.group.line || 0) - (group.line || 0)) - Math.abs((g2.group.line || 0) - (group.line || 0)));
		const match = sortedMatches.length ? sortedMatches[0] : undefined;
		if (match) {
			handleOldParent(match.parent);
			match.suiteRunNumber = this.currentRunNumber;
			this.storeGroup(group.id, match);
		}
		return match;
	}
	public reuseMatchingTest(currentSuiteRunNumber: number, test: Test, handleOldParent: (parent: SuiteTreeItem | GroupTreeItem) => void): TestTreeItem | undefined {
		// To reuse a node, the name must match and it must have not been used for the current run.
		const matches = this.getAllTests().filter((t) => {
			return t.test.name === test.name
				&& t.suiteRunNumber !== currentSuiteRunNumber;
		});
		// Reuse the one nearest to the source position.
		const sortedMatches = sortBy(matches, (t) => Math.abs((t.test.line || 0) - (test.line || 0)));
		const match = sortedMatches.length ? sortedMatches[0] : undefined;
		if (match) {
			handleOldParent(match.parent);
			match.suiteRunNumber = this.currentRunNumber;
			this.storeTest(test.id, match);
		}
		return match;
	}
}

export abstract class TestItemTreeItem extends vs.TreeItem {
	private _isStale = false; // tslint:disable-line:variable-name
	private _status: TestStatus = TestStatus.Unknown; // tslint:disable-line:variable-name
	// To avoid the sort changing on every status change (stale, running, etc.) this
	// field will be the last status the user would care about (pass/fail/skip).
	// Default to Passed just so things default to the most likely (hopefully) place. This should
	// never be used for rendering; only sorting.
	private _sort: TestSortOrder = TestSortOrder.Middle; // tslint:disable-line:variable-name
	public suiteRunNumber = 0;
	public isPotentiallyDeleted = false;

	get status(): TestStatus {
		return this._status;
	}

	set status(status: TestStatus) {
		this._status = status;
		this.iconPath = getIconPath(status, this.isStale);
		this.description = undefined; // Clear old run duration.

		if (status === TestStatus.Errored || status === TestStatus.Failed
			|| status === TestStatus.Passed
			|| status === TestStatus.Skipped) {
			this.isStale = false;
			this.isPotentiallyDeleted = false;
			this._sort = getTestSortOrder(status);
		}
	}

	get isStale(): boolean {
		return this._isStale;
	}

	set isStale(isStale: boolean) {
		this._isStale = isStale;
		this.iconPath = getIconPath(this.status, this.isStale);
	}

	get sort(): TestSortOrder {
		return this._sort;
	}
}

export class SuiteTreeItem extends TestItemTreeItem {
	public readonly groups: GroupTreeItem[] = [];
	public readonly tests: TestTreeItem[] = [];

	constructor(public readonly suite: Suite) {
		super(vs.Uri.file(suite.path), vs.TreeItemCollapsibleState.Collapsed);
		this.contextValue = DART_TEST_SUITE_NODE_CONTEXT;
		this.resourceUri = vs.Uri.file(suite.path);
		this.description = true;
		this.id = `suite_${this.suite.path}_${this.suiteRunNumber}_${this.suite.id}`;
		this.status = TestStatus.Unknown;
		this.command = { command: "_dart.displaySuite", arguments: [this], title: "" };
	}

	get children(): TestItemTreeItem[] {
		// Children should be:
		// 1. All children of any of our phantom groups
		// 2. Our children excluding our phantom groups
		return [
			...flatMap(this.groups.filter((g) => g.isPhantomGroup), (g) => g.children),
			...this.groups.filter((g) => !g.isPhantomGroup && !g.hidden),
			...this.tests.filter((t) => !t.hidden),
		];
	}
}

class GroupTreeItem extends TestItemTreeItem {
	private _group: Group; // tslint:disable-line:variable-name
	public readonly groups: GroupTreeItem[] = [];
	public readonly tests: TestTreeItem[] = [];

	constructor(public suite: SuiteData, group: Group) {
		super(group.name || "<unnamed>", vs.TreeItemCollapsibleState.Collapsed);
		this.suiteRunNumber = suite.currentRunNumber;
		this._group = group; // Keep TS happy, but then we need to call the setter.
		this.group = group;
		this.contextValue = DART_TEST_GROUP_NODE_CONTEXT;
		this.resourceUri = vs.Uri.file(suite.path);
		this.id = `suite_${this.suite.path}_${this.suiteRunNumber}_group_${this.group.id}`;
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
			? this.suite.getMyGroup(this.suiteRunNumber, this.group.parentID)
			: this.suite.node;

		// If our parent is a phantom group at the top level, then just bounce over it.
		if (parent instanceof GroupTreeItem && parent.isPhantomGroup)
			return parent.parent;
		return parent;
	}

	get children(): TestItemTreeItem[] {
		return ([] as TestItemTreeItem[])
			.concat(this.groups.filter((t) => !t.hidden))
			.concat(this.tests.filter((t) => !t.hidden));
	}

	get group(): Group {
		return this._group;
	}

	set group(group: Group) {
		this._group = group;
		const parent = this.parent;
		this.label = parent && parent instanceof GroupTreeItem && parent.fullName && group.name && group.name.startsWith(`${parent.fullName} `)
			? group.name.substr(parent.fullName.length + 1) // +1 because of the space (included above).
			: group.name;
	}

	get fullName(): string | undefined {
		return this._group.name;
	}
}

class TestTreeItem extends TestItemTreeItem {
	public readonly outputEvents: Array<PrintNotification | ErrorNotification> = [];
	private _test: Test; // tslint:disable-line:variable-name
	constructor(public suite: SuiteData, test: Test, public hidden = false) {
		super(test.name || "<unnamed>", vs.TreeItemCollapsibleState.None);
		this.suiteRunNumber = suite.currentRunNumber;
		this._test = test; // Keep TS happy, but then we need to call the setter.
		this.test = test;
		this.contextValue = DART_TEST_TEST_NODE_CONTEXT;
		this.resourceUri = vs.Uri.file(suite.path);
		this.id = `suite_${this.suite.path}_${this.suiteRunNumber}_test_${this.test.id}`;
		this.status = TestStatus.Unknown;
		this.command = { command: "_dart.displayTest", arguments: [this], title: "" };
	}

	get parent(): SuiteTreeItem | GroupTreeItem {
		const parent = this.test.groupIDs && this.test.groupIDs.length
			? this.suite.getMyGroup(this.suiteRunNumber, this.test.groupIDs[this.test.groupIDs.length - 1])
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
		this.outputEvents.length = 0;

		// Update the label.
		const parent = this.parent;
		this.label = parent && parent instanceof GroupTreeItem && parent.fullName && test.name && test.name.startsWith(`${parent.fullName} `)
			? test.name.substr(parent.fullName.length + 1) // +1 because of the space (included above).
			: (test.name || "<unnamed>");
	}

	get fullName(): string | undefined {
		return this._test.name;
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

enum TestSortOrder {
	Top, // Fails
	Middle, // Passes
	Bottom, // Skips
}

function getTestSortOrder(status: TestStatus): TestSortOrder {
	if (status === TestStatus.Failed || status === TestStatus.Errored)
		return TestSortOrder.Top;
	// https://github.com/Dart-Code/Dart-Code/issues/1125
	// if (status === TestStatus.Skipped)
	// 	return TestSortOrder.Bottom;
	return TestSortOrder.Middle;
}
