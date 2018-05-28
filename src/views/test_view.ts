import * as path from "path";
import * as vs from "vscode";
import { extensionPath } from "../extension";
import { DoneNotification, ErrorNotification, Group, GroupNotification, PrintNotification, StartNotification, Suite, SuiteNotification, Test, TestDoneNotification, TestStartNotification } from "./test_protocol";

const tick = "✓";
const cross = "✖";

const DART_TEST_SUITE_NODE = "dart-code:testSuiteNode";
const DART_TEST_GROUP_NODE = "dart-code:testGroupNode";
const DART_TEST_TEST_NODE = "dart-code:testTestNode";

const suites: SuiteTreeItem[] = [];
const groups: GroupTreeItem[] = [];
const tests: TestTreeItem[] = [];

export class TestResultsProvider implements vs.Disposable, vs.TreeDataProvider<object> {
	private disposables: vs.Disposable[] = [];
	private onDidChangeTreeDataEmitter: vs.EventEmitter<vs.TreeItem | undefined> = new vs.EventEmitter<vs.TreeItem | undefined>();
	public readonly onDidChangeTreeData: vs.Event<vs.TreeItem | undefined> = this.onDidChangeTreeDataEmitter.event;

	constructor() {
		this.disposables.push(vs.debug.onDidReceiveDebugSessionCustomEvent((e) => {
			if (e.event === "dart.testRunNotification") {
				this.handleNotification(e.body);
			}
		}));
	}

	public getTreeItem(element: vs.TreeItem): vs.TreeItem | Thenable<vs.TreeItem> {
		return element;
	}

	public getChildren(element?: vs.TreeItem): vs.ProviderResult<vs.TreeItem[]> {
		if (!element) {
			return suites;
		} else if (element instanceof SuiteTreeItem || element instanceof GroupTreeItem) {
			// If we got a Suite and it has only a single phantom child group, then just bounce over it.
			if (element instanceof SuiteTreeItem && element.groups.length === 1 && !element.groups[0].group.name)
				return [].concat(element.groups[0].groups).concat(element.groups[0].tests);
			else
				return [].concat(element.groups).concat(element.tests);
		}
	}

	public getParent?(element: vs.TreeItem): vs.ProviderResult<vs.TreeItem> {
		if (element instanceof GroupTreeItem || element instanceof TestTreeItem) {
			// If our parent is a phantom group at the top level, then just bounce over it.
			if (element.parent instanceof GroupTreeItem && !element.parent.group.name && element.parent.parent instanceof SuiteTreeItem)
				return element.parent.parent;
			return element.parent;
		}
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}

	private handleNotification(evt: any) {
		switch (evt.type) {
			case "start":
				this.handleStartNotification(evt as StartNotification);
				break;
			// case "allSuites":
			// 	this.handleAllSuitesNotification(evt as AllSuitesNotification);
			// 	break;
			case "suite":
				this.handleSuiteNotification(evt as SuiteNotification);
				break;
			case "testStart":
				this.handleTestStartNotifcation(evt as TestStartNotification);
				break;
			case "testDone":
				this.handleTestDoneNotification(evt as TestDoneNotification);
				break;
			case "group":
				this.handleGroupNotification(evt as GroupNotification);
				break;
			case "done":
				this.handleDoneNotification(evt as DoneNotification);
				break;
			case "print":
				this.handlePrintNotification(evt as PrintNotification);
				break;
			case "error":
				this.handleErrorNotification(evt as ErrorNotification);
				break;
		}
	}

	private handleStartNotification(evt: StartNotification) {
		tests.forEach((t) => t.status = TestStatus.Stale);
		this.onDidChangeTreeDataEmitter.fire();
	}

	// private handleAllSuitesNotification(evt: AllSuitesNotification) {}

	private handleSuiteNotification(evt: SuiteNotification) {
		if (suites[evt.suite.id]) {
			suites[evt.suite.id].suite = evt.suite;
		} else {
			const suiteNode = new SuiteTreeItem(evt.suite);
			suites[evt.suite.id] = suiteNode;
		}
		this.onDidChangeTreeDataEmitter.fire();
	}

	private handleTestStartNotifcation(evt: TestStartNotification) {
		if (tests[evt.test.id]) {
			const testNode = tests[evt.test.id];
			const oldParent = testNode.parent;
			testNode.test = evt.test;
			this.onDidChangeTreeDataEmitter.fire(testNode);
			if (oldParent !== testNode.parent) {
				// TODO: Re-parent...
			}
		} else {
			const testNode = new TestTreeItem(evt.test);
			tests[evt.test.id] = testNode;
			testNode.status = TestStatus.Running;
			testNode.parent.tests.push(testNode);
			this.onDidChangeTreeDataEmitter.fire(testNode.parent);
		}
	}

	private handleTestDoneNotification(evt: TestDoneNotification) {
		const testNode = tests[evt.testID];

		// If this test should be hidden, remove from its parent
		if (evt.hidden) {
			testNode.parent.tests.splice(testNode.parent.tests.indexOf(testNode), 1);
			this.onDidChangeTreeDataEmitter.fire(testNode.parent);
			return;
		}
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
		this.onDidChangeTreeDataEmitter.fire(testNode);

		// TODO: Remove this
		const pass = evt.result === "success";
		const symbol = pass ? tick : cross;
	}

	private handleGroupNotification(evt: GroupNotification) {
		if (groups[evt.group.id]) {
			const groupNode = groups[evt.group.id];
			groupNode.group = evt.group;
			this.onDidChangeTreeDataEmitter.fire(groupNode);
			// TODO: Change parent if required...
		} else {
			const groupNode = new GroupTreeItem(evt.group);
			groups[evt.group.id] = groupNode;
			groupNode.parent.groups.push(groupNode);
			this.onDidChangeTreeDataEmitter.fire(groupNode.parent);
		}
	}

	private handleDoneNotification(evt: DoneNotification) {
		// TODO: Some notification that things are complete?
		// TODO: Maybe a progress bar during the run?
	}

	private handlePrintNotification(evt: PrintNotification) {
		// TODO: Provide a better way of seeing this?
		console.log(`${evt.message}\n`);
	}

	private handleErrorNotification(evt: ErrorNotification) {
		// TODO: Provide a better way of seeing this?
		console.error(evt.error);
		if (evt.stackTrace)
			console.error(evt.stackTrace);
	}
}

class SuiteTreeItem extends vs.TreeItem {
	public readonly groups: GroupTreeItem[] = [];
	public readonly tests: TestTreeItem[] = [];

	constructor(public suite: Suite) {
		super(vs.Uri.file(suite.path), vs.TreeItemCollapsibleState.Expanded);
		this.contextValue = DART_TEST_SUITE_NODE;
		this.id = `suite_${this.suite.id}`;
	}
}

class GroupTreeItem extends vs.TreeItem {
	public readonly groups: GroupTreeItem[] = [];
	public readonly tests: TestTreeItem[] = [];

	constructor(public group: Group) {
		super(group.name, vs.TreeItemCollapsibleState.Expanded);
		this.contextValue = DART_TEST_GROUP_NODE;
		this.id = `group_${this.group.id}`;
	}

	get parent(): SuiteTreeItem | GroupTreeItem {
		return this.group.parentID
			? groups[this.group.parentID]
			: suites[this.group.suiteID];
	}
}

class TestTreeItem extends vs.TreeItem {
	constructor(public test: Test) {
		super(test.name, vs.TreeItemCollapsibleState.None);
		// TODO: Allow re-running tests/groups/suites
		this.contextValue = DART_TEST_TEST_NODE;
	}

	get parent(): SuiteTreeItem | GroupTreeItem {
		return this.test.groupIDs && this.test.groupIDs.length
			? groups[this.test.groupIDs[this.test.groupIDs.length - 1]]
			: suites[this.test.suiteID];
	}

	set status(status: TestStatus) {
		this.label = `${this.test.name} (${TestStatus[status]})`;
		this.id = `test_${this.test.id}`;
		switch (status) {
			case TestStatus.Running:
				this.iconPath = this.getIconPath("running");
			case TestStatus.Passed:
				this.iconPath = this.getIconPath("pass");
			case TestStatus.Failed:
			case TestStatus.Errored:
				this.iconPath = this.getIconPath("fail");
			case TestStatus.Skipped:
				this.iconPath = this.getIconPath("skip");
			default:
				this.iconPath = null;
		}
	}

	private getIconPath(name: string): { light: vs.Uri, dark: vs.Uri } {
		return {
			dark: vs.Uri.file(path.join(extensionPath, `media/icons/tests/${name}_white.svg`)),
			light: vs.Uri.file(path.join(extensionPath, `media/icons/tests/${name}_black.svg`)),
		};
	}
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
