import { TestStatus } from "../enums";
import { Event, EventEmitter } from "../events";
import { IAmDisposable, Logger } from "../interfaces";
import { ErrorNotification, GroupNotification, Notification, PrintNotification, SuiteNotification, TestDoneNotification, TestStartNotification } from "../test_protocol";
import { disposeAll, uriToFilePath } from "../utils";
import { GroupNode, SuiteData, SuiteNode, TestNode, TestTreeModel, TreeNode } from "./test_model";

/// Handles results from a test debug session and provides them to the test model.
export class TestSessionCoordinator implements IAmDisposable {
	private disposables: IAmDisposable[] = [];

	private onDidStartTestsEmitter: EventEmitter<TreeNode> = new EventEmitter<TreeNode>();
	public readonly onDidStartTests: Event<TreeNode> = this.onDidStartTestsEmitter.event;
	private onFirstFailureEmitter: EventEmitter<TreeNode> = new EventEmitter<TreeNode>();
	public readonly onFirstFailure: Event<TreeNode> = this.onFirstFailureEmitter.event;

	/// A link between a suite path and the debug session ID that owns it.
	private owningDebugSessions: { [key: string]: string | undefined } = {};

	constructor(private readonly logger: Logger, private readonly data: TestTreeModel) { }

	public handleDebugSessionCustomEvent(e: { session: { id: string }; event: string; body?: any }) {
		if (e.event === "dart.testRunNotification") {
			// tslint:disable-next-line: no-floating-promises
			// TODO: Why do we get no session in tests???
			this.handleNotification(e.session?.id, e.body.suitePath, e.body.notification).catch((e) => this.logger.error(e));
		}
	}

	public handleDebugSessionEnd(debugSessionID: string) {
		// Get the suite paths that have us as the owning debug session.
		const suitePaths = Object.keys(this.owningDebugSessions).filter((suitePath) => {
			const owningSessionID = this.owningDebugSessions[suitePath];
			return owningSessionID === debugSessionID;
		});

		// End them all and remove from the lookup.
		for (const suitePath of suitePaths) {
			this.handleSuiteEnd(this.data.suites[suitePath]);
			this.owningDebugSessions[suitePath] = undefined;
			delete this.owningDebugSessions[suitePath];
		}
	}

	public async handleNotification(debugSessionID: string | undefined, suitePath: string, evt: Notification): Promise<void> {
		// If we're starting a suite, record us as the owner so we can clean up later
		if (evt.type === "suite")
			this.owningDebugSessions[suitePath] = debugSessionID;

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
		const [suite, didCreate] = this.data.getOrCreateSuite(evt.suite.path);
		suite.node.appendStatus(TestStatus.Waiting);
		this.data.updateNode(suite.node);
		this.data.updateNode();
		// If this is the first suite, we've started a run and can show the tree.
		// We need to wait for the tree node to have been rendered though so setTimeout :(
		if (this.data.isNewTestRun) {
			this.data.isNewTestRun = false;
			this.onDidStartTestsEmitter.fire(suite.node);
		}
	}

	private handleTestStartNotifcation(suite: SuiteData, evt: TestStartNotification) {
		const existingTest = suite.getCurrentTest(evt.test.id) || suite.reuseMatchingTest(suite.currentRunNumber, evt.test);
		const oldParent = existingTest?.parent;
		const parent = evt.test.groupIDs?.length ? suite.getMyGroup(suite.currentRunNumber, evt.test.groupIDs[evt.test.groupIDs.length - 1]) : suite.node;
		const path = (evt.test.root_url || evt.test.url) ? uriToFilePath(evt.test.root_url || evt.test.url!) : undefined;
		const line = evt.test.root_line || evt.test.line;
		const column = evt.test.root_column || evt.test.column;
		const testNode = existingTest || new TestNode(suite, parent, evt.test.id, evt.test.name, path, line, column);

		if (!existingTest) {
			suite.storeTest(testNode);
		} else {
			testNode.parent = parent;
			testNode.id = evt.test.id;
			testNode.name = evt.test.name;
			testNode.path = path;
			testNode.line = line;
			testNode.column = column;
		}
		testNode.testStartTime = evt.time;

		// If this is a "loading" test then mark it as hidden because it looks wonky in
		// the tree with a full path and we already have the "running" icon on the suite.
		if (testNode.name && testNode.name.startsWith("loading ") && testNode.parent instanceof SuiteNode)
			testNode.hidden = true;
		else
			testNode.hidden = false;

		// Remove from old parent if required.
		const hasChangedParent = oldParent && oldParent !== testNode.parent;
		if (oldParent && hasChangedParent) {
			oldParent.tests.splice(oldParent.tests.indexOf(testNode), 1);
			this.data.updateNode(oldParent);
		}

		// Push to new parent if required.
		if (!existingTest || hasChangedParent)
			testNode.parent.tests.push(testNode);

		testNode.status = TestStatus.Running;
		this.data.updateNode(testNode);
		this.data.updateNode(testNode.parent);
		if (!testNode.hidden)
			this.data.rebuildSuiteNode(suite);
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
			testNode.status = TestStatus.Failed;
		else {
			testNode.status = TestStatus.Unknown;
		}
		if (evt.time && testNode.testStartTime) {
			testNode.duration = evt.time - testNode.testStartTime;
			testNode.description = `${testNode.duration}ms`;
			// Don't clear this, as concurrent runs will overwrite each
			// other and then we'll get no time at the end.
			// testNode.testStartTime = undefined;
		}

		this.data.updateNode(testNode);
		this.data.updateNode(testNode.parent);
		this.data.rebuildSuiteNode(suite);

		if (testNode.status === TestStatus.Failed && this.data.nextFailureIsFirst) {
			this.data.nextFailureIsFirst = false;
			this.onFirstFailureEmitter.fire(testNode);
		}
	}

	private handleGroupNotification(suite: SuiteData, evt: GroupNotification) {
		const existingGroup = suite.getCurrentGroup(evt.group.id) || suite.reuseMatchingGroup(suite.currentRunNumber, evt.group);
		const oldParent = existingGroup?.parent;
		const parent = evt.group.parentID ? suite.getMyGroup(suite.currentRunNumber, evt.group.parentID) : suite.node;
		const path = (evt.group.root_url || evt.group.url) ? uriToFilePath(evt.group.root_url || evt.group.url!) : undefined;
		const line = evt.group.root_line || evt.group.line;
		const column = evt.group.root_column || evt.group.column;
		const groupNode = existingGroup || new GroupNode(suite, parent, evt.group.id, evt.group.name, path, line, column);

		if (!existingGroup) {
			suite.storeGroup(groupNode);
		} else {
			groupNode.parent = parent;
			groupNode.id = evt.group.id;
			groupNode.name = evt.group.name;
			groupNode.path = path;
			groupNode.line = line;
			groupNode.column = column;
		}

		// Remove from old parent if required
		const hasChangedParent = oldParent !== parent;
		if (oldParent && hasChangedParent) {
			oldParent.groups.splice(oldParent.groups.indexOf(groupNode), 1);
			this.data.updateNode(oldParent);
		}

		// Push to new parent if required.
		if (!existingGroup || hasChangedParent)
			groupNode.parent.groups.push(groupNode);

		groupNode.appendStatus(TestStatus.Running);
		this.data.updateNode(groupNode);
		this.data.updateNode(groupNode.parent);
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
			this.data.updateNode(t.parent);
		});

		// Anything marked as running should be set back to Unknown
		suite.getAllTests().filter((t) => t.status === TestStatus.Running).forEach((t) => {
			t.status = TestStatus.Unknown;
			this.data.updateNode(t);
		});

		this.data.rebuildSuiteNode(suite);
	}

	private handlePrintNotification(suite: SuiteData, evt: PrintNotification) {
		const test = suite.getCurrentTest(evt.testID);
		test.outputEvents.push(evt);
	}

	private handleErrorNotification(suite: SuiteData, evt: ErrorNotification) {
		const test = suite.getCurrentTest(evt.testID);
		test.outputEvents.push(evt);
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
