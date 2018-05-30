import * as _ from "lodash";
import * as path from "path";
import * as vs from "vscode";
import { extensionPath } from "../extension";
import { fsPath } from "../utils";
import { DoneNotification, ErrorNotification, Group, GroupNotification, PrintNotification, Suite, SuiteNotification, Test, TestDoneNotification, TestStartNotification } from "./test_protocol";

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

	constructor() {
		this.disposables.push(vs.debug.onDidReceiveDebugSessionCustomEvent((e) => {
			if (e.event === "dart.testRunNotification") {
				this.handleNotification(e.body.suitePath, e.body.notification);
			}
		}));
		this.disposables.push(vs.commands.registerCommand("dart.startDebuggingTest", (treeNode: SuiteTreeItem | TestTreeItem) => {
			vs.debug.startDebugging(
				vs.workspace.getWorkspaceFolder(treeNode.resourceUri),
				this.getLaunchConfig(false, treeNode),
			);
		}));
		this.disposables.push(vs.commands.registerCommand("dart.startWithoutDebuggingTest", (treeNode: SuiteTreeItem | TestTreeItem) => {
			vs.debug.startDebugging(
				vs.workspace.getWorkspaceFolder(treeNode.resourceUri),
				this.getLaunchConfig(true, treeNode),
			);
		}));
	}

	private getLaunchConfig(noDebug: boolean, treeNode: SuiteTreeItem | TestTreeItem) {
		return {
			args: treeNode instanceof TestTreeItem ? ["--plain-name", treeNode.test.name] : undefined,
			name: "Tests",
			noDebug,
			program: fsPath(treeNode.resourceUri),
			request: "launch",
			type: "dart",
		};
	}

	public getTreeItem(element: vs.TreeItem): vs.TreeItem {
		return element;
	}

	public getChildren(element?: vs.TreeItem): vs.TreeItem[] {
		if (!element) {
			return _.flatMap(Object.keys(suites).map((k) => suites[k].suites));
		} else if (element instanceof SuiteTreeItem || element instanceof GroupTreeItem) {
			// If we got a Suite and it has only a single phantom child group, then just bounce over it.
			// (but still include its tests so we can see loading...)
			if (element instanceof SuiteTreeItem && element.groups.length === 1 && element.groups[0].isPhantomGroup)
				return []
					.concat(element.tests.filter((t) => !t.hidden))
					.concat(element.groups[0].groups)
					.concat(element.groups[0].tests.filter((t) => !t.hidden));
			else
				return []
					.concat(element.groups)
					.concat(element.tests.filter((t) => !t.hidden));
		}
	}

	public getParent?(element: vs.TreeItem): vs.TreeItem {
		if (!(element instanceof TestTreeItem || element instanceof GroupTreeItem))
			return;
		// If our parent is a phantom group at the top level, then just bounce over it.
		if (element instanceof GroupTreeItem && element.isPhantomGroup && element.parent instanceof GroupTreeItem)
			return element.parent.parent;
		return element.parent;
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}

	private handleNotification(suitePath: string, evt: any) {
		const suite = suites[suitePath];
		switch (evt.type) {
			// case "start":
			// 	this.handleStartNotification(evt as StartNotification);
			// 	break;
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
			case "done":
				this.handleDoneNotification(suite, evt as DoneNotification);
				break;
			case "print":
				this.handlePrintNotification(suite, evt as PrintNotification);
				break;
			case "error":
				this.handleErrorNotification(suite, evt as ErrorNotification);
				break;
		}
	}

	// private handleStartNotification(evt: StartNotification) {}

	// private handleAllSuitesNotification(evt: AllSuitesNotification) {}

	private handleSuiteNotification(suitePath: string, evt: SuiteNotification) {
		let suite = suites[evt.suite.path];
		if (!suite) {
			suite = new SuiteData(suitePath, [new SuiteTreeItem(evt.suite)]);
			suites[evt.suite.path] = suite;
		}
		// If this is the first suite, we've started a run and can show the tree.
		if (evt.suite.id === 0) {
			this.onDidStartTestsEmitter.fire(suite.suites[0]);
		}
		suite.tests.forEach((t) => t.status = TestStatus.Stale);
		if (suite.suites[evt.suite.id]) {
			suite.suites[evt.suite.id].suite = evt.suite;
		} else {
			const suiteNode = new SuiteTreeItem(evt.suite);
			suite.suites[evt.suite.id] = suiteNode;
		}
		this.onDidChangeTreeDataEmitter.fire();
		// suite.suites.forEach((s) => this.onDidChangeTreeDataEmitter.fire(s));
	}

	private handleTestStartNotifcation(suite: SuiteData, evt: TestStartNotification) {
		const isExistingTest = !!suite.tests[evt.test.id];
		const testNode = suite.tests[evt.test.id] || new TestTreeItem(suite, evt.test);
		let oldParent: SuiteTreeItem | GroupTreeItem;

		if (!isExistingTest)
			suite.tests[evt.test.id] = testNode;
		else
			oldParent = testNode.parent;
		testNode.hidden = false;
		testNode.status = TestStatus.Running;
		testNode.test = evt.test;

		// Remove from old parent if required.
		if (oldParent && oldParent !== testNode.parent) {
			oldParent.tests.splice(oldParent.tests.indexOf(testNode), 1);
			this.onDidChangeTreeDataEmitter.fire(oldParent);
		}

		// Push to new parent if required.
		if (!isExistingTest)
			testNode.parent.tests.push(testNode);

		this.onDidChangeTreeDataEmitter.fire(this.getParent(testNode));
		this.onDidChangeTreeDataEmitter.fire(testNode);
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

		this.onDidChangeTreeDataEmitter.fire(this.getParent(testNode));
		this.onDidChangeTreeDataEmitter.fire(testNode);
	}

	private handleGroupNotification(suite: SuiteData, evt: GroupNotification) {
		if (suite.groups[evt.group.id]) {
			const groupNode = suite.groups[evt.group.id];
			groupNode.group = evt.group;
			this.onDidChangeTreeDataEmitter.fire(groupNode);
			// TODO: Change parent if required...
		} else {
			const groupNode = new GroupTreeItem(suite, evt.group);
			suite.groups[evt.group.id] = groupNode;
			groupNode.parent.groups.push(groupNode);
			this.onDidChangeTreeDataEmitter.fire(this.getParent(groupNode));
		}
	}

	private handleDoneNotification(suite: SuiteData, evt: DoneNotification) {
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
			this.onDidChangeTreeDataEmitter.fire(t.parent);
		});
	}

	private handlePrintNotification(suite: SuiteData, evt: PrintNotification) {
		// TODO: Provide a better way of seeing this?
		console.log(`${evt.message}\n`);
	}

	private handleErrorNotification(suite: SuiteData, evt: ErrorNotification) {
		// TODO: Provide a better way of seeing this?
		console.error(evt.error);
		if (evt.stackTrace)
			console.error(evt.stackTrace);
	}
}

class SuiteData {
	constructor(public readonly path: string, public readonly suites: SuiteTreeItem[]) { }
	public readonly groups: GroupTreeItem[] = [];
	public readonly tests: TestTreeItem[] = [];
}

export class SuiteTreeItem extends vs.TreeItem {
	public readonly groups: GroupTreeItem[] = [];
	public readonly tests: TestTreeItem[] = [];

	constructor(public suite: Suite) {
		super(vs.Uri.file(suite.path), vs.TreeItemCollapsibleState.Expanded);
		this.contextValue = DART_TEST_SUITE_NODE;
		this.id = `suite_${this.suite.path}_${this.suite.id}`;
	}
}

class GroupTreeItem extends vs.TreeItem {
	public readonly groups: GroupTreeItem[] = [];
	public readonly tests: TestTreeItem[] = [];

	constructor(public suite: SuiteData, public group: Group) {
		super(group.name, vs.TreeItemCollapsibleState.Expanded);
		this.contextValue = DART_TEST_GROUP_NODE;
		this.id = `suite_${this.suite.path}_group_${this.group.id}`;
	}

	get isPhantomGroup() {
		return !this.group.name && this.parent instanceof SuiteTreeItem;
	}

	get parent(): SuiteTreeItem | GroupTreeItem {
		return this.group.parentID
			? this.suite.groups[this.group.parentID]
			: this.suite.suites[this.group.suiteID];
	}
}

class TestTreeItem extends vs.TreeItem {
	private _test: Test; // tslint:disable-line:variable-name
	private _status: TestStatus; // tslint:disable-line:variable-name
	constructor(public suite: SuiteData, test: Test, public hidden = false) {
		super(test.name, vs.TreeItemCollapsibleState.None);
		this._test = test;
		this.resourceUri = vs.Uri.file(suite.path);
		this.id = `suite_${this.suite.path}_test_${this.test.id}`;
		// TODO: Allow re-running tests/groups/suites
		this.contextValue = DART_TEST_TEST_NODE;
	}

	get parent(): SuiteTreeItem | GroupTreeItem {
		return this.test.groupIDs && this.test.groupIDs.length
			? this.suite.groups[this.test.groupIDs[this.test.groupIDs.length - 1]]
			: this.suite.suites[this.test.suiteID];
	}

	get status(): TestStatus {
		return this._status;
	}

	set status(status: TestStatus) {
		this._status = status;
		this.iconPath = getIconPath(status);
	}

	get test(): Test {
		return this._test;
	}

	set test(test: Test) {
		this._test = test;
		this.label = test.name;
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
		default:
			file = undefined;
	}

	return file
		? vs.Uri.file(path.join(extensionPath, `media/icons/tests/${file}.svg`))
		: undefined;
}

enum TestStatus {
	Stale,
	Unknown,
	Running,
	Skipped,
	Passed,
	Failed,
	Errored,
}
