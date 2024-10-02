import { TestStatus } from "../enums";
import { Event, EventEmitter } from "../events";
import { Position, Range } from "../interfaces";
import { ErrorNotification, PrintNotification } from "../test_protocol";
import { uniq } from "../utils";
import { DocumentCache } from "../utils/document_cache";
import { isWithinPath } from "../utils/fs";
import { makeRegexForTests } from "../utils/test";

export abstract class TreeNode {
	public abstract parent: TreeNode | undefined;
	public abstract path: string;

	public _isStale = false;
	public testSource = TestSource.Outline;
	public isPotentiallyDeleted = false;
	public duration: number | undefined;

	public testCount = 0;
	public testCountPass = 0;
	public testCountSkip = 0;

	public description: string | undefined;

	constructor(public readonly suiteData: SuiteData) { }

	public readonly children: Array<GroupNode | TestNode> = [];

	getHighestChildStatus(includeSkipped: boolean): TestStatus {
		const statuses = new Set<TestStatus>();
		const addStatus = (node: TreeNode) => {
			if (node !== this && node instanceof TestNode)
				statuses.add(node.status);
			for (const child of node.children)
				addStatus(child);
		};
		addStatus(this);

		// Always include Skipped status for Suite nodes that have only that status, else they'll
		// show as unknown.
		if (!includeSkipped && this instanceof SuiteNode && statuses.size === 1 && statuses.has(TestStatus.Skipped))
			includeSkipped = true;
		const validStatues = [...statuses].filter((s) => includeSkipped || s !== TestStatus.Skipped);
		return validStatues.length
			? Math.max(...validStatues)
			: TestStatus.Unknown;
	}

	get label(): string | undefined {
		const name = this instanceof GroupNode
			? this.name
			: this instanceof TestNode
				? this.name
				: undefined;

		let parent = this.parent;
		while (name && parent) {
			const parentName = parent instanceof GroupNode
				? parent.name
				: parent instanceof TestNode
					? parent.name
					: undefined;
			if (parentName && name.startsWith(`${parentName} `))
				return name.substr(parentName.length + 1); // +1 because of the space (included above).

			// Otherwise try next parent up.
			parent = parent?.parent;
		}

		return name ?? "<unnamed>";
	}

	get isStale(): boolean {
		return this._isStale;
	}

	set isStale(value: boolean) {
		this._isStale = value;
	}
}

export class SuiteNode extends TreeNode {
	constructor(suiteData: SuiteData) {
		super(suiteData);
	}

	get parent(): undefined { return undefined; }

	get path(): string {
		return this.suiteData.path;
	}
}

export class GroupNode extends TreeNode {
	constructor(public readonly suiteData: SuiteData, public parent: SuiteNode | GroupNode, public name: string | undefined, public path: string, public range: Range | undefined) {
		super(suiteData);
	}

	get isSkipped(): boolean {
		return this.children.every((c) => {
			if (c instanceof GroupNode || c instanceof TestNode)
				return c.isSkipped;
			else
				return false;
		});
	}
}

export class TestNode extends TreeNode {
	private _status = TestStatus.Unknown;

	public readonly outputEvents: Array<PrintNotification | ErrorNotification> = [];
	public testStartTime: number | undefined;

	// TODO: Flatten test into this class so we're not tied to the test protocol.
	constructor(public suiteData: SuiteData, public parent: TreeNode, public name: string | undefined, public path: string, public range: Range | undefined) {
		super(suiteData);
	}

	get status(): TestStatus {
		if (this.children.length)
			return super.getHighestChildStatus(true);
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

	get isSkipped(): boolean {
		if (this.children.length === 0)
			return this.status === TestStatus.Skipped;
		else
			return this.children.every((c) => (c as TestNode).isSkipped);
	}

	get isStale(): boolean {
		if (this.children.length)
			return !!this.children.find((c) => c.isStale);
		return super.isStale;
	}

	set isStale(value: boolean) {
		super.isStale = value;
	}
}

export interface NodeDidChangeEvent {
	node: TreeNode;
	nodeWasRemoved?: boolean;
}

export class TestModel {
	private readonly onDidChangeDataEmitter: EventEmitter<NodeDidChangeEvent | undefined> = new EventEmitter<NodeDidChangeEvent | undefined>();
	public readonly onDidChangeTreeData: Event<NodeDidChangeEvent | undefined> = this.onDidChangeDataEmitter.event;

	private readonly testEventListeners: TestEventListener[] = [];

	// TODO: Make private?
	public readonly suites = new DocumentCache<SuiteData>();

	public constructor(private readonly config: { showSkippedTests: boolean }, private readonly isPathInsideFlutterProject: (path: string) => boolean) { }

	public addTestEventListener(listener: TestEventListener) {
		this.testEventListeners.push(listener);
	}

	public flagSuiteStart(suite: SuiteData, isRunningWholeSuite: boolean): void {
		// Mark all test for this suite as "stale" which will make them faded, so that results from
		// the "new" run are more obvious in the tree.
		suite.getAllGroups().forEach((g) => g.isStale = true);
		suite.getAllTests().forEach((t) => t.isStale = true);

		if (isRunningWholeSuite && suite) {
			this.markAllAsPotentiallyDeleted(suite, TestSource.Result);
		}
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
		toDelete.forEach((node) => this.removeNode(node));
	}

	public getOrCreateSuite(suitePath: string): [SuiteData, boolean] {
		let suite = this.suites.getForPath(suitePath);
		if (!suite) {
			suite = new SuiteData(suitePath, this.isPathInsideFlutterProject(suitePath));
			this.suites.setForPath(suitePath, suite);
			return [suite, true];
		}
		return [suite, false];
	}

	public clearSuiteOrDirectory(suiteOrDirectoryPath: string): void {
		// We can't tell if it's a file or directory because it's already been deleted, so just
		// try both.
		let found = false;
		if (this.suites.hasForPath(suiteOrDirectoryPath)) {
			found = true;
			this.suites.deleteForPath(suiteOrDirectoryPath);
		} else {
			for (const suitePath of Object.keys(this.suites)) {
				if (isWithinPath(suitePath, suiteOrDirectoryPath)) {
					this.suites.deleteForPath(suitePath);
					found = true;
				}
			}
		}

		if (found)
			this.updateNode();
	}

	public handleConfigChange(): void {
		// When config changes, some things may change (for example
		// skipped tests may be hidden, so the test counts need
		// recomputing).

		for (const suite of this.suites.values()) {
			this.updateSuiteTestCountLabels(suite, true);
		}
	}

	public updateNode(event?: NodeDidChangeEvent) {
		this.onDidChangeDataEmitter.fire(event);
	}

	public updateSuiteTestCountLabels(suite: SuiteData, forceUpdate: boolean) {
		this.updateTestCountLabels(suite.node, forceUpdate, "DOWN");
	}

	/// Recomputes the test counts and labels for a node and it's parent/children (based on `direction`).
	private updateTestCountLabels(node: SuiteNode | GroupNode | TestNode, forceUpdate: boolean, direction: "UP" | "DOWN"): void {
		if (direction === "DOWN") {
			for (const child of node.children)
				this.updateTestCountLabels(child, forceUpdate, direction);
		}

		// Update the cached counts on this node.
		if (node instanceof TestNode && !node.children.length) {
			node.testCount = 1;
			node.testCountPass = node.status === TestStatus.Passed ? 1 : 0;
			node.testCountSkip = node.status === TestStatus.Skipped ? 1 : 0;
		} else {
			node.testCount = node.children.map((c) => c.testCount).reduce((total, value) => total + value, 0);
			node.testCountPass = node.children.map((c) => c.testCountPass).reduce((total, value) => total + value, 0);
			node.testCountSkip = node.children.map((c) => c.testCountSkip).reduce((total, value) => total + value, 0);
		}
		const totalTests = this.config.showSkippedTests ? node.testCount : node.testCount - node.testCountSkip;

		// Update the label.
		const previousDescription = node.description;
		node.description = node.children.length && totalTests !== 0 ? `${node.testCountPass}/${totalTests} passed` : "";
		if (forceUpdate || node.description !== previousDescription)
			this.updateNode({ node });

		if (direction === "UP") {
			const parent = node.parent;
			if (parent instanceof SuiteNode || parent instanceof GroupNode || parent instanceof TestNode)
				this.updateTestCountLabels(parent, false, direction);
		}
	}

	public suiteDiscoveredConditional(dartCodeDebugSessionID: string | undefined, suitePath: string): SuiteData {
		return this.suites.getForPath(suitePath) ?? this.suiteDiscovered(dartCodeDebugSessionID, suitePath);
	}

	public suiteDiscovered(dartCodeDebugSessionID: string | undefined, suitePath: string): SuiteData {
		const [suite, didCreate] = this.getOrCreateSuite(suitePath);
		this.updateNode({ node: suite.node });

		this.testEventListeners.forEach((l) => l.suiteDiscovered(dartCodeDebugSessionID, suite.node));

		return suite;
	}

	public groupDiscovered(dartCodeDebugSessionID: string, suitePath: string, source: TestSource, groupID: number, groupName: string | undefined, parentID: number | undefined, groupPath: string | undefined, range: Range | undefined, hasStarted = false): GroupNode {
		groupPath ??= suitePath;
		const suite = this.suites.getForPath(suitePath)!;
		const existingGroup = suite.reuseMatchingGroup(groupName);
		const oldParent = existingGroup?.parent;
		let parent = parentID ? suite.getMyGroup(dartCodeDebugSessionID, parentID)! : suite.node;

		/// If we're a dynamic test/group, we should be re-parented under the dynamic node that came from
		/// the analyzer.
		if (groupName && source === TestSource.Result)
			parent = this.findMatchingDynamicNode(parent, groupName) ?? parent;

		const groupNode = existingGroup || new GroupNode(suite, parent, groupName, groupPath, range);

		suite.storeGroup(dartCodeDebugSessionID, groupID, groupNode);

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
			this.updateNode({ node: oldParent });
		}

		// Push to new parent if required.
		if (!groupNode.parent.children.find((n) => n === groupNode))
			groupNode.parent.children.push(groupNode);

		this.updateNode({ node: groupNode });

		this.testEventListeners.forEach((l) => l.groupDiscovered(dartCodeDebugSessionID, groupNode));

		return groupNode;
	}

	public testDiscovered(dartCodeDebugSessionID: string, suitePath: string, source: TestSource, testID: number, testName: string | undefined, groupID: number | undefined, testPath: string | undefined, range: Range | undefined, startTime: number | undefined, hasStarted = false): TestNode {
		testPath ??= suitePath;
		const suite = this.suites.getForPath(suitePath)!;
		const existingTest = suite.reuseMatchingTest(testName);
		const oldParent = existingTest?.parent;
		let parent: TreeNode = groupID ? suite.getMyGroup(dartCodeDebugSessionID, groupID)! : suite.node;

		/// If we're a dynamic test/group, we should be re-parented under the dynamic node that came from
		/// the analyzer.
		if (testName && source === TestSource.Result)
			parent = this.findMatchingDynamicNode(parent, testName) ?? parent;

		const testNode = existingTest || new TestNode(suite, parent, testName, testPath, range);

		suite.storeTest(dartCodeDebugSessionID, testID, testNode);

		if (existingTest) {
			testNode.parent = parent;
			testNode.name = testName;
			testNode.path = testPath;
			const originalRange = testNode.range;
			testNode.range = range;

			// If we're an Outline node being updated, and we have Results children that
			// had the same range as us, they should be updated too, so Results nodes do not
			// drift away from the location over time.
			if (testNode.testSource === TestSource.Outline) {
				const children = testNode.children
					.filter((c) => c.testSource === TestSource.Result)
					.filter((c) => !c.range || (originalRange && this.rangeEquals(c.range, originalRange)));
				for (const child of children)
					child.range = range;
			}
		} else {
			testNode.testSource = source;
		}

		this.markAsNotDeleted(testNode);
		testNode.testStartTime = startTime;

		// Remove from old parent if required.
		const hasChangedParent = oldParent && oldParent !== testNode.parent;
		if (oldParent && hasChangedParent) {
			oldParent.children.splice(oldParent.children.indexOf(testNode), 1);
			this.updateNode({ node: oldParent });
		}

		// Push to new parent if required.
		if (!testNode.parent.children.find((n) => n === testNode))
			testNode.parent.children.push(testNode);

		if (hasStarted) {
			// Clear any test output from previous runs.
			testNode.outputEvents.length = 0;
			testNode.status = TestStatus.Running;
		}

		this.updateNode({ node: testNode });

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
			const regex = new RegExp(makeRegexForTests([{ name: child.name, isGroup: child instanceof GroupNode, position: undefined }]));
			if (regex.test(name))
				return child as any as T;
		}
	}

	public testDone(dartCodeDebugSessionID: string, suitePath: string, testID: number, result: "skipped" | "success" | "failure" | "error" | undefined, endTime: number | undefined): void {
		const suite = this.suites.getForPath(suitePath)!;
		const testNode = suite.getCurrentTest(dartCodeDebugSessionID, testID)!;

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

		this.updateTestCountLabels(testNode, true, "UP");

		if (dartCodeDebugSessionID)
			this.testEventListeners.forEach((l) => l.testDone(dartCodeDebugSessionID, testNode, result));
	}

	public suiteDone(dartCodeDebugSessionID: string | undefined, suitePath: string): void {
		const suite = this.suites.getForPath(suitePath);
		if (!suite)
			return;

		// TODO: Some notification that things are complete?
		// TODO: Maybe a progress bar during the run?

		this.removeAllPotentiallyDeletedNodes(suite);

		// Anything marked as running should be set back to Unknown
		suite.getAllTests().filter((t) => t.status === TestStatus.Running).forEach((t) => {
			t.status = TestStatus.Unknown;
			this.updateNode({ node: t });
		});

		this.updateSuiteTestCountLabels(suite, false);

		if (dartCodeDebugSessionID)
			this.testEventListeners.forEach((l) => l.suiteDone(dartCodeDebugSessionID, suite.node));
	}

	public testOutput(dartCodeDebugSessionID: string, suitePath: string, testID: number, message: string) {
		const suite = this.suites.getForPath(suitePath)!;
		const test = suite.getCurrentTest(dartCodeDebugSessionID, testID);

		if (test)
			this.testEventListeners.forEach((l) => l.testOutput(dartCodeDebugSessionID, test, message));
	}

	public testErrorOutput(dartCodeDebugSessionID: string, suitePath: string, testID: number, isFailure: boolean, message: string, stack: string) {
		const suite = this.suites.getForPath(suitePath)!;
		const test = suite.getCurrentTest(dartCodeDebugSessionID, testID);

		if (test)
			this.testEventListeners.forEach((l) => l.testErrorOutput(dartCodeDebugSessionID, test, message, isFailure, stack));
	}

	private removeNode(node: GroupNode | TestNode) {
		const parent = node.parent;
		const index = parent.children.indexOf(node);
		if (index > -1)
			parent.children.splice(index, 1);
		this.updateNode({ node, nodeWasRemoved: true });
	}

	private rangeEquals(r1: Range, r2: Range): boolean {
		return this.positionEquals(r1.start, r2.start) && this.positionEquals(r1.end, r2.end);
	}

	private positionEquals(p1: Position, p2: Position): boolean {
		return p1.line === p2.line && p1.character === p2.character;
	}
}

export class SuiteData {
	public readonly node: SuiteNode;
	private readonly groupsById = new Map<string, GroupNode>();
	private readonly groupsByName = new Map<string, GroupNode>();
	private readonly testsById = new Map<string, TestNode>();
	private readonly testsByName = new Map<string, TestNode>();
	constructor(public readonly path: string, public readonly isFlutterSuite: boolean) {
		this.node = new SuiteNode(this);
	}
	private static unnamedItemMarker = "<!!!###unnamed-test-item###!!!>";

	public getAllGroups(): GroupNode[] {
		// We need to uniq() these because we store values in the map from
		// other runs so that concurrent runs can look up parent nodes from
		// their own IDs.
		return uniq([...this.groupsById.values()]);
	}
	public getAllTests(): TestNode[] {
		// We need to uniq() these because we store values in the map from
		// other runs so that concurrent runs can look up parent nodes from
		// their own IDs.
		return uniq([...this.testsById.values()]);
	}
	public getCurrentTest(sessionID: string, id: number) {
		return this.testsById.get(`${sessionID}_${id}`);
	}
	public getMyGroup(sessionID: string, id: number): GroupNode | undefined {
		return this.groupsById.get(`${sessionID}_${id}`);
	}
	public getMyTest(sessionID: string, id: number): TestNode | undefined {
		return this.testsById.get(`${sessionID}_${id}`);
	}
	public storeGroup(sessionID: string, groupID: number, node: GroupNode) {
		this.groupsByName.set(node.name ?? SuiteData.unnamedItemMarker, node);
		return this.groupsById.set(`${sessionID}_${groupID}`, node);
	}
	public storeTest(sessionID: string, testID: number, node: TestNode) {
		this.testsByName.set(node.name ?? SuiteData.unnamedItemMarker, node);
		return this.testsById.set(`${sessionID}_${testID}`, node);
	}
	public reuseMatchingGroup(groupName: string | undefined): GroupNode | undefined {
		return this.groupsByName.get(groupName ?? SuiteData.unnamedItemMarker);
	}
	public reuseMatchingTest(testName: string | undefined): TestNode | undefined {
		return this.testsByName.get(testName ?? SuiteData.unnamedItemMarker);
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
