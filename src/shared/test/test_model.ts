import * as path from "path";
import { TestStatus } from "../enums";
import { Event, EventEmitter } from "../events";
import { ErrorNotification, Group, PrintNotification, Test } from "../test_protocol";
import { flatMap, notUndefined, uniq } from "../utils";
import { sortBy } from "../utils/array";
import { fsPath } from "../utils/fs";

enum TestSortOrder {
	Top, // Fails
	Bottom,
}

function getTestSortOrder(statuses: Set<TestStatus>): TestSortOrder {
	if (statuses.has(TestStatus.Failed))
		return TestSortOrder.Top;
	return TestSortOrder.Bottom;
}

export abstract class TreeNode {
	public isStale = false;
	// To avoid the sort changing on every status change (stale, running, etc.) this
	// field will be the last status the user would care about (pass/fail/skip).
	// Default to Passed just so things default to the most likely (hopefully) place. This should
	// never be used for rendering; only sorting.
	protected _sort: TestSortOrder = TestSortOrder.Bottom; // tslint:disable-line:variable-name
	public suiteRunNumber = 1;
	public isPotentiallyDeleted = false;

	public abstract label: string | undefined;

	public abstract getTestCount(includeSkipped: boolean): number;
	public abstract testPassCount: number;

	public abstract duration: number | undefined;
	public description: string | boolean | undefined;

	constructor(public readonly suiteData: SuiteData) { }

	get sort(): TestSortOrder {
		return this._sort;
	}
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

		this._sort = getTestSortOrder(this.statuses);
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

		this._sort = getTestSortOrder(new Set<TestStatus>([this.status]));
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

	public constructor(private readonly config: { showSkippedTests: boolean }, private readonly isPathInsideFlutterProject: (path: string) => boolean) { }

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

		node.description = `${node.testPassCount}/${node.getTestCount(this.config.showSkippedTests)} passed, ${node.duration}ms`;
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
	public reuseMatchingGroup(currentSuiteRunNumber: number, group: Group): GroupNode | undefined {
		// To reuse a node, the name must match and it must have not been used for the current run.
		const matches = this.getAllGroups(true).filter((g) => g.name === group.name
			&& g.suiteRunNumber !== currentSuiteRunNumber);
		// Reuse the one nearest to the source position.
		const sortedMatches = matches.sort((g1, g2) => Math.abs((g1.line || 0) - (group.line || 0)) - Math.abs((g2.line || 0) - (group.line || 0)));
		const match = sortedMatches.length ? sortedMatches[0] : undefined;
		if (match) {
			match.id = group.id;
			match.suiteRunNumber = this.currentRunNumber;
			this.storeGroup(match);
		}
		return match;
	}
	public reuseMatchingTest(currentSuiteRunNumber: number, test: Test): TestNode | undefined {
		// To reuse a node, the name must match and it must have not been used for the current run.
		const matches = this.getAllTests().filter((t) => t.name === test.name
			&& t.suiteRunNumber !== currentSuiteRunNumber);
		// Reuse the one nearest to the source position.
		const sortedMatches = sortBy(matches, (t) => Math.abs((t.line || 0) - (test.line || 0)));
		const match = sortedMatches.length ? sortedMatches[0] : undefined;
		if (match) {
			match.id = test.id;
			match.suiteRunNumber = this.currentRunNumber;
			this.storeTest(match);
		}
		return match;
	}
}
