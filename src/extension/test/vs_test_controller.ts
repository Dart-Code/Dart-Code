import * as path from "path";
import * as vs from "vscode";
import { URI } from "vscode-uri";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { GroupNode, NodeDidChangeEvent, SuiteData, SuiteNode, TestEventListener, TestModel, TestNode, TreeNode } from "../../shared/test/test_model";
import { ErrorNotification, PrintNotification } from "../../shared/test_protocol";
import { disposeAll, notUndefined } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { isSetupOrTeardownTestName } from "../../shared/utils/test";
import { config } from "../config";
import { TestDiscoverer } from "../lsp/test_discoverer";
import { formatForTerminal } from "../utils/vscode/terminals";

const runnableTestTag = new vs.TestTag("DartRunnableTest");

export class VsCodeTestController implements TestEventListener, IAmDisposable {
	private disposables: IAmDisposable[] = [];
	public readonly controller: vs.TestController;
	private itemForNode = new WeakMap<TreeNode, vs.TestItem>();
	private nodeForItem = new WeakMap<vs.TestItem, TreeNode>();
	private testRuns: { [key: string]: { run: vs.TestRun, shouldEndWithSession: boolean } | undefined } = {};

	constructor(private readonly logger: Logger, private readonly model: TestModel, public readonly discoverer: TestDiscoverer | undefined) {
		const controller = vs.tests.createTestController("dart", "Dart & Flutter");
		this.controller = controller;
		this.disposables.push(controller);
		this.disposables.push(model.onDidChangeTreeData((node) => this.onDidChangeTreeData(node)));
		this.disposables.push(vs.debug.onDidTerminateDebugSession((e) => this.handleDebugSessionEnd(e)));
		model.addTestEventListener(this);

		if (discoverer)
			controller.resolveHandler = (item: vs.TestItem | undefined) => this.resolveTestItem(item);

		controller.createRunProfile("Run", vs.TestRunProfileKind.Run, (request, token) =>
			this.runTests(false, request, token), false, runnableTestTag);

		controller.createRunProfile("Debug", vs.TestRunProfileKind.Debug, (request, token) =>
			this.runTests(true, request, token), true, runnableTestTag);
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
		if (run?.shouldEndWithSession) {
			console.log(`Ending run ${run.run.name} 5555`);
			run.run.end();
		} else {
			console.log(`NOT ending run ${run?.run.name} 6666`);
		}
		this.testRuns[e.configuration.dartCodeDebugSessionID] = undefined;
	}

	public getLatestData(test: vs.TestItem): TreeNode | undefined {
		return this.nodeForItem.get(test);
	}

	public async runTests(debug: boolean, request: vs.TestRunRequest, token: vs.CancellationToken): Promise<void> {
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
		console.log(`Created run ${run.name} 111`);
		try {
			// As an optimisation, if we're no-debug and running complete files (eg. all included or excluded items are
			// suites), we can run the "fast path" in a single `dart test` invocation.
			const nodesToRun = [...testsToRun].map((item) => this.nodeForItem.get(item));
			const nodesToExclude = [...testsToExclude].map((item) => this.nodeForItem.get(item));
			if (!debug && nodesToRun.every((item) => item instanceof SuiteNode) && nodesToExclude.every((item) => item instanceof SuiteNode)) {
				await vs.commands.executeCommand("_dart.runAllTestsWithoutDebugging", nodesToRun, nodesToExclude, run, isRunningAll);
				return;
			}

			// Group into suites since we need to run each seperately (although we can run
			// multiple tests witthin one suite together).
			const testsBySuite = new Map<SuiteData, TreeNode[]>();

			testsToRun.forEach((test) => {
				const node = this.nodeForItem.get(test);
				if (!node) return;
				const testNodes = testsBySuite.get(node.suiteData) ?? [];
				testsBySuite.set(node.suiteData, testNodes);
				testNodes.push(node);
			});

			const suppressPrompts = testsBySuite.size > 1;
			for (const suite of testsBySuite.keys()) {
				const nodes = testsBySuite.get(suite);
				if (!nodes) continue;

				const command = debug
					? "_dart.startDebuggingTestsFromVsTestController"
					: "_dart.startWithoutDebuggingTestsFromVsTestController";
				await vs.commands.executeCommand(command, suite, nodes, suppressPrompts, run);
			}
		} finally {
			console.log(`Ended run ${run.name} 111`);
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
		const suiteTestItems = Array.from(this.model.suites.values())
			.map((suite) => this.createOrUpdateNode(suite.node, true))
			.filter(notUndefined);
		this.controller.items.replace(suiteTestItems);
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
		const shouldShowNode = this.shouldShowNode(node);
		let collection;
		if (node instanceof SuiteNode) {
			collection = this.controller.items;
		} else {
			collection = this.itemForNode.get(node.parent!)?.children;
		}

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

		// For new suites without chilren, set canResolveChildren because we can
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
	private removeNode(node: TreeNode): undefined {
		const collection = node instanceof SuiteNode
			? this.controller.items
			: this.itemForNode.get(node.parent!)?.children;

		if (!collection)
			return;

		const nodeId = this.idForNode(node);
		const existingItem = collection.get(nodeId);
		if (existingItem)
			collection.delete(nodeId);
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
		if (node instanceof SuiteNode)
			return `SUITE:${node.suiteData.path}`;
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
		const suitePath = node.suiteData.path;
		const wf = vs.workspace.getWorkspaceFolder(vs.Uri.file(suitePath));

		return wf
			? path.relative(fsPath(wf.uri), node.suiteData.path)
			: path.basename(suitePath);
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

		item.children.replace(
			node.children.map((c) => this.createTestItem(c)),
		);

		return item;
	}

	private updateFields(item: vs.TestItem, node: TreeNode) {
		if (this.isRunnableTest(node))
			item.tags = [runnableTestTag];
		else
			item.tags = [];
		item.description = node.description;
		if ((node instanceof GroupNode || node instanceof TestNode) && node.range) {
			item.range = new vs.Range(
				new vs.Position(node.range.start.line, node.range.start.character),
				new vs.Position(node.range.end.line, node.range.end.character),
			);
		}
	}

	private isRunnableTest(node: TreeNode): boolean {
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
			console.log(`Creating a new test run for ${sessionID}`);
			const request = new vs.TestRunRequest();
			(request as any).preserveFocus = false; // TODO(dantup): Remove this when we crank VS Code min version in future.
			run = this.controller.createTestRun(request, undefined, true);
			this.registerTestRun(sessionID, run, true);
		}
		console.log(`Reusing existing session for ${sessionID}`);
		return run;
	}

	public suiteDiscovered(sessionID: string | undefined, node: SuiteNode): void {
		// const run = this.getOrCreateTestRun(sessionID);
		// const item = this.itemForNode.get(node);
	}

	public groupDiscovered(sessionID: string | undefined, node: GroupNode): void {
		// const run = this.getOrCreateTestRun(sessionID);
		// const item = this.itemForNode.get(node);
	}

	public testDiscovered(sessionID: string | undefined, node: TestNode): void {
		// const run = this.getOrCreateTestRun(sessionID);
		// const item = this.itemForNode.get(node);
	}

	public testStarted(sessionID: string, node: TestNode): void {
		this.testDiscovered(sessionID, node);

		const run = this.getOrCreateTestRun(sessionID);
		const item = this.itemForNode.get(node);
		if (run && item) {
			console.log(`Starting item ${item.label} of ${run.name} 3333`);
			run.started(item);
		}
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
					console.log(`Skipping item ${item.label} of ${run.name} 3333`);
					run.skipped(item);
					break;
				case "success":
					console.log(`Passing item ${item.label} of ${run.name} 3333`);
					run.passed(item, node.duration);
					break;
				default:
					const outputEvents = node.outputEvents;
					const output = outputEvents.map((output) => this.formatNotification(output)).join("\n");
					const outputMessage = formatForTerminal(output);
					const testMessage = new vs.TestMessage(outputMessage);

					// Attempt to extract Expected/Actual values if they are simple and on one line.
					const valueMatch = outputMessage.replaceAll("\r\n", "\n").replaceAll("\r", "\n").match(/^Expected: (.*)\n\s*Actual: (.*)\n\n/);
					if (valueMatch) {
						const expected = valueMatch[1];
						const actual = valueMatch[2];
						testMessage.expectedOutput = typeof expected === "string" ? expected : undefined;
						testMessage.actualOutput = typeof actual === "string" ? actual : undefined;
					}

					if (result === "failure") {
						console.log(`Failing item ${item.label} of ${run.name} 3333`);
						run.failed(item, testMessage, node.duration);
					} else {
						console.log(`Erroring item ${item.label} of ${run.name} 3333`);
						run.errored(item, testMessage, node.duration);
					}
					break;
			}
		}
	}

	public suiteDone(sessionID: string, node: SuiteNode): void { }

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
