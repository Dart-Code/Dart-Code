import * as path from "path";
import { TestStatus } from "../enums";
import { Event, EventEmitter } from "../events";
import { Range } from "../interfaces";
import { ErrorNotification, PrintNotification } from "../test_protocol";
import { flatMap, notUndefined } from "../utils";
import { fsPath } from "../utils/fs";
import { makeRegexForTests } from "../utils/test";

export abstract class TreeNode {
	public abstract parent: TreeNode | undefined;

	public isStale = false;
	public suiteRunNumber = 1;
	public testSource = TestSource.Outline;
	public isPotentiallyDeleted = false;
	public ownDuration: number | undefined;

	abstract get label(): string | undefined;

	public description: string | undefined;

	constructor(public readonly suiteData: SuiteData) { }

	public readonly children: Array<GroupNode | TestNode> = [];

	public readonly statuses = new Set<TestStatus>([TestStatus.Unknown]);

	/// Adds a status to the existing statuses list.
	public appendStatus(status: TestStatus) {
		if (status === TestStatus.Failed
			|| status === TestStatus.Passed
			|| status === TestStatus.Skipped) {
			this.isStale = false;
			this.isPotentiallyDeleted = false;
		}

		this.statuses.add(status);
	}

	public clearStatuses() {
		this.statuses.clear();
		this.description = undefined; // Clear old run duration.
	}

	public hasStatus(status: TestStatus): boolean {
		return this.statuses.has(status);
	}

	getHighestStatus(includeSkipped: boolean): TestStatus {
		// Always include Skipped status for Suite nodes that have only that status, else they'll
		// show as unknown.
		if (!includeSkipped && this instanceof SuiteNode && this.statuses.size === 1 && this.statuses.has(TestStatus.Skipped))
			includeSkipped = true;
		const validStatues = [...this.statuses].filter((s) => includeSkipped || s !== TestStatus.Skipped);
		return validStatues.length
			? Math.max(...validStatues)
			: TestStatus.Unknown;
	}

	getTestCount(includeSkipped: boolean): number {
		return this.children.map((t) => t.getTestCount(includeSkipped))
			.reduce((total, value) => total + value, 0);
	}

	get testPassCount(): number {
		return this.children.map((t) => t.testPassCount)
			.reduce((total, value) => total + value, 0);
	}

	get duration(): number | undefined {
		return this.children
			.map((t) => t.duration)
			.filter(notUndefined)
			.reduce((total, value) => total + value, 0)
			+ (this.ownDuration ?? 0);
	}
}

export class SuiteNode extends TreeNode {
	constructor(suiteData: SuiteData) {
		super(suiteData);
	}

	get parent(): undefined { return undefined; }

	get label(): undefined { return undefined; }
}

export class GroupNode extends TreeNode {
	constructor(public readonly suiteData: SuiteData, public parent: SuiteNode | GroupNode, public name: string | undefined, public path: string | undefined, public range: Range | undefined) {
		super(suiteData);
	}

	get label(): string {
		return this.parent && this.parent instanceof GroupNode && this.parent.name && this.name && this.name.startsWith(`${this.parent.name} `)
			? this.name.substr(this.parent.name.length + 1) // +1 because of the space (included above).
			: this.name || "<unnamed>";
	}
}

export class TestNode extends TreeNode {
	private _status = TestStatus.Unknown;

	public readonly outputEvents: Array<PrintNotification | ErrorNotification> = [];
	public testStartTime: number | undefined;

	// TODO: Flatten test into this class so we're not tied to the test protocol.
	constructor(public suiteData: SuiteData, public parent: TreeNode, public name: string | undefined, public path: string | undefined, public range: Range | undefined) {
		super(suiteData);
	}

	get label(): string {
		return this.parent && this.parent instanceof GroupNode && this.parent.name && this.name && this.name.startsWith(`${this.parent.name} `)
			? this.name.substr(this.parent.name.length + 1) // +1 because of the space (included above).
			: (this.name || "<unnamed>");
	}

	getTestCount(includeSkipped: boolean): number {
		return includeSkipped || this.status !== TestStatus.Skipped ? 1 : 0;
	}

	get testPassCount(): number {
		return this.status === TestStatus.Passed ? 1 : 0;
	}

	get status(): TestStatus {
		return this._status;
	}

	set status(value: TestStatus) {
		this._status = value;

		if (this._status === TestStatus.Failed
			|| this._status === TestStatus.Passed
			|| this._status === TestStatus.Skipped) {
			this.isStale = false;
			this.isPotentiallyDeleted = false;
		}
	}
}

export class TestModel {
	// Set this flag we know when a new run starts so we can show the tree; however
	// we can't show it until we render a node (we can only call reveal on a node) so
	// we need to delay this until the suite starts.
	public isNewTestRun = true;
	public nextFailureIsFirst = true;

	private readonly onDidStartTestsEmitter: EventEmitter<TreeNode> = new EventEmitter<TreeNode>();
	public readonly onDidStartTests: Event<TreeNode> = this.onDidStartTestsEmitter.event;
	private readonly onFirstFailureEmitter: EventEmitter<TreeNode> = new EventEmitter<TreeNode>();
	public readonly onFirstFailure: Event<TreeNode> = this.onFirstFailureEmitter.event;

	private readonly onDidChangeDataEmitter: EventEmitter<TreeNode | undefined> = new EventEmitter<TreeNode | undefined>();
	public readonly onDidChangeTreeData: Event<TreeNode | undefined> = this.onDidChangeDataEmitter.event;

	private readonly testEventListeners: TestEventListener[] = [];

	// TODO: Make private?
	public readonly suites: { [key: string]: SuiteData } = {};

	public constructor(private readonly config: { showSkippedTests: boolean }, private readonly isPathInsideFlutterProject: (path: string) => boolean) { }

	public addTestEventListener(listener: TestEventListener) {
		this.testEventListeners.push(listener);
	}

	public flagSuiteStart(suitePath: string, isRunningWholeSuite: boolean): void {
		this.isNewTestRun = true;
		this.nextFailureIsFirst = true;

		if (suitePath && path.isAbsolute(suitePath)) {
			const suite = this.suites[fsPath(suitePath)];
			if (suite) {

				// Mark all test for this suite as "stale" which will make them faded, so that results from
				// the "new" run are more obvious in the tree.
				suite.getAllGroups().forEach((g) => g.isStale = true);
				suite.getAllTests().forEach((t) => t.isStale = true);

				if (isRunningWholeSuite && suite) {
					this.markAllAsPotentiallyDeleted(suite, TestSource.Result);
				}
			}
		}

		// Also increase the currentRunNumber to ensure we know all results are from
		// the newest run.
		Object.values(this.suites).forEach((suite) => this.flagNewDiscovery(suite));
	}

	public flagNewDiscovery(suite: SuiteData) {
		suite.node.suiteRunNumber++;
	}

	// When running the whole suite (or updating from Outline), we flag all tests as being
	// potentially deleted and then any tests that aren't run are removed from the tree. This
	// is to ensure if a test is renamed, we don't keep the old version of it in the test tree
	// forever since we don't have the necessary information to know the test was renamed.
	//
	// When updating from the outline, we'll skip children of dynamic nodes as we don't
	// know if they've been deleted or not, and don't want to cause their results to
	// immediately disappear.
	public markAllAsPotentiallyDeleted(suite: SuiteData, source: TestSource) {
		function doNode(node: TreeNode) {
			if (node.testSource === source)
				node.isPotentiallyDeleted = true;
			node.children.forEach(doNode);
		}
		doNode(suite.node);
	}

	// Marks a node and all of its parents as not-deleted so they will not be cleaned up.
	private markAsNotDeleted(node: TreeNode | undefined) {
		while (node) {
			node.isPotentiallyDeleted = false;
			node = node.parent;
		}
	}

	public removeAllPotentiallyDeletedNodes(suite: SuiteData) {
		// Delete nodes that were marked as potentially deleted and then never updated.
		// This means they weren't run in the last run, so probably were deleted (or
		// renamed and got new nodes, which still means the old ones should be removed).
		const toDelete = [
			...suite.getAllGroups(),
			...suite.getAllTests(),
		].filter((t) => t.isPotentiallyDeleted);
		const toUpdate = new Set(toDelete.map((node) => node.parent));
		toDelete.forEach((node) => this.removeNode(node));
		toUpdate.forEach((node) => this.updateNode(node));
	}

	public getOrCreateSuite(suitePath: string): [SuiteData, boolean] {
		let suite = this.suites[suitePath];
		if (!suite) {
			suite = new SuiteData(suitePath, this.isPathInsideFlutterProject(suitePath));
			this.suites[suitePath] = suite;
			return [suite, true];
		}
		return [suite, false];
	}

	public clearAllResults(): void {
		for (const suiteData of Object.keys(this.suites)) {
			delete this.suites[suiteData];
		}

		this.updateNode();
	}

	public handleConfigChange(): void {
		// When config changes, some things may change (for example
		// skipped tests may be hidden, so the test counts need
		// recomputing).

		Object.values(this.suites).forEach((suite) => this.rebuildSuiteNode(suite));
	}

	public updateNode(node?: TreeNode) {
		this.onDidChangeDataEmitter.fire(node);
	}

	public rebuildSuiteNode(suite: SuiteData) {
		// Walk the tree to get the status.
		this.rebuildNode(suite.node);
		this.updateNode(suite.node);
	}

	/// Rebuilds any data on a node that is dependent on its children.
	private rebuildNode(node: SuiteNode | GroupNode): void {
		const childStatuses = node.children.length
			? flatMap(
				node.children.map((c) => {
					if (c instanceof GroupNode) {
						this.rebuildNode(c);
						return [...c.statuses];
					}
					if (c instanceof TestNode)
						return [c.status];
					return [TestStatus.Unknown];
				}),
				(s) => s,
			)
			: [TestStatus.Unknown];

		const childStatusesSet = new Set<TestStatus>(childStatuses);
		const statusAreEqual = node.statuses.size === childStatusesSet.size && [...childStatusesSet].every((s) => node.statuses.has(s));

		if (!statusAreEqual) {
			node.clearStatuses();
			childStatuses.forEach((s) => node.appendStatus(s));
		}

		node.description = `${node.testPassCount}/${node.getTestCount(this.config.showSkippedTests)} passed`;
	}

	public suiteDiscovered(dartCodeDebugSessionID: string | undefined, suitePath: string): void {
		const [suite, didCreate] = this.getOrCreateSuite(suitePath);
		suite.node.appendStatus(TestStatus.Waiting);
		this.updateNode(suite.node);
		this.updateNode();
		// If this is the first suite, we've started a run and can show the tree.
		// We need to wait for the tree node to have been rendered though so setTimeout :(
		if (this.isNewTestRun) {
			this.isNewTestRun = false;
			this.onDidStartTestsEmitter.fire(suite.node);
		}

		if (dartCodeDebugSessionID)
			this.testEventListeners.forEach((l) => l.suiteDiscovered(dartCodeDebugSessionID, suite.node));
	}

	public groupDiscovered(dartCodeDebugSessionID: string | undefined, suitePath: string, source: TestSource, groupID: number, groupName: string | undefined, parentID: number | undefined, groupPath: string | undefined, range: Range | undefined, hasStarted = false): GroupNode {
		const suite = this.suites[suitePath];
		const existingGroup = suite.reuseMatchingGroup(groupName);
		const oldParent = existingGroup?.parent;
		let parent = parentID ? suite.getMyGroup(suite.currentRunNumber, parentID)! : suite.node;

		/// If we're a dynamic test/group, we should be re-parented under the dynamic node that came from
		/// the analyzer.
		if (groupName && source === TestSource.Result)
			parent = this.findMatchingDynamicNode(parent, groupName) ?? parent;

		const groupNode = existingGroup || new GroupNode(suite, parent, groupName, groupPath, range);

		groupNode.suiteRunNumber = suite.currentRunNumber;
		suite.storeGroup(groupID, groupNode);

		if (existingGroup) {
			groupNode.parent = parent;
			groupNode.name = groupName;
			groupNode.path = groupPath;
			groupNode.range = range;
		} else {
			groupNode.testSource = source;
		}

		this.markAsNotDeleted(groupNode);

		// Remove from old parent if required
		const hasChangedParent = oldParent !== parent;
		if (oldParent && hasChangedParent) {
			oldParent.children.splice(oldParent.children.indexOf(groupNode), 1);
			this.updateNode(oldParent);
		}

		// Push to new parent if required.
		if (!existingGroup || hasChangedParent)
			groupNode.parent.children.push(groupNode);

		if (hasStarted) {
			groupNode.appendStatus(TestStatus.Running);
		}

		this.updateNode(groupNode);
		this.updateNode(groupNode.parent);

		if (dartCodeDebugSessionID)
			this.testEventListeners.forEach((l) => l.groupDiscovered(dartCodeDebugSessionID, groupNode));

		return groupNode;
	}

	public testDiscovered(dartCodeDebugSessionID: string | undefined, suitePath: string, source: TestSource, testID: number, testName: string | undefined, groupID: number | undefined, testPath: string | undefined, range: Range | undefined, startTime: number | undefined, hasStarted = false): TestNode {
		const suite = this.suites[suitePath];
		const existingTest = suite.reuseMatchingTest(testName);
		const oldParent = existingTest?.parent;
		let parent: TreeNode = groupID ? suite.getMyGroup(suite.currentRunNumber, groupID)! : suite.node;

		/// If we're a dynamic test/group, we should be re-parented under the dynamic node that came from
		/// the analyzer.
		if (testName && source === TestSource.Result)
			parent = this.findMatchingDynamicNode(parent, testName) ?? parent;

		const testNode = existingTest || new TestNode(suite, parent, testName, testPath, range);

		testNode.suiteRunNumber = suite.currentRunNumber;
		suite.storeTest(testID, testNode);

		if (existingTest) {
			testNode.parent = parent;
			testNode.name = testName;
			testNode.path = testPath;
			testNode.range = range;
		} else {
			testNode.testSource = source;
		}

		this.markAsNotDeleted(testNode);
		testNode.testStartTime = startTime;

		// Remove from old parent if required.
		const hasChangedParent = oldParent && oldParent !== testNode.parent;
		if (oldParent && hasChangedParent) {
			oldParent.children.splice(oldParent.children.indexOf(testNode), 1);
			this.updateNode(oldParent);
		}

		// Push to new parent if required.
		if (!existingTest || hasChangedParent)
			testNode.parent.children.push(testNode);


		if (hasStarted) {
			// Clear any test output from previous runs.
			testNode.outputEvents.length = 0;
			testNode.status = TestStatus.Running;
		}

		this.updateNode(testNode);
		this.updateNode(testNode.parent);
		this.rebuildSuiteNode(suite);

		if (hasStarted && dartCodeDebugSessionID)
			this.testEventListeners.forEach((l) => l.testStarted(dartCodeDebugSessionID, testNode));

		return testNode;
	}

	/// Find a matching node in 'parent' that might be a node for a dynamic test/group that name is
	/// an instance of.
	private findMatchingDynamicNode<T extends TreeNode>(parent: T, name: string): T | undefined {
		// If the parent has any children exactly named us, they should be used regardless.
		if (parent.children.find((c) => c.name === name))
			return;

		for (const child of parent.children) {
			if (!child.name || typeof child !== typeof parent)
				continue;
			const regex = new RegExp(makeRegexForTests([{ name: child.name, isGroup: child instanceof GroupNode }]));
			if (regex.test(name))
				return child as any as T;
		}
	}

	public testDone(dartCodeDebugSessionID: string | undefined, suitePath: string, testID: number, result: "skipped" | "success" | "failure" | "error" | undefined, endTime: number | undefined): void {
		const suite = this.suites[suitePath];
		const testNode = suite.getCurrentTest(testID)!;

		if (result === "skipped") {
			testNode.status = TestStatus.Skipped;
		} else if (result === "success") {
			testNode.status = TestStatus.Passed;
		} else if (result === "failure") {
			testNode.status = TestStatus.Failed;
		} else if (result === "error")
			testNode.status = TestStatus.Failed;
		else {
			testNode.status = TestStatus.Unknown;
		}
		if (endTime && testNode.testStartTime) {
			testNode.ownDuration = endTime - testNode.testStartTime;
			testNode.description = ``;
			// Don't clear this, as concurrent runs will overwrite each
			// other and then we'll get no time at the end.
			// testNode.testStartTime = undefined;
		}

		this.updateNode(testNode);
		this.updateNode(testNode.parent);
		this.rebuildSuiteNode(suite);

		if (testNode.status === TestStatus.Failed && this.nextFailureIsFirst) {
			this.nextFailureIsFirst = false;
			this.onFirstFailureEmitter.fire(testNode);
		}

		if (dartCodeDebugSessionID)
			this.testEventListeners.forEach((l) => l.testDone(dartCodeDebugSessionID, testNode, result));
	}

	public suiteDone(dartCodeDebugSessionID: string | undefined, suitePath: string): void {
		const suite = this.suites[suitePath];
		if (!suite)
			return;

		// TODO: Some notification that things are complete?
		// TODO: Maybe a progress bar during the run?

		this.removeAllPotentiallyDeletedNodes(suite);

		// Anything marked as running should be set back to Unknown
		suite.getAllTests().filter((t) => t.status === TestStatus.Running).forEach((t) => {
			t.status = TestStatus.Unknown;
			this.updateNode(t);
		});

		this.rebuildSuiteNode(suite);

		if (dartCodeDebugSessionID)
			this.testEventListeners.forEach((l) => l.suiteDone(dartCodeDebugSessionID, suite.node));
	}

	public testOutput(dartCodeDebugSessionID: string | undefined, suitePath: string, testID: number, message: string) {
		const suite = this.suites[suitePath];
		const test = suite.getCurrentTest(testID);
		// DO STUFF
	}

	public testErrorOutput(dartCodeDebugSessionID: string | undefined, suitePath: string, testID: number, isFailure: boolean, message: string, stack: string) {
		const suite = this.suites[suitePath];
		const test = suite.getCurrentTest(testID);
		// DO STUFF
	}

	private removeNode(node: GroupNode | TestNode) {
		const parent = node.parent;
		const index = parent.children.indexOf(node);
		if (index > -1)
			parent.children.splice(index, 1);
		node.suiteData.dropNode(node);
	}
}

export class SuiteData {
	public get currentRunNumber() { return this.node.suiteRunNumber; }
	public readonly node: SuiteNode;
	private readonly groups = new Map<string, GroupNode>();
	private readonly tests = new Map<string, TestNode>();
	constructor(public readonly path: string, public readonly isFlutterSuite: boolean) {
		this.node = new SuiteNode(this);
	}

	public getAllGroups(): GroupNode[] {
		return [...this.groups.values()];
	}
	public getAllTests(): TestNode[] {
		return [...this.tests.values()];
	}
	public getCurrentTest(id: number) {
		return this.tests.get(`${this.currentRunNumber}_${id}`);
	}
	public getMyGroup(suiteRunNumber: number, id: number): GroupNode | undefined {
		return this.groups.get(`${suiteRunNumber}_${id}`);
	}
	public getMyTest(suiteRunNumber: number, id: number): TestNode | undefined {
		return this.tests.get(`${suiteRunNumber}_${id}`);
	}
	public storeGroup(groupID: number, node: GroupNode) {
		this.dropNode(node);
		return this.groups.set(`${node.suiteRunNumber}_${groupID}`, node);
	}
	public storeTest(testID: number, node: TestNode) {
		this.dropNode(node);
		return this.tests.set(`${node.suiteRunNumber}_${testID}`, node);
	}
	public dropNode(node: GroupNode | TestNode) {
		const group = [...this.groups].find((g) => g[1] === node);
		if (group)
			this.groups.delete(group[0]);

		const test = [...this.tests].find((t) => t[1] === node);
		if (test)
			this.tests.delete(test[0]);
	}
	public reuseMatchingGroup(groupName: string | undefined): GroupNode | undefined {
		return this.getAllGroups().find((g) => g.name === groupName);
	}
	public reuseMatchingTest(testName: string | undefined): TestNode | undefined {
		return this.getAllTests().find((t) => t.name === testName);
	}
}

export interface TestEventListener {
	suiteDiscovered(sessionID: string | undefined, node: SuiteNode): void;
	groupDiscovered(sessionID: string | undefined, node: GroupNode): void;
	testDiscovered(sessionID: string | undefined, node: TestNode): void;
	testStarted(sessionID: string, node: TestNode): void;
	testOutput(sessionID: string, node: TestNode, message: string): void;
	testErrorOutput(sessionID: string, node: TestNode, message: string, isFailure: boolean, stack: string): void;
	testDone(sessionID: string, node: TestNode, result: "skipped" | "success" | "failure" | "error" | undefined): void;
	suiteDone(sessionID: string, node: SuiteNode): void;
}

export enum TestSource {
	Outline,
	Result,
}
