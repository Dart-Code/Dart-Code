import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../utils";
import { DoneNotification, ErrorNotification, Group, GroupNotification, PrintNotification, StartNotification, Suite, SuiteNotification, Test, TestDoneNotification, TestStartNotification } from "./test_protocol";

const tick = "✓";
const cross = "✖";

export class TestResultsProvider implements vs.Disposable, vs.TreeDataProvider<object> {
	private disposables: vs.Disposable[] = [];
	private onDidChangeTreeDataEmitter: vs.EventEmitter<vs.TreeItem | undefined> = new vs.EventEmitter<vs.TreeItem | undefined>();
	public readonly onDidChangeTreeData: vs.Event<vs.TreeItem | undefined> = this.onDidChangeTreeDataEmitter.event;

	private suites: SuiteTreeItem[] = [];
	private groups: GroupTreeItem[] = [];
	private tests: TestTreeItem[] = [];

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
			return this.suites;
		} else if (element instanceof SuiteTreeItem || element instanceof GroupTreeItem) {
			return [].concat(element.groups).concat(element.tests);
		}
	}

	public getParent?(element: vs.TreeItem): vs.ProviderResult<vs.TreeItem> {
		if (element instanceof GroupTreeItem) {
			return element.group.parentID
				? this.groups[element.group.parentID]
				: this.suites[element.group.suiteID];
		} else if (element instanceof TestTreeItem) {
			return element.groupId
				? this.groups[element.groupId]
				: this.suites[element.test.suiteID];
		}
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}

	private handleNotification(evt: any) {
		console.log(JSON.stringify(evt));
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
		this.tests.forEach((t) => t.status = TestStatus.Stale);
	}

	// private handleAllSuitesNotification(evt: AllSuitesNotification) {}

	private handleSuiteNotification(evt: SuiteNotification) {
		const suiteNode = new SuiteTreeItem(evt.suite);
		this.suites[evt.suite.id] = suiteNode;
		this.onDidChangeTreeDataEmitter.fire();
	}

	private handleTestStartNotifcation(evt: TestStartNotification) {
		const testNode = new TestTreeItem(evt.test);
		this.tests[evt.test.id] = testNode;
		const parent = testNode.groupId
			? this.groups[testNode.groupId]
			: this.suites[testNode.test.suiteID];
		parent.tests.push(testNode);
		this.onDidChangeTreeDataEmitter.fire(parent);
	}

	private handleTestDoneNotification(evt: TestDoneNotification) {
		const testNode = this.tests[evt.testID];

		// If this test should be hidden, remove from its parent
		if (evt.hidden) {
			const parent = testNode.groupId
				? this.groups[testNode.groupId]
				: this.suites[testNode.test.suiteID];
			parent.tests.splice(parent.tests.indexOf(testNode), 1);
			this.onDidChangeTreeDataEmitter.fire(parent);
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
		console.log(`${symbol} ${testNode.label}\n`); // TODO: Fix
	}

	private handleGroupNotification(evt: GroupNotification) {
		const groupNode = new GroupTreeItem(evt.group);
		this.groups[evt.group.id] = groupNode;
		const parent = groupNode.group.parentID
			? this.groups[groupNode.group.parentID]
			: this.suites[groupNode.group.suiteID];
		parent.groups.push(groupNode);
		this.onDidChangeTreeDataEmitter.fire(parent);
	}

	private handleDoneNotification(evt: DoneNotification) {
		if (evt.success)
			console.log("All tests passed!");
		else
			console.error("Some tests failed.");
	}

	private handlePrintNotification(evt: PrintNotification) {
		console.log(`${evt.message}\n`);

	}

	private handleErrorNotification(evt: ErrorNotification) {
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
	}
}

class GroupTreeItem extends vs.TreeItem {
	public readonly groups: GroupTreeItem[] = [];
	public readonly tests: TestTreeItem[] = [];

	constructor(public readonly group: Group) {
		super(group.name, vs.TreeItemCollapsibleState.Expanded);
	}
}

class TestTreeItem extends vs.TreeItem {
	public status = TestStatus.Unknown;
	constructor(public readonly test: Test) {
		super(test.name);
	}

	// get label(): string {
	// 	return `${this.test.name} (${this.status})`;
	// }

	get groupId(): number | undefined {
		return this.test.groupIDs && this.test.groupIDs.length
			? this.test.groupIDs[this.test.groupIDs.length - 1]
			: undefined;
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
