import { minimatch } from "minimatch";
import * as path from "path";
import * as vs from "vscode";
import { URI } from "vscode-uri";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { CoverageParser } from "../../shared/test/coverage";
import { GroupNode, NodeDidChangeEvent, ProjectNode, RunnableTreeNode, SuiteData, SuiteNode, TestEventListener, TestModel, TestNode, TestSource, TreeNode, WorkspaceFolderNode } from "../../shared/test/test_model";
import { ErrorNotification, PrintNotification } from "../../shared/test_protocol";
import { disposeAll, notUndefined } from "../../shared/utils";
import { isSetupOrTeardownTestName } from "../../shared/utils/test";
import { DartFileCoverage } from "../../shared/vscode/coverage";
import { config } from "../config";
import { TestDiscoverer } from "../lsp/test_discoverer";
import { formatForTerminal } from "../utils/vscode/terminals";

const runnableTestTag = new vs.TestTag("DartRunnableTest");
const runnableWithCoverageTestTag = new vs.TestTag("DartRunnableWithCoverageTest");

export class VsCodeTestController implements TestEventListener, IAmDisposable {
	private disposables: IAmDisposable[] = [];
	public readonly controller: vs.TestController;
	public readonly coverageParser: CoverageParser;
	private itemForNode = new WeakMap<TreeNode, vs.TestItem>();
	private nodeForItem = new WeakMap<vs.TestItem, TreeNode>();
	private testRuns: Record<string, { run: vs.TestRun, shouldEndWithSession: boolean } | undefined> = {};

	constructor(private readonly logger: Logger, private readonly model: TestModel, public readonly discoverer: TestDiscoverer | undefined) {
		const controller = this.controller = vs.tests.createTestController("dart", "Dart & Flutter");
		this.coverageParser = new CoverageParser(logger);
		this.disposables.push(controller);
		this.disposables.push(model.onDidChangeTreeData((node) => this.onDidChangeTreeData(node)));
		this.disposables.push(vs.debug.onDidTerminateDebugSession((e) => this.handleDebugSessionEnd(e)));
		model.addTestEventListener(this);

		if (discoverer)
			controller.resolveHandler = (item: vs.TestItem | undefined) => this.resolveTestItem(item);

		controller.createRunProfile("Run", vs.TestRunProfileKind.Run, (request, token) =>
			this.runTests(false, false, request, token), false, runnableTestTag);

		controller.createRunProfile("Debug", vs.TestRunProfileKind.Debug, (request, token) =>
			this.runTests(true, false, request, token), true, runnableTestTag);

		const coverageProfile = controller.createRunProfile("Run with Coverage", vs.TestRunProfileKind.Coverage, (request, token) =>
			this.runTests(false, true, request, token), true, runnableWithCoverageTestTag);

		coverageProfile.loadDetailedCoverage = async (testRun: vs.TestRun, fileCoverage: vs.FileCoverage, _token: vs.CancellationToken) => {
			const dartFileCoverage = fileCoverage as DartFileCoverage;
			const lineCoverage: vs.StatementCoverage[] = [];

			dartFileCoverage.detail.coverableLines.forEach((lineNumber) => {
				// LCOV files are one-based, but VS Code is zero-based.
				const location = new vs.Position(lineNumber - 1, 0);
				lineCoverage.push(new vs.StatementCoverage(dartFileCoverage.detail.coveredLines.has(lineNumber), location));
			});

			return lineCoverage;
		};
	}

	private async resolveTestItem(item: vs.TestItem | undefined): Promise<void> {
		if (!this.discoverer)
			return;

		if (!item) {
			await this.discoverer.ensureSuitesDiscovered();
			return;
		}

		const node = this.nodeForItem.get(item);
		if (node instanceof SuiteNode)
			await this.discoverer.discoverTestsForSuite(node);
	}

	public registerTestRun(dartCodeDebugSessionID: string, run: vs.TestRun, shouldEndWithSession: boolean): void {
		this.testRuns[dartCodeDebugSessionID] = { run, shouldEndWithSession };
	}

	public handleDebugSessionEnd(e: vs.DebugSession): void {
		const run = this.testRuns[e.configuration.dartCodeDebugSessionID];
		if (run?.shouldEndWithSession)
			run.run.end();

		this.testRuns[e.configuration.dartCodeDebugSessionID] = undefined;

		if (e.configuration.coverageFilePath && run)
			this.parseCoverage(run.run, e.configuration.cwd as string | undefined, e.configuration.coverageFilePath as string);
	}

	private parseCoverage(run: vs.TestRun, cwd: string | undefined, coverageFilePath: string) {
		if (!cwd) {
			this.logger.error(`Unable to parse coverage file "${coverageFilePath}" because there is no cwd for the debug session`);
			return;
		}

		try {
			const coverageExcludePatterns = config.coverageExcludePatterns;
			const coverage = this.coverageParser.parseLcovFile(coverageFilePath);
			for (const fileCoverage of coverage) {
				const absolutePath = path.isAbsolute(fileCoverage.sourceFilePath)
					? fileCoverage.sourceFilePath
					: path.join(cwd, fileCoverage.sourceFilePath);
				if (coverageExcludePatterns.some((p: string) => minimatch(absolutePath, p, { dot: true })))
					continue;
				const uri = vs.Uri.file(absolutePath);
				const coverage = new DartFileCoverage(uri, fileCoverage);
				run.addCoverage(coverage);
			}
		} catch (e) {
			this.logger.error(`Failed to read expected coverage file "${coverageFilePath}": ${e}`);
		}
	}

	public getLatestData(test: vs.TestItem): TreeNode | undefined {
		return this.nodeForItem.get(test);
	}

	/**
	 * Extracts the runnable nodes (suites, groups, tests) from a set of test items that might
	 * include workspace folder or project nodes.
	 */
	private extractRunnableNodes(items: Set<vs.TestItem>): RunnableTreeNode[] {
		const nodes: RunnableTreeNode[] = [];
		const add = (item: vs.TestItem) => {
			const node = this.nodeForItem.get(item);
			if (node instanceof RunnableTreeNode) {
				// If this node is runnable, add it.
				nodes.push(node);
			} else {
				// Otherwise, try adding children.
				item.children.forEach(add);
			}
		};
		items.forEach(add);
		return nodes;
	}

	public async runTests(debug: boolean, includeCoverage: boolean, request: vs.TestRunRequest, _token: vs.CancellationToken): Promise<void> {
		// If we're running all tests, ensure we have discovered them first.
		if (!request.include)
			await this.discoverer?.ensureSuitesDiscovered();

		const testsToRun = new Set<vs.TestItem>();
		const testsToExclude = new Set<vs.TestItem>();
		const isRunningAll = !request.include?.length;
		(request.include ?? this.controller.items).forEach((item) => testsToRun.add(item));
		request.exclude?.forEach((item) => { testsToRun.delete(item); testsToExclude.add(item); });

		// For each item in the set, remove any of its descendants because they will be run by the parent.
		this.removeRedundantChildNodes(testsToRun);

		// Similarly, remove any excluded tests that are already excluded by their suite, because that will allow the
		// optimisation below (which requires only excluded suites) to work in more cases.
		this.removeRedundantChildNodes(testsToExclude);

		const run = this.controller.createTestRun(request);
		try {
			// As an optimisation, if we're no-debug and running complete files (eg. all included or excluded items are
			// suites), we can run the "fast path" in a single `dart test` invocation.
			const nodesToRun = this.extractRunnableNodes(testsToRun);
			const nodesToExclude = this.extractRunnableNodes(testsToExclude);
			if (!debug && nodesToRun.every((item) => item instanceof SuiteNode) && nodesToExclude.every((item) => item instanceof SuiteNode)) {
				await vs.commands.executeCommand("_dart.runAllTestsWithoutDebugging", nodesToRun, nodesToExclude, includeCoverage, run, isRunningAll);
				return;
			}

			// Group into suites since we need to run each seperately (although we can run
			// multiple tests witthin one suite together).
			const testsBySuite = new Map<SuiteData, RunnableTreeNode[]>();

			nodesToRun.forEach((node) => {
				const testNodes = testsBySuite.get(node.suiteData) ?? [];
				testsBySuite.set(node.suiteData, testNodes);
				testNodes.push(node);
			});

			const command = debug
				? "_dart.startDebuggingTestsFromVsTestController"
				: "_dart.startWithoutDebuggingTestsFromVsTestController";
			const totalItems = testsBySuite.size;

			if (totalItems === 0)
				return; // Shouldn't get here
			else if (totalItems === 1) {
				const [[suite, nodes]] = testsBySuite.entries();
				await vs.commands.executeCommand(command, suite, nodes, false, includeCoverage, run, undefined);
			} else {
				const title = debug ? "Debugging" : "Running";
				await vs.window.withProgress({
					cancellable: true,
					location: vs.ProgressLocation.Notification,
					title,
				}, async (progress, token) => {
					let currentItem = 0;

					for (const [suite, nodes] of testsBySuite.entries()) {
						if (token?.isCancellationRequested || !nodes?.length)
							continue;

						currentItem++;
						const suiteName = path.basename(suite.path);
						progress.report({ message: `${suiteName}... (${currentItem}/${totalItems})`, increment: 100 / totalItems });

						const suppressPrompts = true;
						await vs.commands.executeCommand(command, suite, nodes, suppressPrompts, includeCoverage, run, token);
					}
				});
			}
		} finally {
			run.end();
		}
	}

	/// Removes any items from a set that are children of other items in the set.
	private removeRedundantChildNodes(set: Set<vs.TestItem>): void {
		// For each item in the set, remove any of its descendants because they will be run by the parent.
		function removeWithDescendants(item: vs.TestItem) {
			set.delete(item);
			item.children.forEach((child) => removeWithDescendants(child));
		}
		const all = [...set];
		all.forEach((item) => item.children.forEach((child) => removeWithDescendants(child)));
	}

	/// Replace the whole tree.
	private replaceAll() {
		const roots = this.model.getRoots()
			.map((node) => this.createOrUpdateNode(node, true))
			.filter(notUndefined);
		this.controller.items.replace(roots);
	}

	private onDidChangeTreeData(event: NodeDidChangeEvent | undefined): void {
		if (event === undefined) {
			this.replaceAll();
			return;
		}

		if (event.nodeWasRemoved) {
			this.removeNode(event.node);
			return;
		}

		this.createOrUpdateNode(event.node, false);
	}

	/**
	 * Gets the parent collection that a node belongs to.
	 *
	 * If this is a top-level node, returns the root items collection.
	 */
	private getParentCollection(node: TreeNode): vs.TestItemCollection | undefined {
		let collection: vs.TestItemCollection | undefined;

		// Find the parent whose child collection we belong to.
		const parent = node.parent;
		if (parent) {
			const parentItem = this.itemForNode.get(parent);
			collection = parentItem?.children;
		} else {
			// No parent, so we are top level.
			collection = this.controller.items;
		}

		return collection;
	}

	/// Creates a node or if it already exists, updates it.
	///
	/// Recursively creates/updates children unless `updateChildren` is `false` and this node
	/// already existed.
	///
	/// Does not add the item to its parent, so that the calling code can .replace()
	/// all children if required.
	///
	/// Returns undefined if in the case of an error or a node that should
	/// not be shown in the tree.
	private createOrUpdateNode(node: TreeNode, updateChildren: boolean): vs.TestItem | undefined {
		// If we're not showing workspace folder nodes and this is a workspace folder, skip over it to
		// its children.
		const shouldShowWorkspaceFolders = (vs.workspace.workspaceFolders?.length ?? 0) > 1;
		if (node instanceof WorkspaceFolderNode && !shouldShowWorkspaceFolders) {
			if (updateChildren) {
				node.children.forEach((c) => this.createOrUpdateNode(c, updateChildren));
			}
			return undefined;
		}

		const shouldShowNode = this.shouldShowNode(node);
		const collection = this.getParentCollection(node);

		if (!collection) {
			this.logger.error(`Failed to find parent (${node.parent?.label}) of node (${node.label})`);
			return;
		}
		const nodeId = this.idForNode(node);
		let existingItem = collection.get(nodeId);
		const didCreate = !existingItem;

		if (!shouldShowNode && existingItem)
			collection.delete(nodeId);

		// Create new item if required.
		if (!existingItem) {
			const newItem = this.createTestItem(node);
			if (!shouldShowNode)
				return;
			collection.add(newItem);
			existingItem = newItem;
		} else {
			// Otherwise, update this item to match the latest state.
			this.updateFields(existingItem, node);
			if (!shouldShowNode)
				return;
		}

		// For new suites without children, set canResolveChildren because we can
		// open the file and discover tests from the Outline if the user expands them.
		if (node instanceof SuiteNode && node.children.length === 0)
			existingItem.canResolveChildren = true;

		if (didCreate || updateChildren) {
			existingItem.children.replace(
				node.children.map((c) => this.createOrUpdateNode(c, updateChildren)).filter(notUndefined),
			);
		}

		return existingItem;
	}

	/// Removes a node from the tree.
	private removeNode(node: TreeNode): void {
		const collection = this.getParentCollection(node);
		if (!collection)
			return;

		const nodeId = this.idForNode(node);
		const existingItem = collection.get(nodeId);
		if (existingItem) {
			collection.delete(nodeId);
			this.nodeForItem.delete(existingItem);
		}
		this.itemForNode.delete(node);
	}

	private shouldShowNode(node: TreeNode): boolean {
		if (config.showSkippedTests)
			return true;

		if (node instanceof TestNode || node instanceof GroupNode) {
			return !node.isSkipped;
		} else {
			// Otherwise show eg. suites are always shown.
			return true;
		}
	}

	private idForNode(node: TreeNode) {
		if (node instanceof WorkspaceFolderNode)
			return `WF:${node.path}`;
		if (node instanceof ProjectNode)
			return `PROJECT:${node.path}`;
		if (node instanceof SuiteNode)
			return `SUITE:${node.path}`;

		// IMPORTANT:
		// We use suiteData.path here because we want to treat (tearDownAll) from a shared
		// file as a child of the suite node for the instances where it ran in that suite.
		if (node instanceof GroupNode)
			return `GROUP:${node.suiteData.path}:${node.name}`;
		if (node instanceof TestNode)
			return `TEST:${node.suiteData.path}:${node.name}`;
		throw new Error(`Tried to create ID for unknown node type! ${node.label}`);
	}

	private cleanLabel(label: string) {
		return label.trim().split("\n").map((l) => l.trim()).join(" ");
	}

	private labelForSuite(node: SuiteNode): string {
		const parent = node.parent;
		if (parent instanceof ProjectNode || parent instanceof WorkspaceFolderNode)
			return path.relative(parent.path, node.path);
		return path.basename(node.path);
	}

	private createTestItem(node: TreeNode): vs.TestItem {
		const id = this.idForNode(node);
		const label = node instanceof SuiteNode
			? this.labelForSuite(node)
			: this.cleanLabel(node.label ?? "<unnamed>");
		// We use path here (and not suiteData.path) because we want to
		// navigate to the source for setup/teardown which may be in a
		// different file to the test.
		const uri = vs.Uri.file(node.path);

		const item = this.controller.createTestItem(id, label, uri);
		this.updateFields(item, node);
		this.nodeForItem.set(item, node);
		this.itemForNode.set(node, item);

		if (node instanceof RunnableTreeNode && this.isRunnableTest(node)) {
			item.tags = [runnableTestTag];

			// Checking if coverage is supported is async, so we need to do this later.
			void node.suiteData.supportsCoverage.then((supportsCoverage) => {
				if (supportsCoverage) {
					item.tags = [...item.tags, runnableWithCoverageTestTag]; // Reassign to force update.
				}
			});
		}

		item.children.replace(
			node.children.map((c) => this.createTestItem(c)),
		);

		return item;
	}

	private updateFields(item: vs.TestItem, node: TreeNode) {
		item.description = node.description;
		if ((node instanceof GroupNode || node instanceof TestNode) && node.range) {
			// Only update locations of tests that already have locations if they are from the Outline, because
			// if they were from results then re-applying the original location might now be inaccurate due to
			// changes to the file.
			if (config.dynamicTestTracking || !item.range || node.testSource === TestSource.Outline) {
				item.range = new vs.Range(
					new vs.Position(node.range.start.line, node.range.start.character),
					new vs.Position(node.range.end.line, node.range.end.character),
				);
			}
		}
	}

	private isRunnableTest(node: RunnableTreeNode): boolean {
		const label = node.label;
		if (!label)
			return false;
		if (isSetupOrTeardownTestName(label))
			return false;
		if (this.discoverer?.fileTracker.supportsPackageTest(URI.file(node.suiteData.path)) === false)
			return false;
		return true;
	}

	private getOrCreateTestRun(sessionID: string) {
		let run = this.testRuns[sessionID]?.run;
		if (!run) {
			const request = new vs.TestRunRequest();
			(request as any).preserveFocus = false; // TODO(dantup): Remove this when we crank VS Code min version in future.
			run = this.controller.createTestRun(request, undefined, true);
			this.registerTestRun(sessionID, run, true);
		}
		return run;
	}

	public suiteDiscovered(_sessionID: string | undefined, _node: SuiteNode): void {
		// const run = this.getOrCreateTestRun(sessionID);
		// const item = this.itemForNode.get(node);
	}

	public groupDiscovered(_sessionID: string | undefined, _node: GroupNode): void {
		// const run = this.getOrCreateTestRun(sessionID);
		// const item = this.itemForNode.get(node);
	}

	public testDiscovered(_sessionID: string | undefined, _node: TestNode): void {
		// const run = this.getOrCreateTestRun(sessionID);
		// const item = this.itemForNode.get(node);
	}

	public testStarted(sessionID: string, node: TestNode): void {
		this.testDiscovered(sessionID, node);

		const run = this.getOrCreateTestRun(sessionID);
		const item = this.itemForNode.get(node);
		if (run && item)
			run.started(item);
	}

	public testOutput(sessionID: string, node: TestNode, message: string): void {
		const run = this.getOrCreateTestRun(sessionID);
		const item = this.itemForNode.get(node);
		if (run && item)
			this.appendTestOutputLines(run, item, message);
	}

	public testErrorOutput(sessionID: string, node: TestNode, message: string, isFailure: boolean, stack: string): void {
		const run = this.getOrCreateTestRun(sessionID);
		const item = this.itemForNode.get(node);
		if (run && item) {
			// TODO(dantup): If the change described here:
			//  https://github.com/microsoft/vscode/issues/185778#issuecomment-1603742803
			//  goes ahead, then if isFailure=true, capture the output of this as the
			//  "lastFailureEvent" and then use that to pass to .failed() in testDone
			//  instead of making a new TestMessage.
			this.appendTestOutputLines(run, item, `${message}\r\n${stack}`.trimEnd());
		}
	}

	public appendTestOutputLines(run: vs.TestRun, item: vs.TestItem, message: string) {
		if (message.trim() === "")
			return;
		run.appendOutput(`${formatForTerminal(message)}\r\n`, undefined, item);
	}

	public testDone(sessionID: string, node: TestNode, result: "skipped" | "success" | "failure" | "error" | undefined): void {
		const run = this.getOrCreateTestRun(sessionID);
		const item = this.itemForNode.get(node);
		if (run && item) {
			switch (result) {
				case "skipped":
					run.skipped(item);
					break;
				case "success":
					run.passed(item, node.duration);
					break;
				default: {
					const outputEvents = node.outputEvents;
					const output = outputEvents.map((output) => this.formatNotification(output)).join("\n");
					const outputMessage = formatForTerminal(output);
					const testMessage = new vs.TestMessage(outputMessage);

					// Attempt to extract Expected/Actual values if they are simple and on one line.
					const valueMatch = /^Expected: (.*)\n\s*Actual: (.*)\n\n/.exec(outputMessage.replaceAll("\r\n", "\n").replaceAll("\r", "\n"));
					if (valueMatch) {
						const expected = valueMatch[1];
						const actual = valueMatch[2];
						testMessage.expectedOutput = typeof expected === "string" ? expected : undefined;
						testMessage.actualOutput = typeof actual === "string" ? actual : undefined;
					}

					if (result === "failure")
						run.failed(item, testMessage, node.duration);
					else
						run.errored(item, testMessage, node.duration);
					break;
				}
			}
		}
	}

	public suiteDone(_sessionID: string, _node: SuiteNode): void { }

	private formatNotification(error: ErrorNotification | PrintNotification) {
		if (!("error" in error))
			return error.message;

		return [
			error.error ?? "",
			error.stackTrace ?? "",
		].join("\n").trim();
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
