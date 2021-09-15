import * as path from "path";
import { TestStatus } from "../enums";
import { Event, EventEmitter } from "../events";
import { ErrorNotification, PrintNotification } from "../test_protocol";
import { flatMap, notUndefined, uniq } from "../utils";
import { sortBy } from "../utils/array";
import { fsPath } from "../utils/fs";

export abstract class TreeNode {
	public abstract parent: TreeNode | undefined;

	public isStale = false;
	public suiteRunNumber = 1;
	public isPotentiallyDeleted = false;

	public abstract label: string | undefined;

	public abstract getTestCount(includeSkipped: boolean): number;
	public abstract testPassCount: number;

	public abstract duration: number | undefined;
	public description: string | undefined;

	constructor(public readonly suiteData: SuiteData) { }
}

export abstract class TestContainerNode extends TreeNode {
	public readonly groups: GroupNode[] = [];
	public readonly tests: TestNode[] = [];

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
		this.description = undefined;		// Clear old run duration.
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
			.reduce((total, value) => total + value, 0);
	}

	abstract get label(): string | undefined;
	abstract get children(): TreeNode[];
}

export class SuiteNode extends TestContainerNode {
	constructor(suiteData: SuiteData) {
		super(suiteData);
	}

	get parent(): undefined { return undefined; }

	get label(): undefined { return undefined; }

	get children(): TreeNode[] {
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

export class GroupNode extends TestContainerNode {
	constructor(public readonly suiteData: SuiteData, public parent: SuiteNode | GroupNode, public id: number, public name: string | undefined, public path: string | undefined, public line: number | undefined, public column: number | undefined) {
		super(suiteData);
	}

	get label(): string {
		return this.parent && this.parent instanceof GroupNode && this.parent.name && this.name && this.name.startsWith(`${this.parent.name} `)
			? this.name.substr(this.parent.name.length + 1) // +1 because of the space (included above).
			: this.name || "<unnamed>";
	}

	// TODO: Remove phantom groups from this model, and handle only in the test notification handler.
	get isPhantomGroup() {
		return !this.name && this.parent instanceof SuiteNode;
	}

	get hidden(): boolean {
		// If every child is hidden, we are hidden.
		return this.children.every((c) => (c instanceof GroupNode && c.hidden)
			|| (c instanceof TestNode && c.hidden));
	}

	get children(): TreeNode[] {
		return ([] as TreeNode[])
			.concat(this.groups.filter((t) => !t.hidden))
			.concat(this.tests.filter((t) => !t.hidden));
	}
}

export class TestNode extends TreeNode {
	private _status = TestStatus.Unknown;

	public readonly outputEvents: Array<PrintNotification | ErrorNotification> = [];
	public testStartTime: number | undefined;
	public duration: number | undefined;
	public hidden = false;

	// TODO: Flatten test into this class so we're not tied to the test protocol.
	constructor(public suiteData: SuiteData, public parent: SuiteNode | GroupNode, public id: number, public name: string | undefined, public path: string | undefined, public line: number | undefined, public column: number | undefined) {
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

				// When running the whole suite, we flag all tests as being potentially deleted
				// and then any tests that aren't run are removed from the tree. This is to ensure
				// if a test is renamed, we don't keep the old version of it in the test tree forever
				// since we don't have the necessary information to know the test was renamed.
				if (isRunningWholeSuite) {
					if (suite) {
						suite.getAllGroups().forEach((g) => g.isPotentiallyDeleted = true);
						suite.getAllTests().forEach((t) => t.isPotentiallyDeleted = true);
					}
				}
			}
		}

		// Also increase the currentRunNumber to ensure we know all results are from
		// the newest run.
		Object.values(this.suites).forEach((suite) => suite.node.suiteRunNumber++);
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

		// Update top level list, as we could've changed order.
		this.updateNode();
	}

	/// Rebuilds any data on a node that is dependent on its children.
	private rebuildNode(node: SuiteNode | GroupNode): void {
		const childStatuses = node.children.length
			? flatMap(
				node.children.filter((c) =>
					(c instanceof GroupNode && !c.isPhantomGroup)
					|| (c instanceof TestNode && !c.hidden),
				).map((c) => {
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
			this.updateNode();
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

	public groupDiscovered(dartCodeDebugSessionID: string | undefined, suitePath: string, groupID: number, groupName: string | undefined, parentID: number | undefined, groupPath: string | undefined, line: number | undefined, column: number | undefined): void {
		const suite = this.suites[suitePath];
		const existingGroup = suite.getCurrentGroup(groupID) || suite.reuseMatchingGroup(suite.currentRunNumber, groupID, groupName, line);
		const oldParent = existingGroup?.parent;
		const parent = parentID ? suite.getMyGroup(suite.currentRunNumber, parentID) : suite.node;
		const groupNode = existingGroup || new GroupNode(suite, parent, groupID, groupName, groupPath, line, column);

		if (!existingGroup) {
			groupNode.suiteRunNumber = suite.currentRunNumber;
			suite.storeGroup(groupNode);
		} else {
			groupNode.parent = parent;
			groupNode.id = groupID;
			groupNode.name = groupName;
			groupNode.path = groupPath;
			groupNode.line = line;
			groupNode.column = column;
		}

		// Remove from old parent if required
		const hasChangedParent = oldParent !== parent;
		if (oldParent && hasChangedParent) {
			oldParent.groups.splice(oldParent.groups.indexOf(groupNode), 1);
			this.updateNode(oldParent);
		}

		// Push to new parent if required.
		if (!existingGroup || hasChangedParent)
			groupNode.parent.groups.push(groupNode);

		groupNode.appendStatus(TestStatus.Running);
		this.updateNode(groupNode);
		this.updateNode(groupNode.parent);

		if (dartCodeDebugSessionID)
			this.testEventListeners.forEach((l) => l.groupDiscovered(dartCodeDebugSessionID, groupNode));
	}

	public testStarted(dartCodeDebugSessionID: string | undefined, suitePath: string, testID: number, testName: string | undefined, groupIDs: number[] | undefined, testPath: string | undefined, line: number | undefined, column: number | undefined, startTime: number | undefined): void {
		const suite = this.suites[suitePath];
		const existingTest = suite.getCurrentTest(testID) || suite.reuseMatchingTest(suite.currentRunNumber, testID, testName, line);
		const oldParent = existingTest?.parent;
		const parent = groupIDs?.length ? suite.getMyGroup(suite.currentRunNumber, groupIDs[groupIDs.length - 1]) : suite.node;
		const testNode = existingTest || new TestNode(suite, parent, testID, testName, testPath, line, column);

		if (!existingTest) {
			testNode.suiteRunNumber = suite.currentRunNumber;
			suite.storeTest(testNode);
		} else {
			testNode.parent = parent;
			testNode.id = testID;
			testNode.name = testName;
			testNode.path = testPath;
			testNode.line = line;
			testNode.column = column;
		}
		testNode.testStartTime = startTime;

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
			this.updateNode(oldParent);
		}

		// Push to new parent if required.
		if (!existingTest || hasChangedParent)
			testNode.parent.tests.push(testNode);

		// Clear any test output from previous runs.
		testNode.outputEvents.length = 0;

		testNode.status = TestStatus.Running;
		this.updateNode(testNode);
		this.updateNode(testNode.parent);
		if (!testNode.hidden)
			this.rebuildSuiteNode(suite);

		if (dartCodeDebugSessionID && !testNode.hidden)
			this.testEventListeners.forEach((l) => l.testStarted(dartCodeDebugSessionID, testNode));
	}

	public testDone(dartCodeDebugSessionID: string | undefined, suitePath: string, testID: number, result: "skipped" | "success" | "failure" | "error" | undefined, hidden: boolean, endTime: number | undefined): void {
		const suite = this.suites[suitePath];
		const testNode = suite.getCurrentTest(testID);

		testNode.hidden = hidden;
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
			testNode.duration = endTime - testNode.testStartTime;
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

		if (dartCodeDebugSessionID && !testNode.hidden)
			this.testEventListeners.forEach((l) => l.testDone(dartCodeDebugSessionID, testNode, result));
	}

	public suiteDone(dartCodeDebugSessionID: string | undefined, suitePath: string): void {
		const suite = this.suites[suitePath];
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
}

export class SuiteData {
	public get currentRunNumber() { return this.node.suiteRunNumber; }
	public readonly node: SuiteNode;
	private readonly groups: { [key: string]: GroupNode } = {};
	private readonly tests: { [key: string]: TestNode } = {};
	constructor(public readonly path: string, public readonly isFlutterSuite: boolean) {
		this.node = new SuiteNode(this);
	}

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
	public storeGroup(node: GroupNode) {
		return this.groups[`${node.suiteRunNumber}_${node.id}`] = node;
	}
	public storeTest(node: TestNode) {
		return this.tests[`${node.suiteRunNumber}_${node.id}`] = node;
	}
	public reuseMatchingGroup(currentSuiteRunNumber: number, groupID: number, groupName: string | undefined, groupLine: number | undefined): GroupNode | undefined {
		// To reuse a node, the name must match and it must have not been used for the current run.
		const matches = this.getAllGroups(true).filter((g) => g.name === groupName
			&& g.suiteRunNumber !== currentSuiteRunNumber);
		// Reuse the one nearest to the source position.
		const sortedMatches = matches.slice().sort((g1, g2) => Math.abs((g1.line || 0) - (groupLine || 0)) - Math.abs((g2.line || 0) - (groupLine || 0)));
		const match = sortedMatches.length ? sortedMatches[0] : undefined;
		if (match) {
			match.id = groupID;
			match.suiteRunNumber = this.currentRunNumber;
			this.storeGroup(match);
		}
		return match;
	}
	public reuseMatchingTest(currentSuiteRunNumber: number, testID: number, testName: string | undefined, testLine: number | undefined): TestNode | undefined {
		// To reuse a node, the name must match and it must have not been used for the current run.
		const matches = this.getAllTests().filter((t) => t.name === testName
			&& t.suiteRunNumber !== currentSuiteRunNumber);
		// Reuse the one nearest to the source position.
		const sortedMatches = sortBy(matches.slice(), (t) => Math.abs((t.line || 0) - (testLine || 0)));
		const match = sortedMatches.length ? sortedMatches[0] : undefined;
		if (match) {
			match.id = testID;
			match.suiteRunNumber = this.currentRunNumber;
			this.storeTest(match);
		}
		return match;
	}
}

export interface TestEventListener {
	suiteDiscovered(sessionID: string, node: SuiteNode): void;
	groupDiscovered(sessionID: string, node: GroupNode): void;
	testStarted(sessionID: string, node: TestNode): void;
	testOutput(sessionID: string, node: TestNode, message: string): void;
	testErrorOutput(sessionID: string, node: TestNode, message: string, isFailure: boolean, stack: string): void;
	testDone(sessionID: string, node: TestNode, result: "skipped" | "success" | "failure" | "error" | undefined): void;
	suiteDone(sessionID: string, node: SuiteNode): void;
}
