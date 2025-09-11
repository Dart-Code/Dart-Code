// TODO: Move this to Shared (and remove dependencies on extension/)

import * as path from "path";
import * as vs from "vscode";
import { Outline, OutlineParams } from "../../shared/analysis/lsp/custom_protocol";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { SuiteNode, TestModel, TestSource } from "../../shared/test/test_model";
import { disposeAll, uriToFilePath } from "../../shared/utils";
import { forceWindowsDriveLetterToUppercase, fsPath, getRandomInt, isWithinPathOrEqual } from "../../shared/utils/fs";
import { OutlineVisitor } from "../../shared/utils/outline";
import { extractTestNameFromOutline } from "../../shared/utils/test";
import { getAllProjectFoldersAndExclusions } from "../../shared/vscode/utils";
import { FileTracker } from "../analysis/file_tracker";
import { config } from "../config";
import { getExcludedFolders, isTestFile } from "../utils";

export class TestDiscoverer implements IAmDisposable {
	private readonly disposables: IAmDisposable[] = [];

	private readonly debounceTimers: Record<string, NodeJS.Timeout> = {};
	private readonly debounceDuration = 1500;

	private hasSetupFileHandlers = false;

	public testDiscoveryPerformed: Promise<void> | undefined;
	public excludedFolders: Set<string> | undefined;

	constructor(private readonly logger: Logger, public readonly fileTracker: FileTracker, private readonly model: TestModel) {
		this.disposables.push(fileTracker.onOutline((o) => this.handleOutline(o)));
	}

	/// Performs suite discovery if it has not already finished. If discovery
	/// is started (or already in progress), waits for it to complete.
	public async ensureSuitesDiscovered() {
		if (!this.testDiscoveryPerformed)
			this.testDiscoveryPerformed = this.performSuiteDiscovery();

		// Wait for discovery to complete, however it started.
		await this.testDiscoveryPerformed;
	}

	private isExcludedPath(fileOrFolderPath: string) {
		return this.excludedFolders
			? [...this.excludedFolders].some((f) => isWithinPathOrEqual(fileOrFolderPath, f))
			: false;
	}

	/// Immediately performs suite discovery. Use [ensureSuitesDiscovered] if you want
	/// to just ensure discovery has run at least once.
	///
	/// Also sets up handlers so creating/renaming/deleting files updates the
	/// discovered suite list correctly.
	private async performSuiteDiscovery() {
		// Set up events for create/rename/delete so we keep the suites updated
		// once we have discovered them.
		if (!this.hasSetupFileHandlers) {
			this.hasSetupFileHandlers = true;
			const watcher = vs.workspace.createFileSystemWatcher(
				"**/*_test.dart",
				false, // ignoreCreateEvents
				true, // ignoreChangeEvents
				false, // ignoreDeleteEvents
			);
			this.disposables.push(
				watcher,
				watcher.onDidCreate(async (uri) => {
					const filePath = fsPath(uri);
					if (isTestFile(filePath) && !this.isExcludedPath(filePath))
						this.model.suiteDiscovered(undefined, filePath);
				}),
				watcher.onDidDelete((uri) => {
					const filePath = fsPath(uri);
					// Don't use isTestFile() here because it calls isDartDocument() which checks
					// for existence, but we've just been deleted.
					this.model.clearSuiteOrDirectory(filePath);
				}),
			);
		}

		await vs.window.withProgress(
			{
				location: vs.ProgressLocation.Window,
				title: "Discovering Tests…",
			},
			async () => {
				try {
					const projectFoldersAndExclusions = await getAllProjectFoldersAndExclusions(this.logger, getExcludedFolders, { requirePubspec: true, searchDepth: config.projectSearchDepth });
					const projectFolders = projectFoldersAndExclusions.projectFolders;
					this.excludedFolders = projectFoldersAndExclusions.excludedFolders;
					await Promise.all(projectFolders.map((folder) => this.discoverTestSuites(folder)));
				} catch (e) {
					this.logger.error(`Failed to discover tests: ${e}`);
				}
			},
		);
	}

	private async discoverTestSuites(fileOrDirectory: string, isDirectory?: boolean, level = 0) {
		if (level > 100) return; // Ensure we don't traverse too far or follow any cycles.

		if (isTestFile(fileOrDirectory)) {
			this.model.suiteDiscovered(undefined, fileOrDirectory);
		} else if (isDirectory !== false) { // undefined or true are allowed
			try {
				const children = await vs.workspace.fs.readDirectory(vs.Uri.file(fileOrDirectory));

				const childPromises = children
					.map((item) => ({ name: item[0], type: item[1] }))
					.filter((item) => !item.name.startsWith("."))
					.map((item) => ({ name: item.name, type: item.type, path: path.join(fileOrDirectory, item.name) }))
					.filter((item) => !(this.excludedFolders?.has(item.path) ?? false))
					.map((item) => this.discoverTestSuites(item.path, item.type === vs.FileType.Directory, level + 1));

				await Promise.all(childPromises);
			} catch (e: any) {
				if (e.code !== "FileNotADirectory")
					this.logger.error(`Failed to discover tests: ${e}`);
			}
		}
	}

	public async discoverTestsForSuite(node: SuiteNode): Promise<void> {
		const doc = await vs.workspace.openTextDocument(node.suiteData.path);
		// Opening a file that hasn't been opened before does not force analysis, so send a light request that will force
		// analysis and for the outline to be sent.
		await vs.commands.executeCommand("vscode.executeHoverProvider", doc.uri, new vs.Position(0, 0));
		await this.fileTracker.waitForOutline(doc, undefined);
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

		// If this is the first outline for a file (eg. we've never had a timeout)
		// we should skip the debounce so things are initially more responsive.
		const debounceDuration = existingTimeout ? this.debounceDuration : 0;

		this.debounceTimers[suitePath] = setTimeout(() => this.rebuildFromOutline(suitePath, outline.outline), debounceDuration);
	}

	private rebuildFromOutline(suitePath: string, outline: Outline) {
		if (isTestFile(suitePath)) {
			// Generate a unique ID for these IDs to be owned by so that they can be looked
			// up independent of any other ongoing runs.
			const dartCodeDebugSessionID = `discovery-${getRandomInt(0x1000, 0x10000).toString(16)}`;

			// Force creation of a node if it's not already there.
			const suite = this.model.suiteDiscoveredConditional(dartCodeDebugSessionID, suitePath);

			// Mark everything in the suite as potentially-deleted so that we can detect anything
			// that was not present in the new list to remove it afterwards.
			this.model.markAllAsPotentiallyDeleted(suite, TestSource.Outline);

			const visitor = new TestDiscoveryVisitor(this.logger, this.model, dartCodeDebugSessionID, suitePath);
			visitor.visit(outline);

			this.model.removeAllPotentiallyDeletedNodes(suite);
			this.model.updateSuiteTestCountLabels(suite, true);
		}
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

class TestDiscoveryVisitor extends OutlineVisitor {
	private readonly stack: Array<{ id: number, name: string }> = [];
	private id = 1;

	constructor(logger: Logger, private readonly model: TestModel, private readonly dartCodeDebugSessionID: string, private readonly suitePath: string) {
		super(logger);
	}

	protected visitUnitTestTest(outline: Outline) {
		this.handleItem(outline, false, super.visitUnitTestTest.bind(this));
	}
	protected visitUnitTestGroup(outline: Outline) {
		this.handleItem(outline, true, super.visitUnitTestGroup.bind(this));
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
