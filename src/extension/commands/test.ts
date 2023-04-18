import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { noAction } from "../../shared/constants";
import { DartSdks, Logger } from "../../shared/interfaces";
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
			vs.commands.registerCommand("_dart.runAllTestsWithoutDebugging", (suites: SuiteNode[] | undefined, testRun: vs.TestRun | undefined, isRunningAll: boolean) => this.runAllTestsWithoutDebugging(suites, testRun, isRunningAll)),
			vs.commands.registerCommand("dart.goToTests", (resource: vs.Uri | undefined) => this.goToTestOrImplementationFile(resource), this),
			vs.commands.registerCommand("dart.goToTestOrImplementationFile", () => this.goToTestOrImplementationFile(), this),
			vs.window.onDidChangeActiveTextEditor((e) => this.updateEditorContexts(e)),
		);

		// Run for current open editor.
		this.updateEditorContexts(vs.window.activeTextEditor);
	}

	private async runAllTestsWithoutDebugging(suites: SuiteNode[] | undefined, testRun: vs.TestRun | undefined, isRunningAll: boolean): Promise<void> {
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

		const projectsWithTests: Array<{ projectFolder: string, name: string, tests: string[] }> = [];
		function addTestItemsForProject(projectFolder: string, integrationTests: boolean) {
			if (!suites)
				return;

			let testPaths = suites
				.map((suite) => suite.suiteData.path)
				.filter((suitePath) => isWithinPath(suitePath, projectFolder))
				.filter((suitePath) => isInsideFolderNamed(suitePath, "integration_test") === integrationTests)
				.filter((suitePath) => closestProjectFolder(suitePath) === projectFolder);


			if (testPaths.length) {
				const projectName = path.basename(projectFolder);
				const testType = integrationTests ? "Integration Tests" : "Tests";
				const name = `${projectName} ${testType}`;

				// To avoid making a huge list of suite names that may trigger
				// "The command line is too long" on Windows, if we know we're running them
				// _all_ we can simplify the list of test names to just the top-level folders
				// that contain each.
				if (isRunningAll)
					testPaths = uniq(testPaths.map((suitePath) => path.relative(projectFolder, suitePath).split(path.sep)[0]));

				projectsWithTests.push({ projectFolder, name, tests: testPaths });
			}
		}

		for (const projectFolder of projectFolders) {
			addTestItemsForProject(projectFolder, false);
			addTestItemsForProject(projectFolder, true);
		}

		if (projectsWithTests.length === 0) {
			vs.window.showErrorMessage("Unable to find any test folders");
			return;
		}

		await Promise.all(
			projectsWithTests.map((projectWithTests) => this.runTests({
				debug: false,
				isFlutter: undefined, // unknown, runTests will compute
				launchTemplate: {
					args: projectWithTests.tests.slice(1),
					cwd: projectWithTests.projectFolder,
					name: projectWithTests.name,
				},
				programPath: projectWithTests.tests[0],
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
		const programPath = fsPath(suiteData.path);
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
					const testCapabilities = await getPackageTestCapabilities(this.logger, this.wsContext.sdks as DartSdks, projectFolderPath);
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
		const canRunSkippedTest = !test.isGroup && (this.flutterCapabilities.supportsRunSkippedTests || !isFlutter);
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
		const doc = resource
			? await vs.workspace.openTextDocument(resource)
			: getActiveRealFileEditor()?.document;
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
