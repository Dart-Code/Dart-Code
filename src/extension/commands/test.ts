import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { URI } from "vscode-uri";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { noAction } from "../../shared/constants";
import { Logger } from "../../shared/interfaces";
import { GroupNode, SuiteData, SuiteNode, TestModel, TestNode, TreeNode } from "../../shared/test/test_model";
import { getPackageTestCapabilities } from "../../shared/test/version";
import { disposeAll, escapeDartString, generateTestNameFromFileName, uniq } from "../../shared/utils";
import { sortBy } from "../../shared/utils/array";
import { fsPath, isWithinPath, mkDirRecursive } from "../../shared/utils/fs";
import { TestOutlineInfo } from "../../shared/utils/outline_das";
import { TestSelection, createTestFileAction, defaultTestFileContents, getLaunchConfig, getTestSelectionForNodes, getTestSelectionForOutline } from "../../shared/utils/test";
import { getLaunchConfigDefaultTemplate } from "../../shared/vscode/debugger";
import { getAllProjectFolders } from "../../shared/vscode/utils";
import { WorkspaceContext } from "../../shared/workspace";
import { config } from "../config";
import { getActiveRealFileEditor, isDartDocument } from "../editors";
import { locateBestProjectRoot } from "../project";
import { VsCodeTestController } from "../test/vs_test_controller";
import { ensureDebugLaunchUniqueId, getExcludedFolders, isInsideFlutterProject, isInsideFolderNamed, isPathInsideFlutterProject, isTestFile } from "../utils";

const CAN_JUMP_BETWEEN_TEST_IMPLEMENTATION = "dart-code:canGoToTestOrImplementationFile";
// HACK: Used for testing since we can't read contexts?
export let isInTestFileThatHasImplementation = false;
export let isInImplementationFileThatCanHaveTest = false;

export type SuiteList = [SuiteNode, TestSelection[]];

export class TestCommands implements vs.Disposable {
	private disposables: vs.Disposable[] = [];

	constructor(protected readonly logger: Logger, private readonly testModel: TestModel, protected readonly wsContext: WorkspaceContext, private readonly vsCodeTestController: VsCodeTestController | undefined, protected readonly dartCapabilities: DartCapabilities, protected readonly flutterCapabilities: FlutterCapabilities) {
		this.disposables.push(
			vs.commands.registerCommand("_dart.startDebuggingTestFromOutline", (test: TestOutlineInfo, launchTemplate: any | undefined) => this.startTestFromOutline(false, test, launchTemplate)),
			vs.commands.registerCommand("_dart.startWithoutDebuggingTestFromOutline", (test: TestOutlineInfo, launchTemplate: any | undefined) => this.startTestFromOutline(true, test, launchTemplate)),
			vs.commands.registerCommand("_dart.startDebuggingTestsFromVsTestController", (suiteData: SuiteData, treeNodes: Array<SuiteNode | GroupNode | TestNode>, suppressPrompts: boolean, testRun: vs.TestRun | undefined) => this.runTestsForNode(suiteData, treeNodes, true, suppressPrompts, treeNodes.length === 1 && treeNodes[0] instanceof TestNode, undefined, testRun)),
			vs.commands.registerCommand("_dart.startWithoutDebuggingTestsFromVsTestController", (suiteData: SuiteData, treeNodes: Array<SuiteNode | GroupNode | TestNode>, suppressPrompts: boolean, testRun: vs.TestRun | undefined) => this.runTestsForNode(suiteData, treeNodes, false, suppressPrompts, treeNodes.length === 1 && treeNodes[0] instanceof TestNode, undefined, testRun)),
			vs.commands.registerCommand("_dart.runAllTestsWithoutDebugging", (suitesToRun: SuiteNode[] | undefined, nodesToExclude: TestNode[] | undefined, testRun: vs.TestRun | undefined, isRunningAll: boolean) => this.runAllTestsWithoutDebugging(suitesToRun, nodesToExclude, testRun, isRunningAll)),
			vs.commands.registerCommand("dart.goToTests", (resource: vs.Uri | undefined) => this.goToTestOrImplementationFile(resource), this),
			vs.commands.registerCommand("dart.goToTestOrImplementationFile", () => this.goToTestOrImplementationFile(), this),
			vs.commands.registerCommand("dart.findTestOrImplementationFile", () => this.findTestOrImplementationFile(), this),
			vs.window.onDidChangeActiveTextEditor((e) => this.updateEditorContexts(e)),
		);

		// Run for current open editor.
		this.updateEditorContexts(vs.window.activeTextEditor);
	}

	private async runAllTestsWithoutDebugging(suites: SuiteNode[] | undefined, exclusions: TestNode[] | undefined, testRun: vs.TestRun | undefined, isRunningAll: boolean): Promise<void> {
		// To run multiple folders/suites, we can pass the first as `program` and the rest as `args` which
		// will be appended immediately after `program`. However, this only works for things in the same project
		// as the first one that runs will be used for resolving package: URIs etc. We also can't mix and match
		// integration tests with non-integration tests.
		// So, fetch all project folders, then if we have suites in them, group them by that folders (and whether
		// they're integration/non-integration), and otherwise use their 'test'/'integration_test' folders.

		const projectFolders = await getAllProjectFolders(this.logger, getExcludedFolders, { requirePubspec: true, searchDepth: config.projectSearchDepth });
		// Sort folders by length descending so that for any given suite, we know the first one that contains
		// it is the closest parent, so we can avoid running the same test multiple times if it's in a nested
		// project.
		sortBy(projectFolders, (f) => -1 * f.length);

		function closestProjectFolder(suitePath: string) {
			return projectFolders.find((f) => isWithinPath(suitePath, f));
		}

		const projectsWithTests: Array<{ projectFolder: string, name: string, relativeTestPaths: string[] }> = [];
		function addTestItemsForProject(projectFolder: string, integrationTests: boolean) {
			if (!suites)
				return;

			let testPaths = suites
				.map((suite) => suite.suiteData.path)
				.filter((suitePath) => isWithinPath(suitePath, projectFolder))
				.filter((suitePath) => isInsideFolderNamed(suitePath, "integration_test") === integrationTests)
				.filter((suitePath) => closestProjectFolder(suitePath) === projectFolder);

			// If we might be running all, compute if there are any exclusions in this project. If not, we
			// can drop passing all the test names to "dart test" and just run the whole top level folder.
			const hasExclusions = isRunningAll && exclusions?.length && !!exclusions
				.map((node) => node.suiteData.path)
				.filter((suitePath) => isWithinPath(suitePath, projectFolder))
				.filter((suitePath) => isInsideFolderNamed(suitePath, "integration_test") === integrationTests)
				.find((suitePath) => closestProjectFolder(suitePath) === projectFolder);

			if (testPaths.length) {
				const projectName = path.basename(projectFolder);
				const testType = integrationTests ? "Integration Tests" : "Tests";
				const name = `${projectName} ${testType}`;

				// Use relative paths.
				testPaths = testPaths.map((suitePath) => path.relative(projectFolder, suitePath));

				// To avoid making a huge list of suite names that may trigger
				// "The command line is too long" on Windows, if we know we're running them
				// _all_ we can simplify the list of test names to just the top-level folders
				// that contain each.
				if (isRunningAll && !hasExclusions)
					testPaths = uniq(testPaths.map((suitePath) => suitePath.split(path.sep)[0]));

				projectsWithTests.push({ projectFolder, name, relativeTestPaths: testPaths });
			}
		}

		for (const projectFolder of projectFolders) {
			addTestItemsForProject(projectFolder, false);
			addTestItemsForProject(projectFolder, true);
		}

		if (projectsWithTests.length === 0) {
			void vs.window.showErrorMessage("Unable to find any test folders");
			return;
		}

		await Promise.all(
			projectsWithTests.map((projectWithTests) => this.runTests({
				debug: false,
				isFlutter: undefined, // unknown, runTests will compute
				launchTemplate: {
					args: projectWithTests.relativeTestPaths.slice(1),
					cwd: projectWithTests.projectFolder,
					name: projectWithTests.name,
				},
				programPath: path.join(projectWithTests.projectFolder, projectWithTests.relativeTestPaths[0]),
				shouldRunSkippedTests: false,
				suppressPrompts: suites?.length !== 1,
				testRun,
				testSelection: undefined,
				token: undefined,
				useLaunchJsonTestTemplate: true,
			}))
		);
	}

	private async runTestsForNode(suiteData: SuiteData, nodes: TreeNode[], debug: boolean, suppressPrompts: boolean, runSkippedTests: boolean, token?: vs.CancellationToken, testRun?: vs.TestRun) {
		const testSelection = getTestSelectionForNodes(nodes);
		const programPath = fsPath(URI.file(suiteData.path));
		const isFlutter = isInsideFlutterProject(vs.Uri.file(suiteData.path));
		const canRunSkippedTest = this.flutterCapabilities.supportsRunSkippedTests || !isFlutter;
		const shouldRunSkippedTests = runSkippedTests && canRunSkippedTest;

		return this.runTests({
			debug,
			isFlutter,
			launchTemplate: undefined,
			programPath,
			shouldRunSkippedTests,
			suppressPrompts,
			testRun,
			testSelection,
			token,
			useLaunchJsonTestTemplate: true,
		});
	}

	private async runTests({ programPath, debug, testSelection, shouldRunSkippedTests, suppressPrompts, launchTemplate, testRun, token, useLaunchJsonTestTemplate, isFlutter }: TestLaunchInfo): Promise<boolean> {
		if (useLaunchJsonTestTemplate) {
			// Get the default Run/Debug template for running/debugging tests and use that as a base.
			const template = getLaunchConfigDefaultTemplate(vs.Uri.file(programPath), debug);
			if (template)
				launchTemplate = Object.assign({}, template, launchTemplate);
		}

		let shouldRunTestsByLine = false;
		// Determine wheher we can and should run tests by line number.
		if (testSelection?.length && config.testInvocationMode === "line") {
			isFlutter = isFlutter ?? isPathInsideFlutterProject(programPath);
			if (isFlutter) {
				shouldRunTestsByLine = this.flutterCapabilities.supportsRunTestsByLine;
			} else {
				const projectFolderPath = locateBestProjectRoot(programPath);
				if (projectFolderPath) {
					const testCapabilities = await getPackageTestCapabilities(this.logger, this.wsContext, projectFolderPath);
					if (testCapabilities.supportsRunTestsByLine) {
						shouldRunTestsByLine = true;
					}
				}
			}
		}

		const subs: vs.Disposable[] = [];
		return new Promise<boolean>(async (resolve, reject) => {
			let testsName = path.basename(programPath);
			// Handle when running whole test folder.
			if (testsName === "test")
				testsName = path.basename(path.dirname(programPath));
			const launchConfiguration = {
				suppressPrompts,
				...getLaunchConfig(
					!debug,
					programPath,
					testSelection,
					shouldRunTestsByLine,
					shouldRunSkippedTests,
					launchTemplate,
				),
				name: launchTemplate?.name ?? `${path.basename(programPath)} tests`,
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
			if (!didStart) {
				// Failures to start will trigger their own messages (from debug_config_provider) so we
				// should not reject() here, as VS Code will show an additional (less helpful) error
				// message.
				resolve(false);

			}
		}).finally(() => {
			disposeAll(subs);
		});
	}

	private startTestFromOutline(noDebug: boolean, test: TestOutlineInfo, launchTemplate: any | undefined) {
		const isFlutter = isInsideFlutterProject(vs.Uri.file(test.file));
		const canRunSkippedTest = (this.flutterCapabilities.supportsRunSkippedTests || !isFlutter);
		const shouldRunSkippedTests = canRunSkippedTest; // These are the same when running directly, since we always run skipped.

		return this.runTests({
			debug: !noDebug,
			isFlutter,
			launchTemplate,
			programPath: test.file,
			shouldRunSkippedTests,
			suppressPrompts: false,
			testRun: undefined,
			testSelection: [getTestSelectionForOutline(test)],
			token: undefined,
		});
	}

	private async goToTestOrImplementationFile(resource?: vs.Uri): Promise<void> {
		return this.locateTestOrImplementationFile(resource);
	}

	private async findTestOrImplementationFile(): Promise<void> {
		return this.locateTestOrImplementationFile(undefined, { showFindDialogIfNoMatches: true });
	}

	private async locateTestOrImplementationFile(resource?: vs.Uri, { showFindDialogIfNoMatches }: { showFindDialogIfNoMatches?: boolean } = {}): Promise<void> {
		const doc = resource
			? await vs.workspace.openTextDocument(resource)
			: getActiveRealFileEditor()?.document;
		if (!doc || !isDartDocument(doc))
			return;

		const filePath = fsPath(doc.uri);
		const isTest = isTestFile(filePath);
		const candidateFiles = isTest
			? this.getCandidateImplementationFiles(filePath)
			: this.getCandidateTestFiles(filePath);

		let otherExistingFile = candidateFiles.find(fs.existsSync);
		const otherFile = otherExistingFile ?? (candidateFiles.length ? candidateFiles[0] : undefined);

		// If no match and we want to search, search...
		if (!otherExistingFile && showFindDialogIfNoMatches)
			return this.showSearchResults(filePath, isTest);

		let selectionOffset: number | undefined;
		let selectionLength: number | undefined;

		// Offer to create files.
		if (!otherExistingFile && otherFile) {
			// But not if we're a test... we can create test files, but not implementations.
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

			otherExistingFile = otherFile;
			mkDirRecursive(path.dirname(otherExistingFile));
			const testFileInfo = defaultTestFileContents(this.wsContext.hasAnyFlutterProjects, escapeDartString(generateTestNameFromFileName(relativePath)));
			fs.writeFileSync(otherExistingFile, testFileInfo.contents);

			selectionOffset = testFileInfo.selectionOffset;
			selectionLength = testFileInfo.selectionLength;
		}

		const document = await vs.workspace.openTextDocument(otherExistingFile!);
		const editor = await vs.window.showTextDocument(document);

		if (selectionOffset && selectionLength)
			editor.selection = new vs.Selection(document.positionAt(selectionOffset), document.positionAt(selectionOffset + selectionLength));
	}

	private showSearchResults(filePath: string, isTest: boolean) {
		const sourceFileBaseName = path.parse(filePath).name;
		const targetFileBaseName = isTest
			? (sourceFileBaseName.endsWith("_test") ? sourceFileBaseName.substring(0, sourceFileBaseName.length - "_test".length) : sourceFileBaseName)
			: `${sourceFileBaseName}_test`;
		void vs.commands.executeCommand("workbench.action.quickOpen", `${targetFileBaseName}.dart`);
	}

	private updateEditorContexts(e: vs.TextEditor | undefined): void {
		isInTestFileThatHasImplementation = false;
		isInImplementationFileThatCanHaveTest = false;

		if (e && e.document && isDartDocument(e.document)) {
			const filePath = fsPath(e.document.uri);
			if (isTestFile(filePath)) {
				// Implementation files must exist.
				const implementationFilePath = this.getCandidateImplementationFiles(filePath).find(fs.existsSync);
				isInTestFileThatHasImplementation = !!implementationFilePath && fs.existsSync(implementationFilePath);
			} else {
				isInImplementationFileThatCanHaveTest = this.getCandidateTestFiles(filePath).length > 0;
			}
		}

		void vs.commands.executeCommand("setContext", CAN_JUMP_BETWEEN_TEST_IMPLEMENTATION, isInTestFileThatHasImplementation || isInImplementationFileThatCanHaveTest);
	}

	private getCandidateImplementationFiles(filePath: string): string[] {
		const candidates: string[] = [];

		const pathSegments = filePath.split(path.sep);
		const testFolderIndex = pathSegments.lastIndexOf("test");

		// Remove _test from the filename.
		pathSegments[pathSegments.length - 1] = pathSegments[pathSegments.length - 1].replace(/_test\.dart/, ".dart");

		// Add a copy with test -> lib
		if (testFolderIndex !== -1) {
			const temp = [...pathSegments];
			temp[testFolderIndex] = "lib";
			candidates.push(temp.join(path.sep));

			// Also add a copy with test -> lib/src to match what we do the other way
			temp.splice(testFolderIndex + 1, 0, "src");
			candidates.push(temp.join(path.sep));
		}

		// Add the original path to support files alongside.
		candidates.push(pathSegments.join(path.sep));

		return candidates;
	}

	private getCandidateTestFiles(filePath: string): string[] {
		const candidates: string[] = [];

		const pathSegments = filePath.split(path.sep);
		const libFolderIndex = pathSegments.lastIndexOf("lib");

		// Add _test to the filename.
		pathSegments[pathSegments.length - 1] = pathSegments[pathSegments.length - 1].replace(/\.dart/, "_test.dart");

		// Add a copy with lib -> test
		if (libFolderIndex !== -1) {
			const temp = [...pathSegments];
			temp[libFolderIndex] = "test";
			candidates.push(temp.join(path.sep));

			// If we're in lib/src, also add a copy in the corresponding test folder without
			// the src/ since sometimes src/ is omitted in the test paths.
			if (temp[libFolderIndex + 1] === "src") {
				temp.splice(libFolderIndex + 1, 1);
				candidates.push(temp.join(path.sep));
			}
		}

		// Add the original path to support files alongside.
		candidates.push(pathSegments.join(path.sep));

		return candidates;
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

interface TestLaunchInfo {
	programPath: string;
	isFlutter: boolean | undefined;
	debug: boolean;
	testSelection: TestSelection[] | undefined;
	shouldRunSkippedTests: boolean;
	suppressPrompts: boolean;
	launchTemplate: any | undefined;
	useLaunchJsonTestTemplate?: boolean;
	testRun: vs.TestRun | undefined;
	token: vs.CancellationToken | undefined;
}
