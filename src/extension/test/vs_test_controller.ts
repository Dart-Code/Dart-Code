import * as path from "path";
import * as vs from "vscode";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { GroupNode, SuiteNode, TestContainerNode, TestEventListener, TestModel, TestNode, TreeNode } from "../../shared/test/test_model";
import { disposeAll, notUndefined } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";

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

	private async runTests(debug: boolean, request: vs.TestRunRequest, token: vs.CancellationToken): Promise<void> {
		const run = this.controller.createTestRun(request);
		const testsToRun: vs.TestItem[] = [];
		(request.include ?? this.controller.items).forEach((item) => testsToRun.push(item));

		for (const test of testsToRun) {
			const node = this.nodeForItem.get(test);
			if (!node) continue;

			const command = debug ? "dart.startDebuggingTest" : "dart.startWithoutDebuggingTest";
			await vs.commands.executeCommand(command, node, run);
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
	///
	/// Returns undefined if in the case of an error or a node that should
	/// not be shown in the tree.
	private createOrUpdateNode(node: TreeNode): vs.TestItem | undefined {
		if (node instanceof TestNode && node.hidden)
			return;
		if (node instanceof GroupNode && node.isPhantomGroup)
			return;

		let collection;
		if (node instanceof SuiteNode) {
			collection = this.controller.items;
		} else if (node instanceof GroupNode) {
			// If the parent is a Phantom group, jump over it.
			let parent = node.parent;
			while (parent instanceof GroupNode && parent.isPhantomGroup)
				parent = parent.parent;
			collection = this.itemForNode.get(parent)?.children;
		} else {
			collection = this.itemForNode.get(node.parent!)?.children;
		}

		if (!collection) {
			this.logger.error(`Failed to find parent (${node.parent?.label}) of node (${node.label})`);
			return;
		}
		const existingItem = collection.get(this.idForNode(node));

		// Create new item if required.
		if (!existingItem) {
			const newItem = this.createTestItem(node);
			collection.add(newItem);
			return newItem;
		}

		// Otherwise, update this item to match the latest state.
		this.updateFields(existingItem, node);

		if (node instanceof TestContainerNode) {
			// Update al children. Note: crrateOrUpdateNode() adds the child to the tree
			// so we don't need to do anything with the result here.
			for (const child of node.children) {
				this.createOrUpdateNode(child);
			}
		}

		return existingItem;
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

		if (node instanceof TestContainerNode && node.children) {
			for (const child of node.children) {
				item.children.add(this.createTestItem(child));
			}
		}

		return item;
	}

	private updateFields(item: vs.TestItem, node: TreeNode) {
		item.description = node.description;
		if ((node instanceof GroupNode || node instanceof TestNode) && node.line) {
			const pos = new vs.Position(node.line - 1, node.column ?? 0);
			item.range = new vs.Range(pos, pos);
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

	public suiteDiscovered(sessionID: string, node: SuiteNode): void {
		// const run = this.getOrCreateTestRun(sessionID);
		// const item = this.itemForNode.get(node);
	}

	public groupDiscovered(sessionID: string, node: GroupNode): void {
		// const run = this.getOrCreateTestRun(sessionID);
		// const item = this.itemForNode.get(node);
	}

	public testStarted(sessionID: string, node: TestNode): void {
		const run = this.getOrCreateTestRun(sessionID);
		const item = this.itemForNode.get(node);
		if (run && item)
			run.started(item);
	}

	public testOutput(sessionID: string, node: TestNode, message: string): void {
		const run = this.getOrCreateTestRun(sessionID);
		const item = this.itemForNode.get(node);
		if (run && item)
			run.appendOutput(message);
	}

	public testErrorOutput(sessionID: string, node: TestNode, message: string, isFailure: boolean, stack: string): void {
		const run = this.getOrCreateTestRun(sessionID);
		const item = this.itemForNode.get(node);
		if (run && item) {
			// TODO: isFailure??
			run.appendOutput(message);
			run.appendOutput(stack);
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
				case "failure":
					run.failed(item, new vs.TestMessage("FAILURE TODO"), node.duration);
					break;
				default:
					run.errored(item, new vs.TestMessage("FAILURE TODO"), node.duration);
					break;
			}
		}
	}

	public suiteDone(sessionID: string, node: SuiteNode): void {
		const run = this.getOrCreateTestRun(sessionID);
		run.end();
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
