import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { noAction } from "../../shared/constants";
import { TestStatus } from "../../shared/enums";
import { Logger } from "../../shared/interfaces";
import { GroupNode, SuiteData, SuiteNode, TestModel, TestNode, TreeNode } from "../../shared/test/test_model";
import { disposeAll, escapeDartString, generateTestNameFromFileName } from "../../shared/utils";
import { fsPath, isWithinPath, mkDirRecursive } from "../../shared/utils/fs";
import { TestOutlineInfo, TestOutlineVisitor } from "../../shared/utils/outline_das";
import { LspTestOutlineInfo, LspTestOutlineVisitor } from "../../shared/utils/outline_lsp";
import { createTestFileAction, defaultTestFileContents, getLaunchConfig, TestName } from "../../shared/utils/test";
import { getAllProjectFolders } from "../../shared/vscode/utils";
import { WorkspaceContext } from "../../shared/workspace";
import { DasFileTracker } from "../analysis/file_tracker_das";
import { LspFileTracker } from "../analysis/file_tracker_lsp";
import { config } from "../config";
import { isDartDocument } from "../editors";
import { VsCodeTestController } from "../test/vs_test_controller";
import { ensureDebugLaunchUniqueId, getExcludedFolders, isInsideFlutterProject, isTestFile } from "../utils";

const CURSOR_IS_IN_TEST = "dart-code:cursorIsInTest";
const CAN_JUMP_BETWEEN_TEST_IMPLEMENTATION = "dart-code:canGoToTestOrImplementationFile";
// HACK: Used for testing since we can't read contexts?
export let cursorIsInTest = false;
export let isInTestFileThatHasImplementation = false;
export let isInImplementationFileThatCanHaveTest = false;

export type SuiteList = [SuiteNode, TestName[]];

abstract class TestCommands implements vs.Disposable {
	private disposables: vs.Disposable[] = [];

	constructor(protected readonly logger: Logger, private readonly testModel: TestModel, protected readonly wsContext: WorkspaceContext, private readonly vsCodeTestController: VsCodeTestController | undefined, protected readonly flutterCapabilities: FlutterCapabilities) {
		this.disposables.push(
			vs.commands.registerCommand("_dart.startDebuggingTestsFromVsTestController", (suiteData: SuiteData, treeNodes: Array<SuiteNode | GroupNode | TestNode>, suppressPromptOnErrors: boolean, testRun: vs.TestRun | undefined) => this.runTestsForNode(suiteData, this.getTestNamesForNodes(treeNodes), true, suppressPromptOnErrors, treeNodes.length === 1 && treeNodes[0] instanceof TestNode, undefined, testRun)),
			vs.commands.registerCommand("_dart.startWithoutDebuggingTestsFromVsTestController", (suiteData: SuiteData, treeNodes: Array<SuiteNode | GroupNode | TestNode>, suppressPromptOnErrors: boolean, testRun: vs.TestRun | undefined) => this.runTestsForNode(suiteData, this.getTestNamesForNodes(treeNodes), false, suppressPromptOnErrors, treeNodes.length === 1 && treeNodes[0] instanceof TestNode, undefined, testRun)),
			vs.commands.registerCommand("dart.startDebuggingTest", (treeNode: SuiteNode | GroupNode | TestNode) => this.runTestsForNode(treeNode.suiteData, this.getTestNames(treeNode), true, false, treeNode instanceof TestNode, undefined)),
			vs.commands.registerCommand("dart.startWithoutDebuggingTest", (treeNode: SuiteNode | GroupNode | TestNode) => this.runTestsForNode(treeNode.suiteData, this.getTestNames(treeNode), false, false, treeNode instanceof TestNode, undefined)),
			vs.commands.registerCommand("dart.startDebuggingSkippedTests", (treeNode: SuiteNode | GroupNode | TestNode) => this.runTestsForNode(treeNode.suiteData, this.getTestNames(treeNode, TestStatus.Skipped), true, false, true)),
			vs.commands.registerCommand("dart.startWithoutDebuggingSkippedTests", (treeNode: SuiteNode | GroupNode | TestNode) => this.runTestsForNode(treeNode.suiteData, this.getTestNames(treeNode, TestStatus.Skipped), false, false, true)),
			vs.commands.registerCommand("dart.startDebuggingFailedTests", (treeNode: SuiteNode | GroupNode | TestNode) => this.runTestsForNode(treeNode.suiteData, this.getTestNames(treeNode, TestStatus.Failed), true, false, false)),
			vs.commands.registerCommand("dart.startWithoutDebuggingFailedTests", (treeNode: SuiteNode | GroupNode | TestNode) => this.runTestsForNode(treeNode.suiteData, this.getTestNames(treeNode, TestStatus.Failed), false, false, false)),
			vs.commands.registerCommand("dart.runAllSkippedTestsWithoutDebugging", () => this.runAllSkippedTests()),
			vs.commands.registerCommand("dart.runAllFailedTestsWithoutDebugging", () => this.runAllFailedTests()),
			vs.commands.registerCommand("dart.runAllTestsWithoutDebugging", (suites?: SuiteNode[], testRun?: vs.TestRun) => this.runAllTestsWithoutDebugging(suites, testRun)),
			vs.commands.registerCommand("dart.goToTests", (resource: vs.Uri | undefined) => this.goToTestOrImplementationFile(resource), this),
			vs.commands.registerCommand("dart.goToTestOrImplementationFile", () => this.goToTestOrImplementationFile(), this),
			vs.window.onDidChangeTextEditorSelection((e) => this.updateSelectionContexts(e)),
			vs.window.onDidChangeActiveTextEditor((e) => this.updateEditorContexts(e)),
		);

		if (!config.useVsCodeTestRunner)
			this.disposables.push(
				vs.commands.registerCommand("dart.runTestAtCursor", () => this.runTestAtCursor(false), this),
				vs.commands.registerCommand("dart.debugTestAtCursor", () => this.runTestAtCursor(true), this),
			);

		// Run for current open editor.
		this.updateEditorContexts(vs.window.activeTextEditor);

		this.disposables.push(vs.commands.registerCommand("_dart.startDebuggingTestFromOutline", (test: TestOutlineInfo, launchTemplate: any | undefined) =>
			this.startTestFromOutline(false, test, launchTemplate)));
		this.disposables.push(vs.commands.registerCommand("_dart.startWithoutDebuggingTestFromOutline", (test: TestOutlineInfo, launchTemplate: any | undefined) =>
			this.startTestFromOutline(true, test, launchTemplate)));
	}

	private async runAllTestsWithoutDebugging(suites?: SuiteNode[], testRun?: vs.TestRun): Promise<void> {
		// To run multiple folders/suites, we can pass the first as `program` and the rest as `args` which
		// will be appended immediately after `program`. However, this only works for things in the same project
		// as the first one that runs will be used for resolving package: URIs etc.
		// So, fetch all project folders, then if we have suites, group them into those folders, and otherwise
		// use their 'test' folders.
		function getItemsToRunInProject(projectFolder: string) {
			if (suites) {
				return suites
					.map((suite) => suite.suiteData.path)
					.filter((suitePath) => isWithinPath(suitePath, projectFolder));
			} else {
				const testFolder = path.join(projectFolder, "test");
				return fs.existsSync(testFolder) ? [testFolder] : [];
			}
		}

		const projectsWithTests = (await getAllProjectFolders(this.logger, getExcludedFolders, { requirePubspec: true }))
			.map(getItemsToRunInProject)
			.filter((tests) => tests.length);
		if (projectsWithTests.length === 0) {
			vs.window.showErrorMessage("Unable to find any test folders");
			return;
		}

		await Promise.all(projectsWithTests.map((projectWithTests) => {
			const template = projectWithTests.length > 1
				? { args: projectWithTests.slice(1) }
				: undefined;
			return this.runTests(projectWithTests[0], false, undefined, false, true, template, testRun, undefined);
		}));
	}

	private async runAllSkippedTests(): Promise<void> {
		await this.runAllTests(TestStatus.Skipped);
	}

	private async runAllFailedTests(): Promise<void> {
		await this.runAllTests(TestStatus.Failed);
	}

	private async runAllTests(onlyOfType: TestStatus): Promise<void> {
		const topLevelNodes = Object.values(this.testModel.suites).map((suite) => suite.node);

		const suiteList = topLevelNodes
			.filter((node) => node instanceof SuiteNode && node.hasStatus(onlyOfType))
			.map((m) => [m, this.getTestNames(m, onlyOfType)] as SuiteList);
		if (suiteList.length === 0)
			return;

		const percentProgressPerTest = 99 / suiteList.map((sl) => sl[1].length).reduce((a, b) => a + b);
		await vs.window.withProgress(
			{
				cancellable: true,
				location: vs.ProgressLocation.Notification,
				title: `Running ${TestStatus[onlyOfType].toString().toLowerCase()} tests`,
			},
			async (progress, token) => {
				progress.report({ increment: 1 });
				for (const suite of suiteList) {
					const node = suite[0];
					const failedTestNames = suite[1];
					if (token.isCancellationRequested)
						break;
					const suiteName = path.basename(node.suiteData.path);
					progress.report({ message: suiteName });
					await this.runTestsForNode(node.suiteData, failedTestNames, false, true, onlyOfType === TestStatus.Skipped, token);
					progress.report({ message: suiteName, increment: failedTestNames.length * percentProgressPerTest });
				}
			},
		);
	}

	private async runTestsForNode(suiteData: SuiteData, testNames: TestName[] | undefined, debug: boolean, suppressPromptOnErrors: boolean, runSkippedTests: boolean, token?: vs.CancellationToken, testRun?: vs.TestRun) {
		const programPath = fsPath(suiteData.path);
		const canRunSkippedTest = this.flutterCapabilities.supportsRunSkippedTests || !isInsideFlutterProject(vs.Uri.file(suiteData.path));
		const shouldRunSkippedTests = runSkippedTests && canRunSkippedTest;

		return this.runTests(programPath, debug, testNames, shouldRunSkippedTests, suppressPromptOnErrors, undefined, testRun, token);
	}

	private runTests(programPath: string, debug: boolean, testNames: TestName[] | undefined, shouldRunSkippedTests: boolean, suppressPromptOnErrors: boolean, launchTemplate: any | undefined, testRun: vs.TestRun | undefined, token: vs.CancellationToken | undefined): Promise<boolean> {
		const subs: vs.Disposable[] = [];
		return new Promise<boolean>(async (resolve, reject) => {
			let testsName = path.basename(programPath);
			// Handle when running whole test folder.
			if (testsName === "test")
				testsName = path.basename(path.dirname(programPath));
			const launchConfiguration = {
				suppressPromptOnErrors,
				...getLaunchConfig(
					!debug,
					programPath,
					testNames,
					shouldRunSkippedTests,
					launchTemplate,
				),
				name: `${path.basename(programPath)} tests`,
			};

			// Ensure we have a unique ID for this session so we can track when it completes.
			const dartCodeDebugSessionID = ensureDebugLaunchUniqueId(launchConfiguration);

			// If we were given a test to use by VS Code, use it. Otherwise we'll lazily create one at the
			// other end.
			if (testRun)
				this.vsCodeTestController?.registerTestRun(dartCodeDebugSessionID, testRun, false);

			if (token) {
				subs.push(vs.debug.onDidStartDebugSession((e) => {
					if (e.configuration.dartCodeDebugSessionID === dartCodeDebugSessionID)
						subs.push(token.onCancellationRequested(() => e.customRequest("disconnect")));
				}));
			}
			subs.push(vs.debug.onDidTerminateDebugSession((e) => {
				if (e.configuration.dartCodeDebugSessionID === dartCodeDebugSessionID)
					resolve(true);
			}));
			const didStart = await vs.debug.startDebugging(
				vs.workspace.getWorkspaceFolder(vs.Uri.file(programPath)),
				launchConfiguration
			);
			if (!didStart)
				reject();
		}).finally(() => {
			disposeAll(subs);
		});
	}

	private getTestNamesForNodes(nodes: TreeNode[]): TestName[] | undefined {
		if (nodes.find((node) => node instanceof SuiteNode))
			return undefined;

		return (nodes as Array<GroupNode | TestNode>)
			.filter((treeNode) => treeNode.name)
			.map((treeNode) => ({ name: treeNode.name!, isGroup: treeNode instanceof GroupNode }));
	}

	private getTestNames(treeNode: TreeNode, onlyOfStatus?: TestStatus): TestName[] | undefined {
		// If we're getting all tests, we can just use the test name/group name (or undefined for suite) directly.
		if (onlyOfStatus === undefined) {
			if ((treeNode instanceof TestNode || treeNode instanceof GroupNode) && treeNode.name !== undefined)
				return [{ name: treeNode.name, isGroup: treeNode instanceof GroupNode }];

			return undefined;
		}

		// Otherwise, collect all descendant tests that are of the specified type.
		let names: TestName[] = [];
		if (treeNode instanceof SuiteNode || treeNode instanceof GroupNode) {
			for (const child of treeNode.children) {
				const childNames = this.getTestNames(child, onlyOfStatus);
				if (childNames)
					names = names.concat(childNames);
			}
		} else if (treeNode instanceof TestNode && treeNode.name !== undefined) {
			if (treeNode.status === onlyOfStatus)
				names.push({ name: treeNode.name, isGroup: treeNode instanceof GroupNode });
		}

		return names;
	}

	private startTestFromOutline(noDebug: boolean, test: TestOutlineInfo, launchTemplate: any | undefined) {
		const canRunSkippedTest = !test.isGroup && (this.flutterCapabilities.supportsRunSkippedTests || !isInsideFlutterProject(vs.Uri.file(test.file)));
		const shouldRunSkippedTests = canRunSkippedTest; // These are the same when running directly, since we always run skipped.

		return this.runTests(
			test.file,
			!noDebug,
			[{ name: test.fullName, isGroup: test.isGroup }],
			shouldRunSkippedTests,
			false,
			launchTemplate,
			undefined,
			undefined,
		);
	}

	private async runTestAtCursor(debug: boolean): Promise<void> {
		const editor = vs.window.activeTextEditor;
		const test = editor && editor.selection && this.testForCursor(editor);

		if (test) {
			const command = debug
				? "_dart.startDebuggingTestFromOutline"
				: "_dart.startWithoutDebuggingTestFromOutline";
			vs.commands.executeCommand(command, test);
		} else {
			vs.window.showWarningMessage("There is no test at the current location.");
		}
	}

	private async goToTestOrImplementationFile(resource?: vs.Uri): Promise<void> {
		const doc = resource
			? await vs.workspace.openTextDocument(resource)
			: vs.window.activeTextEditor?.document;
		if (doc && isDartDocument(doc)) {
			const filePath = fsPath(doc.uri);
			const isTest = isTestFile(filePath);
			const otherFile = isTest
				? this.getImplementationFileForTest(filePath)
				: this.getTestFileForImplementation(filePath);

			if (!otherFile || (isTest && !fs.existsSync(otherFile)))
				return;

			let selectionOffset: number | undefined;
			let selectionLength: number | undefined;

			// Offer to create test files.
			if (!fs.existsSync(otherFile)) {
				if (isTest)
					return;

				const relativePath = vs.workspace.asRelativePath(otherFile, false);
				const yesAction = createTestFileAction(relativePath);
				const response = await vs.window.showInformationMessage(
					`Would you like to create a test file at ${relativePath}?`,
					yesAction,
					noAction,
				);

				if (response !== yesAction)
					return;

				mkDirRecursive(path.dirname(otherFile));
				const testFileInfo = defaultTestFileContents(this.wsContext.hasAnyFlutterProjects, escapeDartString(generateTestNameFromFileName(relativePath)));
				fs.writeFileSync(otherFile, testFileInfo.contents);

				selectionOffset = testFileInfo.selectionOffset;
				selectionLength = testFileInfo.selectionLength;
			}

			const document = await vs.workspace.openTextDocument(otherFile);
			const editor = await vs.window.showTextDocument(document);

			if (selectionOffset && selectionLength)
				editor.selection = new vs.Selection(document.positionAt(selectionOffset), document.positionAt(selectionOffset + selectionLength));
		}
	}

	private updateSelectionContexts(e: vs.TextEditorSelectionChangeEvent): void {
		const isValidTestLocation = !!(e.textEditor && e.selections && e.selections.length === 1 && this.testForCursor(e.textEditor));
		vs.commands.executeCommand("setContext", CURSOR_IS_IN_TEST, isValidTestLocation);
		cursorIsInTest = isValidTestLocation;
	}

	private updateEditorContexts(e: vs.TextEditor | undefined): void {
		isInTestFileThatHasImplementation = false;
		isInImplementationFileThatCanHaveTest = false;

		if (e && e.document && isDartDocument(e.document)) {
			const filePath = fsPath(e.document.uri);
			if (isTestFile(filePath)) {
				// Implementation files must exist.
				const implementationFilePath = this.getImplementationFileForTest(filePath);
				isInTestFileThatHasImplementation = !!implementationFilePath && fs.existsSync(implementationFilePath);
			} else {
				isInImplementationFileThatCanHaveTest = !!this.getTestFileForImplementation(filePath);
			}
		}

		vs.commands.executeCommand("setContext", CAN_JUMP_BETWEEN_TEST_IMPLEMENTATION, isInTestFileThatHasImplementation || isInImplementationFileThatCanHaveTest);
	}

	private getImplementationFileForTest(filePath: string) {
		const pathSegments = filePath.split(path.sep);

		// Replace test folder with lib.
		const testFolderIndex = pathSegments.lastIndexOf("test");
		if (testFolderIndex !== -1)
			pathSegments[testFolderIndex] = "lib";

		// Remove _test from the filename.
		pathSegments[pathSegments.length - 1] = pathSegments[pathSegments.length - 1].replace(/_test\.dart/, ".dart");

		return pathSegments.join(path.sep);
	}

	private getTestFileForImplementation(filePath: string) {
		const pathSegments = filePath.split(path.sep);

		// Replace lib folder with test.
		const libFolderIndex = pathSegments.lastIndexOf("lib");
		if (libFolderIndex === -1)
			return undefined;
		pathSegments[libFolderIndex] = "test";

		// Add _test to the filename.
		pathSegments[pathSegments.length - 1] = pathSegments[pathSegments.length - 1].replace(/\.dart/, "_test.dart");

		return pathSegments.join(path.sep);
	}

	protected abstract testForCursor(editor: vs.TextEditor): TestOutlineInfo | undefined;

	public dispose(): any {
		disposeAll(this.disposables);
	}

}

export class DasTestCommands extends TestCommands {
	constructor(logger: Logger, testModel: TestModel, wsContext: WorkspaceContext, vsCodeTestController: VsCodeTestController | undefined, private readonly fileTracker: DasFileTracker, flutterCapabilities: FlutterCapabilities) {
		super(logger, testModel, wsContext, vsCodeTestController, flutterCapabilities);
	}

	protected testForCursor(editor: vs.TextEditor): TestOutlineInfo | undefined {
		const document = editor.document;
		const outline = this.fileTracker.getOutlineFor(document.uri);
		if (!outline || !outline.children || !outline.children.length)
			return;

		// We should only allow running for projects we know can actually handle `pub run` (for ex. the
		// SDK codebase cannot, and will therefore run all tests).
		if (!this.fileTracker.supportsPubRunTest(document.uri))
			return;

		const visitor = new TestOutlineVisitor(this.logger);
		visitor.visit(outline);
		return visitor.tests.reverse().find((t) => {
			let start = document.positionAt(t.offset);
			let end = document.positionAt(t.offset + t.length);

			// Widen the range to start/end of lines.
			start = document.lineAt(start.line).rangeIncludingLineBreak.start;
			end = document.lineAt(end.line).rangeIncludingLineBreak.end;

			return new vs.Range(start, end).contains(editor.selection);
		});
	}
}

export class LspTestCommands extends TestCommands {
	constructor(logger: Logger, testModel: TestModel, wsContext: WorkspaceContext, vsCodeTestController: VsCodeTestController | undefined, private readonly fileTracker: LspFileTracker, flutterCapabilities: FlutterCapabilities) {
		super(logger, testModel, wsContext, vsCodeTestController, flutterCapabilities);
	}

	protected testForCursor(editor: vs.TextEditor): LspTestOutlineInfo | undefined {
		const document = editor.document;
		const outline = this.fileTracker.getOutlineFor(document.uri);
		if (!outline || !outline.children || !outline.children.length)
			return;

		// We should only allow running for projects we know can actually handle `pub run` (for ex. the
		// SDK codebase cannot, and will therefore run all tests).
		if (!this.fileTracker.supportsPubRunTest(document.uri))
			return;

		const visitor = new LspTestOutlineVisitor(this.logger, fsPath(document.uri));
		visitor.visit(outline);
		return visitor.tests.reverse().find((t) => {
			let start = t.range.start;
			let end = t.range.end;

			// Widen the range to start/end of lines.
			start = document.lineAt(start.line).rangeIncludingLineBreak.start;
			end = document.lineAt(end.line).rangeIncludingLineBreak.end;

			const vsRange = new vs.Range(start.line,
				start.character,
				end.line,
				end.character,
			);
			return vsRange.contains(editor.selection);
		});
	}
}
