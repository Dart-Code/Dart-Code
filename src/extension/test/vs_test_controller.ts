import * as path from "path";
import * as vs from "vscode";
import { TestStatus } from "../../shared/enums";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { GroupNode, SuiteData, SuiteNode, TestEventListener, TestModel, TestNode, TreeNode } from "../../shared/test/test_model";
import { ErrorNotification, PrintNotification } from "../../shared/test_protocol";
import { disposeAll, notUndefined } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { config } from "../config";
import { formatForTerminal } from "../utils/vscode/terminals";

export class VsCodeTestController implements TestEventListener, IAmDisposable {
	private disposables: IAmDisposable[] = [];
	public readonly controller: vs.TestController;
	private itemForNode = new WeakMap<TreeNode, vs.TestItem>();
	private nodeForItem = new WeakMap<vs.TestItem, TreeNode>();
	private testRuns: { [key: string]: vs.TestRun | undefined } = {};

	public registerTestRun(dartCodeDebugSessionId: string, run: vs.TestRun): void {
		this.testRuns[dartCodeDebugSessionId] = run;
	}

	constructor(private readonly logger: Logger, private readonly model: TestModel) {
		const controller = vs.tests.createTestController("dart", "Dart & Flutter");
		this.controller = controller;
		this.disposables.push(controller);
		this.disposables.push(model.onDidChangeTreeData.listen((node) => this.onDidChangeTreeData(node)));
		model.addTestEventListener(this);

		controller.createRunProfile("Run", vs.TestRunProfileKind.Run, (request, token) => {
			this.runTests(false, request, token);
		});

		controller.createRunProfile("Debug", vs.TestRunProfileKind.Debug, (request, token) => {
			this.runTests(true, request, token);
		});
	}

	public getLatestData(test: vs.TestItem): TreeNode | undefined {
		return this.nodeForItem.get(test);
	}

	private async runTests(debug: boolean, request: vs.TestRunRequest, token: vs.CancellationToken): Promise<void> {
		const run = this.controller.createTestRun(request);
		const testsToRun = new Set<vs.TestItem>();
		(request.include ?? this.controller.items).forEach((item) => testsToRun.add(item));

		// For each item in the set, remove any of its descendants because they will be run by the parent.
		function removeWithDescendants(item: vs.TestItem) {
			testsToRun.delete(item);
			item.children.forEach((child) => removeWithDescendants(child));
		}
		const all = [...testsToRun];
		all.forEach((item) => item.children.forEach((child) => removeWithDescendants(child)));

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

		for (const suite of testsBySuite.keys()) {
			const nodes = testsBySuite.get(suite);
			if (!nodes) continue;

			const command = debug
				? "_dart.startDebuggingTestsFromVsTestController"
				: "_dart.startWithoutDebuggingTestsFromVsTestController";
			await vs.commands.executeCommand(command, suite, nodes, run);
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
		return node instanceof GroupNode || node instanceof TestNode
			? `${node.suiteData.path}:${node.name}`
			: node.suiteData.path;
	}

	private cleanLabel(label: string) {
		return label.trim().split("\n").map((l) => l.trim()).join(" ");
	}

	private labelForSuite(node: SuiteNode): string {
		const suitePath = node.suiteData.path;
		const wf = vs.workspace.getWorkspaceFolder(vs.Uri.file(suitePath));

		return wf
			? path.relative(fsPath(wf.uri), node.suiteData.path).replace("\\", "/")
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
		let run = this.testRuns[sessionID];
		if (!run) {
			run = this.controller.createTestRun(new vs.TestRunRequest(), undefined, true);
			this.registerTestRun(sessionID, run);
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
			run.appendOutput(`${formatForTerminal(message)}\r\n`);
	}

	public testErrorOutput(sessionID: string, node: TestNode, message: string, isFailure: boolean, stack: string): void {
		const run = this.getOrCreateTestRun(sessionID);
		const item = this.itemForNode.get(node);
		if (run && item) {
			// TODO: isFailure??
			run.appendOutput(`${formatForTerminal(message)}\r\n`);
			run.appendOutput(`${formatForTerminal(stack)}\r\n`);
		}
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
					const errors = node.outputEvents.map((e) => this.formatError(e)).filter(notUndefined);
					const errorString = errors.join("\n");
					if (result == "failure")
						run.failed(item, new vs.TestMessage(errorString), node.duration);
					else
						run.errored(item, new vs.TestMessage(errorString), node.duration);
					break;
			}
		}
	}

	private formatError(error: ErrorNotification | PrintNotification) {
		if (!("error" in error))
			return;

		return [
			error.error ?? "",
			error.stackTrace ?? "",
		].join("\n").trim();
	}

	public suiteDone(sessionID: string, node: SuiteNode): void {
		const run = this.getOrCreateTestRun(sessionID);
		run.end();
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
