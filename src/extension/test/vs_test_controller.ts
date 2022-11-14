import * as path from "path";
import * as vs from "vscode";
import { TestStatus } from "../../shared/enums";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { GroupNode, SuiteData, SuiteNode, TestEventListener, TestModel, TestNode, TreeNode } from "../../shared/test/test_model";
import { ErrorNotification, PrintNotification } from "../../shared/test_protocol";
import { disposeAll, notUndefined } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { rewriteUrisForTestOutput } from "../../shared/utils/test";
import { config } from "../config";
import { TestDiscoverer } from "../lsp/test_discoverer";
import { formatForTerminal } from "../utils/vscode/terminals";

export class VsCodeTestController implements TestEventListener, IAmDisposable {
	private disposables: IAmDisposable[] = [];
	public readonly controller: vs.TestController;
	private itemForNode = new WeakMap<TreeNode, vs.TestItem>();
	private nodeForItem = new WeakMap<vs.TestItem, TreeNode>();
	private testRuns: { [key: string]: { run: vs.TestRun, shouldEndWithSession: boolean } | undefined } = {};

	constructor(private readonly logger: Logger, private readonly model: TestModel, private readonly discoverer: TestDiscoverer | undefined) {
		const controller = vs.tests.createTestController("dart", "Dart & Flutter");
		this.controller = controller;
		this.disposables.push(controller);
		this.disposables.push(model.onDidChangeTreeData.listen((node) => this.onDidChangeTreeData(node)));
		this.disposables.push(vs.debug.onDidTerminateDebugSession((e) => this.handleDebugSessionEnd(e)));
		model.addTestEventListener(this);

		if (discoverer)
			controller.resolveHandler = (item: vs.TestItem | undefined) => this.resolveTestItem(item);

		controller.createRunProfile("Run", vs.TestRunProfileKind.Run, (request, token) =>
			this.runTests(false, request, token));

		controller.createRunProfile("Debug", vs.TestRunProfileKind.Debug, (request, token) =>
			this.runTests(true, request, token));
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

	private handleDebugSessionEnd(e: vs.DebugSession): any {
		const run = this.testRuns[e.configuration.dartCodeDebugSessionID];
		if (run?.shouldEndWithSession)
			run.run.end();
	}

	public getLatestData(test: vs.TestItem): TreeNode | undefined {
		return this.nodeForItem.get(test);
	}

	public async runTests(debug: boolean, request: vs.TestRunRequest, token: vs.CancellationToken): Promise<void> {
		await this.discoverer?.ensureSuitesDiscovered();

		const testsToRun = new Set<vs.TestItem>();
		const isRunningAll = !request.include?.length && !request.exclude?.length;
		(request.include ?? this.controller.items).forEach((item) => testsToRun.add(item));
		request.exclude?.forEach((item) => testsToRun.delete(item));

		// For each item in the set, remove any of its descendants because they will be run by the parent.
		function removeWithDescendants(item: vs.TestItem) {
			testsToRun.delete(item);
			item.children.forEach((child) => removeWithDescendants(child));
		}
		const all = [...testsToRun];
		all.forEach((item) => item.children.forEach((child) => removeWithDescendants(child)));

		const run = this.controller.createTestRun(request);
		try {
			// As an optimisation, if we're no-debug and running complete files (eg. all included or excluded items are
			// suites), we can run the "fast path" in a single `dart test` invocation.
			if (!debug && [...testsToRun].every((item) => this.nodeForItem.get(item) instanceof SuiteNode)) {
				await vs.commands.executeCommand("_dart.runAllTestsWithoutDebugging", [...testsToRun].map((item) => this.nodeForItem.get(item)), run, isRunningAll);
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
			run.end();
		}
	}

	/// Replace the whole tree.
	private replaceAll() {
		const suiteTestItems = Object.values(this.model.suites)
			.map((suite) => this.createOrUpdateNode(suite.node))
			.filter(notUndefined);
		this.controller.items.replace(suiteTestItems);
	}

	private onDidChangeTreeData(node: TreeNode | undefined): void {
		if (node === undefined) {
			this.replaceAll();
			return;
		}

		this.createOrUpdateNode(node);
	}

	/// Creates a node (including its children), or if it already exists, updates it
	/// and its children.

	/// Does not add the item to its parent, so that the calling code can .replace()
	/// all children if required.
	///
	/// Returns undefined if in the case of an error or a node that should
	/// not be shown in the tree.
	private createOrUpdateNode(node: TreeNode): vs.TestItem | undefined {
		if (!this.shouldShowNode(node))
			return;

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
		let existingItem = collection.get(this.idForNode(node));

		// Create new item if required.
		if (!existingItem) {
			const newItem = this.createTestItem(node);
			existingItem = newItem;
		} else {
			// Otherwise, update this item to match the latest state.
			this.updateFields(existingItem, node);
		}

		// For new suites without chilren, set canResolveChildren because we can
		// open the file and discover tests from the Outline if the user expands them.
		if (node instanceof SuiteNode && node.children.length === 0)
			existingItem.canResolveChildren = true;

		existingItem.children.replace(
			node.children.map((c) => this.createOrUpdateNode(c)).filter(notUndefined),
		);

		return existingItem;
	}

	private shouldShowNode(node: TreeNode): boolean {
		if (config.showSkippedTests)
			return true;

		if (node instanceof TestNode && node.children.length === 0) {
			// Simple test node.
			// Show only if not skipped.
			return node.status !== TestStatus.Skipped;
		} else if (node instanceof TestNode) {
			// Dynamic test node with children.
			// Show only if any child not skipped.
			return !!node.children.find((c) => (c as TestNode).status !== TestStatus.Skipped);
		} else if (node instanceof GroupNode) {
			// Show only if status is not exactly skipped.
			return node.statuses.size !== 1 || !node.statuses.has(TestStatus.Skipped);
		} else {
			// Otherwise show eg. suites are always shown.
			return true;
		}
	}

	private idForNode(node: TreeNode) {
		if (node instanceof SuiteNode)
			return `SUITE:${node.suiteData.path}`;
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
		const uri = vs.Uri.file(node.suiteData.path);

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
		item.description = node.description;
		if ((node instanceof GroupNode || node instanceof TestNode) && node.range) {
			item.range = new vs.Range(
				new vs.Position(node.range.start.line, node.range.start.character),
				new vs.Position(node.range.end.line, node.range.end.character),
			);
		}
	}

	private getOrCreateTestRun(sessionID: string) {
		let run = this.testRuns[sessionID]?.run;
		if (!run) {
			run = this.controller.createTestRun(new vs.TestRunRequest(), undefined, true);
			this.registerTestRun(sessionID, run, true);
		}
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
			// TODO: isFailure??
			this.appendTestOutputLines(run, item, message);
			this.appendTestOutputLines(run, item, stack);
		}
	}

	public appendTestOutputLines(run: vs.TestRun, item: vs.TestItem, message: string) {
		if (message.trim() === "")
			return;
		run.appendOutput(`${formatForTerminal(rewriteUrisForTestOutput(message))}\r\n`, undefined, item);
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
				default:
					const outputEvents = node.outputEvents;
					const lastOutputEvent = outputEvents.length > 0 ? outputEvents[outputEvents.length - 1] : undefined;
					const errorString = lastOutputEvent ? this.formatNotification(lastOutputEvent) : "Unknown test failure";
					const testMessage = new vs.TestMessage(errorString);
					if (result === "failure")
						run.failed(item, testMessage, node.duration);
					else
						run.errored(item, testMessage, node.duration);
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
