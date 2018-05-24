import * as vs from "vscode";

const tick = "✓";
const cross = "✖";

export class TestResultsProvider implements vs.Disposable, vs.TreeDataProvider<object> {
	private disposables: vs.Disposable[] = [];
	private onDidChangeTreeDataEmitter: vs.EventEmitter<vs.TreeItem | undefined> = new vs.EventEmitter<vs.TreeItem | undefined>();
	public readonly onDidChangeTreeData: vs.Event<vs.TreeItem | undefined> = this.onDidChangeTreeDataEmitter.event;

	private suites: Suite[] = [];
	private groups: Group[] = [];
	private tests: Test[] = [];

	constructor() {
		this.disposables.push(vs.debug.onDidReceiveDebugSessionCustomEvent((e) => {
			if (e.event === "dart.testRunNotification") {
				this.handleNotification(e.body);
			}
		}));
	}

	public getTreeItem(element: vs.TreeItem): vs.TreeItem | Thenable<vs.TreeItem> {
		throw new Error("Method not implemented.");
	}

	public getChildren(element?: vs.TreeItem): vs.ProviderResult<vs.TreeItem[]> {
		throw new Error("Method not implemented.");
	}

	public getParent?(element: vs.TreeItem): vs.ProviderResult<vs.TreeItem> {
		throw new Error("Method not implemented.");
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}

	private handleNotification(evt: any) {
		switch (evt.type) {
			case "start":
				this.handleStartNotification(evt as StartNotification);
				break;
			case "allSuites":
				this.handleAllSuitesNotification(evt as AllSuitesNotification);
				break;
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
		// TODO: ...
	}

	private handleAllSuitesNotification(evt: AllSuitesNotification) {
		// TODO ...
	}

	private handleSuiteNotification(evt: SuiteNotification) {
		this.suites[evt.suite.id] = evt.suite;
	}

	private handleTestStartNotifcation(evt: TestStartNotification) {
		this.tests[evt.test.id] = evt.test;
	}

	private handleTestDoneNotification(evt: TestDoneNotification) {
		if (evt.hidden)
			return;
		const test = this.tests[evt.testID];
		const pass = evt.result === "success";
		const symbol = pass ? tick : cross;
		console.log(`${symbol} ${test.name}\n`); // TODO: Fix
	}

	private handleGroupNotification(evt: GroupNotification) {
		this.groups[evt.group.id] = evt.group;
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

export interface Notification {
	type: string;
	time: number;
}

export interface StartNotification extends Notification {
	protocolVersion: string;
	runnerVersion?: string;
}

export interface AllSuitesNotification extends Notification {
	count: number;
}

export interface SuiteNotification extends Notification {
	suite: Suite;
}

export interface Suite {
	id: number;
	platform: string;
	path: string;
}

export interface TestNotification extends Notification {
	test: Test;
}

export interface Item {
	id: number;
	name?: string;
	suiteID: number;
	metadata: Metadata;
	line?: number;
	column?: number;
	url?: string;
}

export interface Test extends Item {
	groupIDs: Group[];
}

export interface Metadata {
	skip: boolean;
	skipReason?: string;
}

export interface GroupNotification extends Notification {
	group: Group;
}

export interface Group extends Item {
	parentID?: number;
	testCount: number;
}

export interface TestStartNotification extends Notification {
	test: Test;
}

export interface TestDoneNotification extends Notification {
	testID: number;
	result: "success" | "failure" | "error";
	skipped: boolean;
	hidden: boolean;
}

export interface DoneNotification extends Notification {
	success: boolean;
}

export interface PrintNotification extends Notification {
	testID: number;
	messageType: string;
	message: string;
}

export interface ErrorNotification extends Notification {
	testID: number;
	error: string;
	stackTrace: string;
	isFailure: boolean;
}
