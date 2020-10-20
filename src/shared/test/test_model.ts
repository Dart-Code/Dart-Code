import * as path from "path";
import { TestStatus } from "../enums";
import { Event, EventEmitter } from "../events";
import { ErrorNotification, Group, PrintNotification, Test } from "../test_protocol";
import { flatMap, notUndefined, uniq } from "../utils";
import { sortBy } from "../utils/array";
import { fsPath } from "../utils/fs";

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

export abstract class TreeNode {
	public isStale = false;
	private _status: TestStatus = TestStatus.Unknown; // tslint:disable-line:variable-name
	// To avoid the sort changing on every status change (stale, running, etc.) this
	// field will be the last status the user would care about (pass/fail/skip).
	// Default to Passed just so things default to the most likely (hopefully) place. This should
	// never be used for rendering; only sorting.
	private _sort: TestSortOrder = TestSortOrder.Middle; // tslint:disable-line:variable-name
	public suiteRunNumber = 0; // TODO: Readonly?
	public isPotentiallyDeleted = false;

	public abstract label: string | undefined;

	public abstract testCount: number;
	public abstract testPassCount: number;

	public abstract duration: number | undefined;
	public description: string | boolean | undefined;

	constructor(public readonly suiteData: SuiteData) {
		this.suiteRunNumber = suiteData.currentRunNumber;
	}

	get status(): TestStatus {
		return this._status;
	}

	set status(status: TestStatus) {
		this._status = status;
		this.description = undefined; // Clear old run duration.

		if (status === TestStatus.Errored || status === TestStatus.Failed
			|| status === TestStatus.Passed
			|| status === TestStatus.Skipped) {
			this.isStale = false;
			this.isPotentiallyDeleted = false;
			this._sort = getTestSortOrder(status);
		}
	}

	get hasFailures(): boolean {
		return this._status === TestStatus.Errored || this._status === TestStatus.Failed;
	}

	get sort(): TestSortOrder {
		return this._sort;
	}
}

export class SuiteNode extends TreeNode {
	public readonly groups: GroupNode[] = [];
	public readonly tests: TestNode[] = [];

	constructor(suiteData: SuiteData) {
		super(suiteData);
	}

	get label(): undefined { return undefined; }

	get testCount(): number {
		return this.children.map((t) => t.testCount)
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

export class GroupNode extends TreeNode {
	public readonly groups: GroupNode[] = [];
	public readonly tests: TestNode[] = [];

	constructor(public readonly suiteData: SuiteData, public parent: SuiteNode | GroupNode, public id: number, public name: string | undefined, public path: string | undefined, public line: number | undefined, public column: number | undefined) {
		super(suiteData);
	}

	get label(): string {
		return this.parent && this.parent instanceof GroupNode && this.parent.name && this.name && this.name.startsWith(`${this.parent.name} `)
			? this.name.substr(this.parent.name.length + 1) // +1 because of the space (included above).
			: this.name || "<unnamed>";
	}

	get testCount(): number {
		return this.children.map((t) => t.testCount)
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

	// TODO: Remove phatom groups from this model, and handle only in the test notification handler.
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
			: (this.name || "<unnamed>")
	}

	get testCount(): number {
		return 1;
	}

	get testPassCount(): number {
		return this.status === TestStatus.Passed ? 1 : 0;
	}
}

export class TestTreeModel {
	// Set this flag we know when a new run starts so we can show the tree; however
	// we can't show it until we render a node (we can only call reveal on a node) so
	// we need to delay this until the suite starts.
	public isNewTestRun = true;
	public nextFailureIsFirst = true;

	private onDidChangeDataEmitter: EventEmitter<TreeNode | undefined> = new EventEmitter<TreeNode | undefined>();
	public readonly onDidChangeTreeData: Event<TreeNode | undefined> = this.onDidChangeDataEmitter.event;

	// TODO: Make private?
	public readonly suites: { [key: string]: SuiteData } = {};

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
		Object.values(this.suites).forEach((suite) => suite.currentRunNumber++);
	}

	public getOrCreateSuite(suitePath: string): [SuiteData, boolean] {
		let suite = this.suites[suitePath];
		if (!suite) {
			suite = new SuiteData(suitePath);
			this.suites[suitePath] = suite;
			return [suite, true];
		}
		return [suite, false];
	}

	public updateNode(node?: TreeNode) {
		this.onDidChangeDataEmitter.fire(node);
	}

	public updateSuiteStatuses(suite: SuiteData) {
		// Walk the tree to get the status.
		this.updateStatusFromChildren(suite.node);

		// Update top level list, as we could've changed order.
		this.updateNode();
	}

	private updateStatusFromChildren(node: SuiteNode | GroupNode): TestStatus {
		const childStatuses = node.children.length
			? node.children.filter((c) =>
				(c instanceof GroupNode && !c.isPhantomGroup)
				|| (c instanceof TestNode && !c.hidden),
			).map((c) => {
				if (c instanceof GroupNode)
					return this.updateStatusFromChildren(c);
				if (c instanceof TestNode)
					return c.status;
				return TestStatus.Unknown;
			})
			: [TestStatus.Unknown];

		const newStatus = Math.max(...childStatuses);
		if (newStatus !== node.status) {
			node.status = newStatus;
			this.updateNode(node);
		}

		node.description = `${node.testPassCount}/${node.testCount} passed, ${node.duration}ms`;

		return node.status;
	}
}

export class SuiteData {
	// To avoid collisions in IDs across runs, we increment this number on every
	// run of this suite and then use it as a prefix when looking up IDs. This allows
	// older (stale) results not to be looked up when using IDs.
	public currentRunNumber = 1;
	public readonly path: string;
	public readonly node: SuiteNode;
	private readonly groups: { [key: string]: GroupNode } = {};
	private readonly tests: { [key: string]: TestNode } = {};
	constructor(suitePath: string) {
		this.path = suitePath;
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
	public storeGroup(id: number, node: GroupNode) {
		return this.groups[`${this.currentRunNumber}_${id}`] = node;
	}
	public storeTest(id: number, node: TestNode) {
		return this.tests[`${this.currentRunNumber}_${id}`] = node;
	}
	public reuseMatchingGroup(currentSuiteRunNumber: number, group: Group, handleOldParent: (parent: SuiteNode | GroupNode) => void): GroupNode | undefined {
		// To reuse a node, the name must match and it must have not been used for the current run.
		const matches = this.getAllGroups(true).filter((g) => g.name === group.name
			&& g.suiteRunNumber !== currentSuiteRunNumber);
		// Reuse the one nearest to the source position.
		const sortedMatches = matches.sort((g1, g2) => Math.abs((g1.line || 0) - (group.line || 0)) - Math.abs((g2.line || 0) - (group.line || 0)));
		const match = sortedMatches.length ? sortedMatches[0] : undefined;
		if (match) {
			handleOldParent(match.parent);
			match.suiteRunNumber = this.currentRunNumber;
			this.storeGroup(group.id, match);
		}
		return match;
	}
	public reuseMatchingTest(currentSuiteRunNumber: number, test: Test, handleOldParent: (parent: SuiteNode | GroupNode) => void): TestNode | undefined {
		// To reuse a node, the name must match and it must have not been used for the current run.
		const matches = this.getAllTests().filter((t) => t.name === test.name
			&& t.suiteRunNumber !== currentSuiteRunNumber);
		// Reuse the one nearest to the source position.
		const sortedMatches = sortBy(matches, (t) => Math.abs((t.line || 0) - (test.line || 0)));
		const match = sortedMatches.length ? sortedMatches[0] : undefined;
		if (match) {
			handleOldParent(match.parent);
			match.suiteRunNumber = this.currentRunNumber;
			this.storeTest(test.id, match);
		}
		return match;
	}
}
