// TODO: Move this to Shared (and remove dependencies on extension/)

import * as path from "path";
import * as vs from "vscode";
import { Outline, OutlineParams } from "../../shared/analysis/lsp/custom_protocol";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { TestModel, TestSource } from "../../shared/test/test_model";
import { disposeAll, uriToFilePath } from "../../shared/utils";
import { forceWindowsDriveLetterToUppercase, fsPath, getRandomInt } from "../../shared/utils/fs";
import { LspOutlineVisitor } from "../../shared/utils/outline_lsp";
import { extractTestNameFromOutline } from "../../shared/utils/test";
import { getDartWorkspaceFolders } from "../../shared/vscode/utils";
import { LspFileTracker } from "../analysis/file_tracker_lsp";
import { isTestFile } from "../utils";

export class TestDiscoverer implements IAmDisposable {
	private readonly disposables: IAmDisposable[] = [];

	private readonly debounceTimers: { [key: string]: NodeJS.Timeout } = {};
	private readonly debounceDuration = 1500;

	constructor(private readonly logger: Logger, private readonly fileTracker: LspFileTracker, private readonly model: TestModel) {
		this.disposables.push(fileTracker.onOutline.listen((o) => this.handleOutline(o)));
		this.startTestDiscovery();
	}

	private startTestDiscovery() {
		// Set up events for create/rename/delete.
		this.disposables.push(
			vs.workspace.onDidCreateFiles((e) => {
				e.files.forEach((file) => {
					const filePath = fsPath(file);
					if (isTestFile(filePath))
						this.model.suiteDiscovered(undefined, filePath);
				});
			}),
			vs.workspace.onDidRenameFiles(async (e) => {
				e.files.forEach(async (file) => {
					this.model.clearSuiteOrDirectory(fsPath(file.oldUri));
					this.discoverTests(fsPath(file.newUri));
				});
			}),
			vs.workspace.onDidDeleteFiles(async (e) => {
				e.files.forEach(async (file) => {
					this.model.clearSuiteOrDirectory(fsPath(file));
				});
			}),
		);

		// Process any existing things in the workspace.
		try {
			const workspaceFolders = getDartWorkspaceFolders();
			const topLevelFolders = workspaceFolders.map((w) => fsPath(w.uri));
			topLevelFolders.forEach((folder) => this.discoverTests(folder));
		} catch (e) {
			this.logger.error(`Failed to discover tests: ${e}`);
		}
	}

	private async discoverTests(fileOrDirectory: string, isDirectory?: boolean, level = 0) {
		if (level > 5) return; // Max levels to discover tests.

		if (isTestFile(fileOrDirectory)) {
			this.model.suiteDiscovered(undefined, fileOrDirectory);
		} else if (isDirectory !== false) { // undefined or true are allowed
			try {
				const children = await vs.workspace.fs.readDirectory(vs.Uri.file(fileOrDirectory));

				children
					.map((item) => ({ name: item[0], type: item[1] }))
					.filter((item) => !item.name.startsWith("."))
					.forEach((item) => this.discoverTests(path.join(fileOrDirectory, item.name), item.type === vs.FileType.Directory, level + 1));
			} catch (e: any) {
				if (e.code !== "FileNotADirectory")
					this.logger.error(`Failed to discover tests: ${e}`);
			}
		}
	}

	/// Forces an update for a file based on the last Outline data (if any).
	///
	/// Used by tests to ensure discovery results are available if the test tree state has
	/// been cleared between test runs.
	public forceUpdate(uri: vs.Uri) {
		const outline = this.fileTracker.getOutlineFor(uri);
		if (outline)
			this.rebuildFromOutline(fsPath(uri), outline);
	}

	private handleOutline(outline: OutlineParams) {
		const suitePath = forceWindowsDriveLetterToUppercase(uriToFilePath(outline.uri));

		const existingTimeout = this.debounceTimers[suitePath];
		if (existingTimeout)
			clearTimeout(existingTimeout);
		this.debounceTimers[suitePath] = setTimeout(() => this.rebuildFromOutline(suitePath, outline.outline), this.debounceDuration);
	}

	private rebuildFromOutline(suitePath: string, outline: Outline) {
		if (isTestFile(suitePath)) {
			// Force creation of a node if it's not already there.
			const [suite, _] = this.model.getOrCreateSuite(suitePath);

			// Generate a unique ID for these IDs to be owned by so that they can be looked
			// up independent of any other ongoing runs.
			const dartCodeDebugSessionID = `discovery-${getRandomInt(0x1000, 0x10000).toString(16)}`;

			// Mark everything in the suite as potentially-deleted so that we can detect anything
			// that was not present in the new list to remove it afterwards.
			this.model.markAllAsPotentiallyDeleted(suite, TestSource.Outline);

			const visitor = new TestDiscoveryVisitor(this.logger, this.model, dartCodeDebugSessionID, suitePath);
			visitor.visit(outline);

			this.model.removeAllPotentiallyDeletedNodes(suite);
			this.model.rebuildSuiteNode(suite);
			this.model.updateNode();
		}
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

class TestDiscoveryVisitor extends LspOutlineVisitor {
	private readonly stack: Array<{ id: number, name: string }> = [];
	private id = 1;

	constructor(logger: Logger, private readonly model: TestModel, private readonly dartCodeDebugSessionID: string, private readonly suitePath: string) {
		super(logger);
	}

	protected visitUnitTestTest(outline: Outline) {
		this.handleItem(outline, false, super.visitUnitTestTest);
	}
	protected visitUnitTestGroup(outline: Outline) {
		this.handleItem(outline, true, super.visitUnitTestGroup);
	}

	private handleItem(outline: Outline, isGroup: boolean, base: (outline: Outline) => void) {
		const name = extractTestNameFromOutline(outline.element.name);
		if (!name || !outline.element.range)
			return;

		const range = outline.codeRange || outline.range || (outline.element ? outline.element.range : undefined);
		const parent = this.stack.length > 0 ? this.stack[this.stack.length - 1] : undefined;

		const fullName = parent?.name
			? `${parent.name} ${name}`
			: name;

		const thisID = this.id++;
		if (isGroup)
			this.model.groupDiscovered(this.dartCodeDebugSessionID, this.suitePath, TestSource.Outline, thisID, fullName, parent?.id, undefined, range);
		else
			this.model.testDiscovered(this.dartCodeDebugSessionID, this.suitePath, TestSource.Outline, thisID, fullName, parent?.id, undefined, range, undefined);

		if (isGroup)
			this.stack.push({ id: thisID, name: fullName });
		try {
			base.bind(this)(outline);
		} finally {
			if (isGroup)
				this.stack.pop();
		}
	}
}
