import { strict as assert } from "assert";
import * as fs from "fs";
import * as os from "os";
import { tmpdir } from "os";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { URI } from "vscode-uri";
import { dartCodeExtensionIdentifier, isDartCodeTestRun, isWin } from "../shared/constants";
import { DartLaunchArgs } from "../shared/debug/interfaces";
import { LogCategory, TestStatus } from "../shared/enums";
import { IAmDisposable, Logger } from "../shared/interfaces";
import { captureLogs } from "../shared/logging";
import { internalApiSymbol } from "../shared/symbols";
import { TestNode } from "../shared/test/test_model";
import { TestDoneNotification } from "../shared/test_protocol";
import { BufferedLogger, filenameSafe, flatMap, withTimeout } from "../shared/utils";
import { arrayContainsArray, sortBy } from "../shared/utils/array";
import { createFolderForFile, fsPath, getRandomInt, tryDeleteFile } from "../shared/utils/fs";
import { resolvedPromise, waitFor } from "../shared/utils/promises";
import { getProgramString } from "../shared/utils/test";
import { InternalExtensionApi } from "../shared/vscode/interfaces";
import { SourceSortMembersCodeActionKind, treeLabel } from "../shared/vscode/utils";
import { Context } from "../shared/vscode/workspace";
// eslint-disable-next-line no-restricted-imports
import { PublicDartExtensionApi } from "../extension/api/interfaces";

export const ext = vs.extensions.getExtension(dartCodeExtensionIdentifier)!;
export let privateApi: InternalExtensionApi;
export let extApi: PublicDartExtensionApi;
export let logger: Logger = new BufferedLogger();
export const threeMinutesInMilliseconds = 1000 * 60 * 3;
export const fakeCancellationToken: vs.CancellationToken = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose: () => undefined }),
};
export const customScriptExt = isWin ? "bat" : "sh";

if (!ext) {
	logger.error("Quitting with error because extension failed to load.");
	process.exit(1);
}

const testFolder = path.join(ext.extensionPath, "src/test");
export const testProjectsFolder = path.join(testFolder, "test_projects");

const packageConfigPath = ".dart_tool/package_config.json";

// Dart
export const helloWorldFolder = vs.Uri.file(path.join(testProjectsFolder, "hello_world"));
export const helloWorldPackageConfigFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), packageConfigPath));
export const helloWorldMainFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/main.dart"));
export const helloWorldDotDartCodeFolder = vs.Uri.file(path.join(fsPath(helloWorldFolder), ".dart_code"));
export const helloWorldAutoLaunchFile = vs.Uri.file(path.join(fsPath(helloWorldDotDartCodeFolder), "autolaunch.json"));
export const helloWorldInspectionFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/inspect.dart"));
export const helloWorldLongRunningFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/long_running.dart"));
export const helloWorldMainLibFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/basic.dart"));
export const helloWorldDeferredEntryFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/deferred_entry.dart"));
export const helloWorldPartEntryFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/part.dart"));
export const helloWorldPubspec = vs.Uri.file(path.join(fsPath(helloWorldFolder), "pubspec.yaml"));
export const helloWorldStack60File = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/stack60.dart"));
export const helloWorldGettersFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/getters.dart"));
export const helloWorldBrokenFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/broken.dart"));
export const helloWorldAssertFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/assert.dart"));
export const helloWorldThrowInSdkFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/throw_in_sdk_code.dart"));
export const helloWorldThrowInExternalPackageFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/throw_in_external_package.dart"));
export const helloWorldThrowInLocalPackageFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/throw_in_local_package.dart"));
export const helloWorldGoodbyeFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/goodbye.dart"));
export const helloWorldHttpFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/http.dart"));
export const helloWorldLocalPackageFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/local_package.dart"));
export const helloWorldCreateMethodClassAFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/create_method/class_a.dart"));
export const helloWorldCreateMethodClassBFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/create_method/class_b.dart"));
export const helloWorldExampleSubFolder = vs.Uri.file(path.join(fsPath(helloWorldFolder), "example"));
export const helloWorldExampleSubFolderMainFile = vs.Uri.file(path.join(fsPath(helloWorldExampleSubFolder), "bin/main.dart"));
export const helloWorldExampleSubFolderPubspecFile = vs.Uri.file(path.join(fsPath(helloWorldExampleSubFolder), "pubspec.yaml"));
export const emptyFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/empty.dart"));
export const missingFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/missing.dart"));
export const emptyFileInExcludedBySettingFolder = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/excluded_by_setting/empty.dart"));
export const helloWorldCompletionFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/completion.dart"));
export const helloWorldDeferredScriptFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/deferred_script.dart"));
export const helloWorldPartWrapperFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/part_wrapper.dart"));
export const helloWorldPartFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/part.dart"));
export const everythingFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/everything.dart"));
// Package
export const myPackageFolder = vs.Uri.file(path.join(testProjectsFolder, "my_package"));
export const myPackageThingFile = vs.Uri.file(path.join(fsPath(myPackageFolder), "lib/my_thing.dart"));
// Dart tests
export const helloWorldTestFolder = vs.Uri.file(path.join(fsPath(helloWorldFolder), "test"));
export const helloWorldTestMainFile = vs.Uri.file(path.join(fsPath(helloWorldTestFolder), "basic_test.dart"));
export const helloWorldTestEmptyFile = vs.Uri.file(path.join(fsPath(helloWorldTestFolder), "empty_test.dart"));
export const helloWorldRenameTestFile = vs.Uri.file(path.join(fsPath(helloWorldTestFolder), "rename_test.dart"));
export const helloWorldTestTreeFile = vs.Uri.file(path.join(fsPath(helloWorldTestFolder), "tree_test.dart"));
export const helloWorldTestEnvironmentFile = vs.Uri.file(path.join(fsPath(helloWorldTestFolder), "environment_test.dart"));
export const helloWorldTestShortFile = vs.Uri.file(path.join(fsPath(helloWorldTestFolder), "short_test.dart"));
export const helloWorldTestSelective1File = vs.Uri.file(path.join(fsPath(helloWorldTestFolder), "selective1_test.dart"));
export const helloWorldTestSelective2File = vs.Uri.file(path.join(fsPath(helloWorldTestFolder), "selective2_test.dart"));
export const helloWorldTestDiscoveryFile = vs.Uri.file(path.join(fsPath(helloWorldTestFolder), "discovery_test.dart"));
export const helloWorldTestDiscoveryLargeFile = vs.Uri.file(path.join(fsPath(helloWorldTestFolder), "discovery_large_test.dart"));
export const helloWorldTestDupeNameFile = vs.Uri.file(path.join(fsPath(helloWorldTestFolder), "dupe_name_test.dart"));
export const helloWorldTestBrokenFile = vs.Uri.file(path.join(fsPath(helloWorldTestFolder), "broken_test.dart"));
export const helloWorldTestDynamicFile = vs.Uri.file(path.join(fsPath(helloWorldTestFolder), "dynamic_test.dart"));
export const helloWorldProjectTestFile = vs.Uri.file(path.join(fsPath(helloWorldTestFolder), "project_test.dart"));
export const helloWorldExampleSubFolderProjectTestFile = vs.Uri.file(path.join(fsPath(helloWorldExampleSubFolder), "test", "project_test.dart"));
// Go To Tests
export const helloWorldGoToLibFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/goto/foo.dart"));
export const helloWorldGoToLibSrcFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/src/goto/foo.dart"));
export const helloWorldGoToTestFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "test/goto/foo_test.dart"));
export const helloWorldGoToTestSrcFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "test/src/goto/foo_test.dart"));
// Nested
export const dartNestedFolder = vs.Uri.file(path.join(testProjectsFolder, "dart_nested"));
export const dartNested1Folder = vs.Uri.file(path.join(fsPath(dartNestedFolder), "nested1"));
export const dartNested1PubspecFile = vs.Uri.file(path.join(fsPath(dartNested1Folder), "pubspec.yaml"));
export const dartNested2Folder = vs.Uri.file(path.join(fsPath(dartNested1Folder), "nested2"));
// Flutter
export const flutterHelloWorldFolder = vs.Uri.file(path.join(testProjectsFolder, "flutter_hello_world"));
export const flutterEmptyFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/empty.dart"));
export const flutterHelloWorldPackageConfigFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), packageConfigPath));
export const flutterHelloWorldMainFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/main.dart"));
export const flutterHelloWorldReadmeFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "README.md"));
export const flutterHelloWorldNavigateFromFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/navigate_from.dart"));
export const flutterHelloWorldNavigateToFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/navigate_to.dart"));
export const flutterHelloWorldPubspec = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "pubspec.yaml"));
export const flutterHelloWorldCounterAppFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/counter.dart"));
export const flutterHelloWorldOutlineFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/outline.dart"));
export const flutterHelloWorldBrokenFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/broken.dart"));
export const flutterHelloWorldHttpFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/http.dart"));
export const flutterHelloWorldGettersFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/getters.dart"));
export const flutterHelloWorldLocalPackageFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/local_package.dart"));
export const flutterHelloWorldThrowInSdkFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/throw_in_sdk_code.dart"));
export const flutterHelloWorldThrowInExternalPackageFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/throw_in_external_package.dart"));
export const flutterHelloWorldThrowInLocalPackageFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/throw_in_local_package.dart"));
export const flutterHelloWorldStack60File = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/stack60.dart"));
export const flutterHelloWorldPrinterFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/printer.dart"));
// Flutter example
const flutterHelloWorldExampleFolder = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "example"));
export const flutterHelloWorldExamplePrinterFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldExampleFolder), "lib/printer.dart"));
export const flutterHelloWorldExampleTestFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldExampleFolder), "test/printer_test.dart"));
// Flutter Bazel
export const flutterBazelRoot = vs.Uri.file(path.join(testProjectsFolder, "bazel_workspace"));
export const flutterBazelHelloWorldFolder = vs.Uri.file(path.join(fsPath(flutterBazelRoot), "flutter_hello_world_bazel"));
export const flutterBazelHelloWorldMainFile = vs.Uri.file(path.join(fsPath(flutterBazelHelloWorldFolder), "lib/main.dart"));
export const flutterBazelTestMainFile = vs.Uri.file(path.join(fsPath(flutterBazelHelloWorldFolder), "test/widget_test.dart"));
// Flutter tests
export const flutterTestMainFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test/widget_test.dart"));
export const flutterTestSelective1File = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test/selective1_test.dart"));
export const flutterTestSelective2File = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test/selective2_test.dart"));
export const flutterTestOtherFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test/other_test.dart"));
export const flutterTestAnotherFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test/another_test.dart"));
export const flutterTestBrokenFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test/broken_test.dart"));
export const flutterTestDriverAppFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test_driver/app.dart"));
export const flutterTestDriverTestFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test_driver/app_test.dart"));
export const flutterIntegrationTestFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "integration_test/app_test.dart"));
// Web
export const webProjectContainerFolder = vs.Uri.file(path.join(testProjectsFolder, "web"));
export const webHelloWorldFolder = vs.Uri.file(path.join(fsPath(webProjectContainerFolder), "hello_world"));
export const webHelloWorldMainFile = vs.Uri.file(path.join(fsPath(webHelloWorldFolder), "web/main.dart"));
export const webHelloWorldIndexFile = vs.Uri.file(path.join(fsPath(webHelloWorldFolder), "web/index.html"));
export const webHelloWorldExampleSubFolder = vs.Uri.file(path.join(fsPath(webHelloWorldFolder), "example"));
export const webHelloWorldExampleSubFolderIndexFile = vs.Uri.file(path.join(fsPath(webHelloWorldExampleSubFolder), "web/index.html"));
const webBrokenFolder = vs.Uri.file(path.join(fsPath(webProjectContainerFolder), "broken"));
export const webBrokenIndexFile = vs.Uri.file(path.join(fsPath(webBrokenFolder), "web/index.html"));
export const webBrokenMainFile = vs.Uri.file(path.join(fsPath(webBrokenFolder), "web/main.dart"));

export const flutterTestSurveyID = "flutterVsCodeTestSurvey";

const startOfDocument = new vs.Range(new vs.Position(0, 0), new vs.Position(0, 0));

export function currentEditor(): vs.TextEditor {
	let editor = vs.window.activeTextEditor;
	if (!editor || editor.document.uri.scheme !== "file") {
		const firstEditor = vs.window.visibleTextEditors.find((e) => e.document.uri.scheme === "file");
		if (firstEditor)
			logger.info(`Current active editor is not a file (${editor ? editor.document.uri : "none"}) so using first visible editor (${firstEditor.document.uri})`);
		editor = firstEditor;
	}

	if (!editor)
		throw new Error("There is no active or visible editor");

	return editor;
}
export function currentDoc(): vs.TextDocument {
	return currentEditor().document;
}

export let documentEol: string;

function getDefaultFile(): vs.Uri {
	// TODO: Web?
	if (privateApi.workspaceContext.hasAnyFlutterProjects)
		return flutterEmptyFile;
	else
		return emptyFile;
}

export async function activateWithoutAnalysis(): Promise<void> {
	if (!ext.isActive)
		await ext.activate();
	if (ext.exports) {
		privateApi = ext.exports[internalApiSymbol] as InternalExtensionApi;
		extApi = ext.exports as PublicDartExtensionApi;
		setupTestLogging();
	} else {
		console.warn("Extension has no exports, it probably has not activated correctly! Check the extension startup logs.");
	}
}

export function attachLoggingWhenExtensionAvailable(attempt = 1) {
	if (logger && !(logger instanceof BufferedLogger)) {
		console.warn("Logging was already set up!");
		return;
	}

	if (setupTestLogging()) {
		// console.log("Logging was configured!");
		return;
	}

	if (attempt < 50) {
		setTimeout(() => attachLoggingWhenExtensionAvailable(attempt + 1), 100);
	} else {
		console.warn(`Failed to set up logging after ${attempt} attempts`);
	}
}

function setupTestLogging(): boolean {
	const ext = vs.extensions.getExtension(dartCodeExtensionIdentifier)!;
	if (!ext.isActive || !ext.exports)
		return false;

	privateApi = ext.exports[internalApiSymbol] as InternalExtensionApi;
	extApi = ext.exports as PublicDartExtensionApi;
	const emittingLogger = privateApi.logger;

	if (fileSafeCurrentTestName) {
		const logFolder = process.env.DC_TEST_LOGS || path.join(ext.extensionPath, ".dart_code_test_logs");
		if (!fs.existsSync(logFolder))
			fs.mkdirSync(logFolder);
		const logFile = fileSafeCurrentTestName + ".txt";
		const logPath = path.join(logFolder, logFile);

		// For debugger tests, the analyzer log is just noise, so we filter it out.
		const excludeLogCategories = process.env.BOT?.includes("debug")
			? [LogCategory.Analyzer]
			: [];
		const testLogger = captureLogs(emittingLogger, logPath, privateApi.getLogHeader(), 20000, excludeLogCategories, true);

		deferUntilLast("Remove log file if test passed", async (testResult?: "passed" | "failed" | "pending") => {
			// Put a new buffered logger back to capture any logging output happening
			// after we closed our log file to be included in the next.
			logger = new BufferedLogger();

			// Wait a little before closing, to ensure we capture anything in-progress.
			await delay(100);
			await testLogger.dispose();
			// On CI, we delete logs for passing tests to save space.
			if (process.env.CI && testResult === "passed") {
				try {
					fs.unlinkSync(logPath);
				} catch { }
			}
		});
	}

	if (logger && logger instanceof BufferedLogger)
		logger.flushTo(emittingLogger);
	logger = emittingLogger;

	return true;
}

export async function activate(file?: vs.Uri | null): Promise<void> {
	await activateWithoutAnalysis();
	if (file === undefined) // undefined means use default, but explicit null will result in no file open.
		file = getDefaultFile();

	await closeAllOpenFiles();
	if (file) {
		await openFile(file);
	} else {
		logger.info(`Not opening any file`);
	}
	logger.info(`Waiting for initial analysis`);
	await privateApi.initialAnalysis;
	// Opening a file above may start analysis after a short period so give it time to start
	// before we continue.
	await delay(50);
	logger.info(`Waiting for in-progress analysis`);
	await privateApi.currentAnalysis();

	logger.info(`Ready to start test`);
	const cpuLoad = os.loadavg();
	const totalMem = os.totalmem();
	const freeMem = os.freemem();
	logger.info(`  cpuLoad: ${cpuLoad}`);
	logger.info(`  totalMem: ${totalMem}`);
	logger.info(`  freeMem: ${freeMem}`);
	logger.info(`  ${Math.round((freeMem / totalMem) * 100)}% memory is available`);
}

export async function getPackages(uri?: vs.Uri) {
	await activateWithoutAnalysis();
	if (!(uri || (vs.workspace.workspaceFolders?.length))) {
		logger.error("Cannot getPackages because there is no workspace folder and no URI was supplied");
		return;
	}
	// It's not guaranteed that this will trigger new analysis, because we might already have all packages
	// up-to-date, so just wait a bit.
	await vs.commands.executeCommand("dart.getPackages", uri || vs.workspace.workspaceFolders![0].uri);
	await delay(100);
}

function logOpenEditors() {
	logger.info(`Current open editors are:`);
	if (vs.window.visibleTextEditors?.length) {
		for (const editor of vs.window.visibleTextEditors) {
			logger.info(`  - ${editor.document.uri}`);
		}
	} else {
		logger.info(`  - (no open editors)`);
	}
}

export function captureOutput(name: string) {
	// Create a channel that buffers its output.
	const buffer: string[] = [];
	const channel = privateApi.getOutputChannel(name);

	sb.stub(channel, "append").callsFake((s: string) => buffer.push(s));
	sb.stub(channel, "appendLine").callsFake((s: string) => buffer.push(`${s}\n`));

	return buffer;
}

export function stubCreateInputBox(valueToReturn: string) {
	const result = {
		promptedValue: undefined as string | undefined,
	};
	const createInputBox = sb.stub(vs.window, "createInputBox");
	createInputBox.callsFake(function (this: any, ...args) {
		// Call the underlying VS Code method to create the input box.
		const input = (createInputBox as any).wrappedMethod.apply(this, args) as vs.InputBox;

		// Capture the onDidAccept method to capture the callback.
		let acceptCallback: () => void;
		sb.stub(input, "onDidAccept").callsFake((func: () => void) => acceptCallback = func);

		// Capture the show method to then call that callback with our fake answer.
		// Also stash the original value so we can check it was pre-populated correctly.
		sb.stub(input, "show").callsFake(() => {
			result.promptedValue = input.value;
			input.value = valueToReturn;
			setImmediate(() => acceptCallback());
		});
		return input;
	});
	return result;
}

export async function closeAllOpenFiles(): Promise<void> {
	logger.info(`Reverting current editor...`);
	await vs.commands.executeCommand("workbench.action.files.revert");
	logger.info(`Closing all open editors...`);
	logOpenEditors();
	try {
		await withTimeout(
			vs.commands.executeCommand("workbench.action.closeAllEditors"),
			"closeAllEditors all editors did not complete",
			10,
		);
	} catch (e) {
		logger.warn(e);
	}
	await delay(50);
	logger.info(`Done closing editors!`);
	logOpenEditors();
}

export async function clearTestTree(): Promise<void> {
	logger.info(`Clearing test tree...`);
	privateApi.testModel.suites.clear();
	privateApi.testModel.updateNode();
	await delay(50); // Allow tree to be updated.
	if (privateApi.testDiscoverer)
		privateApi.testDiscoverer.testDiscoveryPerformed = undefined;
	logger.info(`Done clearing test tree!`);
}

export async function waitUntilAllTextDocumentsAreClosed(): Promise<void> {
	logger.info(`Waiting for VS Code to mark all documents as closed...`);
	const getAllOpenDocs = () => vs.workspace.textDocuments.filter((td) => !td.isUntitled && td.uri.scheme === "file");
	await waitForResult(() => getAllOpenDocs().length === 0, "Some TextDocuments did not close", threeMinutesInMilliseconds, false);
	const openDocs = getAllOpenDocs();
	if (openDocs.length) {
		throw new Error(`All open files were not closed (for ex: ${fsPath(openDocs[0].uri)})`);
	}
}

export async function closeFile(file: vs.Uri): Promise<void> {
	for (const editor of vs.window.visibleTextEditors) {
		if (fsPath(editor.document.uri) === fsPath(file)) {
			console.log(`Closing visible editor ${editor.document.uri}...`);
			await vs.window.showTextDocument(editor.document);
			await vs.commands.executeCommand("workbench.action.closeActiveEditor");
		}
	}
}

export async function openFile(file: vs.Uri, column?: vs.ViewColumn): Promise<vs.TextEditor> {
	logger.info(`Opening ${fsPath(file)}`);
	const doc = await vs.workspace.openTextDocument(file);
	documentEol = doc.eol === vs.EndOfLine.CRLF ? "\r\n" : "\n";
	logger.info(`Showing ${fsPath(file)}`);
	try {
		return await vs.window.showTextDocument(doc, { viewColumn: column, preview: false });
	} catch (e) {
		logger.warn(`Failed to show ${fsPath(file)} on first attempt, trying again...`, LogCategory.CI);
		logger.warn(e, LogCategory.CI);
		return await vs.window.showTextDocument(doc, { viewColumn: column, preview: false });
	} finally {
		await delay(50);
	}
}

export function tryDelete(file: vs.Uri) {
	tryDeleteFile(fsPath(file));
}

export function tryDeleteDirectoryRecursive(folder: string) {
	if (!fs.existsSync(folder))
		return;
	if (!fs.statSync(folder).isDirectory()) {
		logger.error(`deleteDirectoryRecursive was passed a file: ${folder}`);
	}
	fs.readdirSync(folder)
		.map((item) => path.join(folder, item))
		.forEach((item) => {
			if (fs.statSync(item).isDirectory()) {
				tryDeleteDirectoryRecursive(item);
			} else
				tryDeleteFile(item);
		});
	fs.rmdirSync(folder);
}

export let currentTestName = "unknown";
export let fileSafeCurrentTestName = "unknown";
beforeEach("stash current test name", function () {
	currentTestName = this.currentTest ? this.currentTest.fullTitle() : "unknown";
	fileSafeCurrentTestName = filenameSafe(currentTestName);
	if (fileSafeCurrentTestName.length >= 100) {
		fileSafeCurrentTestName = fileSafeCurrentTestName.substring(0, 100) + getRandomInt(1000, 10000);
	}

	deferUntilLast("Reset current test name", () => fileSafeCurrentTestName = "unknown");
});

export let sb: sinon.SinonSandbox;
beforeEach("create sinon sandbox", () => {
	if (logger)
		logger.info(`Creating sinon sandbox`);
	sb = sinon.createSandbox();
});

before("throw if isDartCodeTestRun is false", () => {
	if (!isDartCodeTestRun)
		throw new Error("DART_CODE_IS_TEST_RUN env var should be set for test runs.");
});

afterEach("wait for any debug sessions to end", async () => {
	// Wait up to 2s for any active debug sessions to end, as some tests may end earlier and
	// there may still be ingoing events firing.
	await waitFor(() => vs.debug.activeDebugSession === undefined, 100, 2000);
});

interface DeferredFunction {
	callback: (result?: "failed" | "passed" | "pending") => Promise<any> | any;
	description: string;
}

const deferredItems: DeferredFunction[] = [];
const deferredToLastItems: DeferredFunction[] = [];
afterEach("run deferred functions", async function () {
	logger.info(`Running deferred functions!`);
	let firstError: Error | undefined;
	for (const deferredFunction of [...deferredItems.reverse(), ...deferredToLastItems.reverse()]) {
		const description = deferredFunction.description;
		const callback = deferredFunction.callback;
		logger.info(`Running deferred function ${description}`);
		try {
			await watchPromise(`afterEach->deferred->${description}`, callback(this.currentTest ? this.currentTest.state : undefined));
		} catch (e) {
			logger.error(`Error running deferred function ${description}: ${e}`);
			if (!firstError)
				firstError = e instanceof Error ? e : new Error(`${e}`);
		}
		logger.info(`    done!`);
	}
	deferredItems.length = 0;
	deferredToLastItems.length = 0;
	// We delay throwing until the end so that other cleanup can run
	if (firstError)
		throw firstError;
	logger.info(`Done running deferred functions!`);
});
export function defer(description: string, callback: (result?: "failed" | "passed" | "pending") => Promise<any> | any): void {
	deferredItems.push({ description: `${description} (${currentTestName})`, callback });
}
export function deferUntilLast(description: string, callback: (result?: "failed" | "passed" | "pending") => Promise<any> | any): void {
	deferredToLastItems.push({ description: `${description} (${currentTestName})`, callback });
}

afterEach("destroy sinon sandbox", () => {
	if (logger)
		logger.info(`Restoring sinon sandbox`);
	sb.restore();
});

export async function setTestContent(content: string): Promise<void> {
	const editor = currentEditor();
	const doc = editor.document;
	const all = new vs.Range(
		doc.positionAt(0),
		doc.positionAt(doc.getText().length),
	);
	logger.info(`Replacing content for file ${doc.uri} with ${content.length} characters`);
	// TODO: May be able to replace this with
	// return editor.edit((eb) => eb.replace(all, content));
	// once the fix for https://github.com/dart-lang/sdk/issues/32914
	// has made it all the way through.
	await editor.edit((eb) => eb.replace(all, content));

	// HACK: Add a small delay to try and reduce the chance of a "Requested result
	// might be inconsistent with previously returned results" error.
	await delay(50);
	await privateApi.currentAnalysis();
}

export function enableLint(project: string, lintName: string): void {
	const analysisOptions = path.join(project, "analysis_options.yaml");
	let contents = "";
	if (fs.existsSync(analysisOptions)) {
		contents = fs.readFileSync(analysisOptions).toString();
		// Restore after test.
		defer("Restore original analysis_options", () => fs.writeFileSync(analysisOptions, contents));
	} else {
		// Delete after test.
		defer("Remove created analysis_options", () => tryDeleteFile(analysisOptions));
	}
	if (!contents.includes("linter:\n  rules:\n"))
		contents += "\nlinter:\n  rules:\n";
	if (!contents.includes(`\n    - ${lintName}\n`))
		contents = contents.replace("linter:\n  rules:\n", `linter:\n  rules:\n    - ${lintName}\n`);
	fs.writeFileSync(analysisOptions, contents);
}

export async function uncommentTestFile(): Promise<void> {
	await setTestContent(currentDoc().getText().replace(/\n\/\/ /mg, "\n"));
}

export function getExpectedResults(doc = currentDoc()) {
	const start = positionOf("// == EXPECTED RESULTS ==^", doc);
	const end = positionOf("^// == /EXPECTED RESULTS ==", doc);
	const results = doc.getText(new vs.Range(start, end));
	return results.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.startsWith("// ") && !l.startsWith("// #")) // Allow "comment" lines within the comment
		.map((l) => l.substr(3))
		.join("\n");
}

export function select(...ranges: vs.Range[]) {
	currentEditor().selections = ranges.map((range) => new vs.Selection(range.start, range.end));
}

export async function executeOrganizeImportsCodeAction() {
	return executeCodeAction({ kind: vs.CodeActionKind.SourceOrganizeImports }, startOfDocument);
}

export async function executeSortMembersCodeAction() {
	return executeCodeAction({ kind: SourceSortMembersCodeActionKind }, startOfDocument);
}

export async function getCodeActions({ kind, title, requireExactlyOne = false, waitForMatch = true }: { kind?: vs.CodeActionKind, title?: string, requireExactlyOne?: boolean, waitForMatch?: boolean }, range: vs.Range) {
	let codeActions: vs.CodeAction[] = [];
	let matchingActions = await waitFor(async () => {
		codeActions = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, range);
		const matchingActions = codeActions.filter((ca) => (!kind || kind.contains(ca.kind!)) && (!title || ca.title === title));
		return (!waitForMatch || matchingActions.length) ? matchingActions : undefined;
	});

	matchingActions ??= [];

	if (requireExactlyOne && matchingActions.length !== 1)
		throw new Error(`Expected to find "${kind?.value}/${title}", but found ${codeActions.map((ca) => `"${ca.kind?.value}/${ca.title}"`).join(", ")}`);

	return matchingActions;
}

export async function executeCodeAction({ kind, title }: { kind?: vs.CodeActionKind, title?: string }, range: vs.Range) {
	const matchingActions = await getCodeActions({ kind, title, requireExactlyOne: true }, range);
	assert.equal(matchingActions.length, 1);
	await waitForEditorChange(() => vs.commands.executeCommand(matchingActions[0].command!.command, ...matchingActions[0].command!.arguments!)); // eslint-disable-line @typescript-eslint/no-unsafe-argument
}

export function positionOf(searchText: string, doc?: vs.TextDocument): vs.Position {
	// Normalise search text to match the document, since our literal template
	// strings in tests end up compiled as only \n on Windows even thouh the
	// source file is \r\n!
	searchText = searchText.replace(/\r/g, "").replace(/\n/g, documentEol);
	doc ??= currentDoc();
	logger.info(`Searching for "${searchText}" in ${doc.uri}`);
	const caretOffset = searchText.indexOf("^");
	assert.notEqual(caretOffset, -1, `Couldn't find a ^ in search text (${searchText})`);
	const docText = doc.getText();
	const matchedTextIndex = docText.indexOf(searchText.replace("^", ""));
	assert.notEqual(matchedTextIndex, -1, `Couldn't find string ${searchText.replace("^", "")} in the document to get position of. Document contained:\n${docText}`);

	return doc.positionAt(matchedTextIndex + caretOffset);
}

export function rangeOf(searchText: string, inside: vs.Range | undefined, allowMissing: true): vs.Range | undefined;
export function rangeOf(searchText: string, inside?: vs.Range): vs.Range;
export function rangeOf(searchText: string, inside?: vs.Range, allowMissing = false): vs.Range | undefined {
	searchText = searchText.replace(/\r/g, "").replace(/\n/g, documentEol);
	const doc = currentDoc();
	const startOffset = searchText.indexOf("|");
	assert.notEqual(startOffset, -1, `Couldn't find a | in search text (${searchText})`);
	const endOffset = searchText.lastIndexOf("|");
	assert.notEqual(endOffset, -1, `Couldn't find a second | in search text (${searchText})`);

	const startSearchAt = inside ? doc.offsetAt(inside.start) : 0;
	const endSearchAt = inside ? doc.offsetAt(inside.end) : -1;
	const docText = doc.getText();
	let matchedTextIndex = docText.indexOf(searchText.replace(/\|/g, ""), startSearchAt);
	if (endSearchAt > -1 && matchedTextIndex > endSearchAt)
		matchedTextIndex = -1;
	if (matchedTextIndex === -1 && allowMissing)
		return undefined;
	assert.notEqual(matchedTextIndex, -1, `Couldn't find string ${searchText.replace(/\|/g, "")} in the document to get range of. Document contained:\n${docText}`);

	return new vs.Range(
		doc.positionAt(matchedTextIndex + startOffset),
		doc.positionAt(matchedTextIndex + endOffset - 1),
	);
}


export async function getDocumentSymbols(): Promise<Array<vs.DocumentSymbol & { parent: vs.DocumentSymbol | undefined }> | undefined> {
	const documentSymbolResult = await vs.commands.executeCommand<vs.DocumentSymbol[]>("vscode.executeDocumentSymbolProvider", currentDoc().uri);
	if (!documentSymbolResult?.length)
		return undefined;

	// Return a flattened list with references to parent for simplified testing.
	const resultWithEmptyParents = documentSymbolResult.map((c) => Object.assign(c, { parent: undefined as vs.DocumentSymbol | undefined }));
	return resultWithEmptyParents.concat(flatMap(
		documentSymbolResult,
		(s) => s.children ? s.children.map((c) => Object.assign(c, { parent: s })) : [],
	));
}

async function getDefinitions(position: vs.Position): Promise<Array<vs.Location | vs.DefinitionLink>> {
	const definitionResult = await vs.commands.executeCommand<Array<vs.Location | vs.DefinitionLink>>("vscode.executeDefinitionProvider", currentDoc().uri, position);
	return definitionResult || [];
}

export async function getCodeLens(document: vs.TextDocument): Promise<vs.CodeLens[]> {
	const fileCodeLens = await vs.commands.executeCommand<vs.CodeLens[]>("vscode.executeCodeLensProvider", document.uri, 500);
	return fileCodeLens || [];
}

export async function getDefinition(position: vs.Position): Promise<vs.Location | vs.DefinitionLink> {
	const defs = await getDefinitions(position);
	assert.ok(defs?.length);
	return defs[0];
}

export function uriFor(def: vs.Location | vs.DefinitionLink) {
	return "uri" in def ? def.uri : def.targetUri;
}

export function rangeFor(def: vs.Location | vs.DefinitionLink) {
	return "range" in def ? def.range : def.targetRange;
}

export async function getWorkspaceSymbols(query: string): Promise<vs.SymbolInformation[]> {
	const workspaceSymbolResult = await vs.commands.executeCommand<vs.SymbolInformation[]>("vscode.executeWorkspaceSymbolProvider", query);
	return workspaceSymbolResult || [];
}

export function waitForDiagnosticChange(resource?: vs.Uri): Promise<void> {
	return new Promise((resolve) => {
		const disposable = vs.languages.onDidChangeDiagnostics((e) => {
			if (!resource || e.uris.find((r) => fsPath(r) === fsPath(resource))) {
				resolve();
				disposable.dispose();
			}
		});
	});
}

export async function acceptFirstSuggestion(): Promise<void> {
	// Ensure we are getting some results. This fixes a race where the server might've been
	// starting up as the test got here.
	const editor = currentEditor();
	const doc = editor.document;
	const pos = editor.selection.end;
	let results: vs.CompletionList | undefined;
	let remainingTries = 10;
	while (!results || results.isIncomplete || results.items.length === 0) {
		await delay(50);
		results = await vs.commands.executeCommand<vs.CompletionList>("vscode.executeCompletionItemProvider", doc.uri, pos, undefined, 1 /* resolveCount, forces resolve for the item */);
		if (--remainingTries <= 0)
			break;
	}

	// TODO: Can we make this better (we're essentially waiting to ensure resolve completed
	// before we accept, so that we don't insert the standard label without the extra
	// edits which are added in in resolve).
	await vs.commands.executeCommand("editor.action.triggerSuggest");
	await delay(100);
	await waitForEditorChange(() => vs.commands.executeCommand("acceptSelectedSuggestion"));
	await delay(100);
}

export function ensureInsertReplaceRanges(range: undefined | vs.Range | { inserting: vs.Range, replacing: vs.Range }, insertRangeMatch: string, replaceRangeMatch: string) {
	if (range && "inserting" in range && "replacing" in range) {
		assert.equal(range.inserting.isEqual(rangeOf(insertRangeMatch)), true);
		assert.equal(range.replacing.isEqual(rangeOf(replaceRangeMatch)), true);
	} else {
		assert.equal(range!.isEqual(rangeOf(replaceRangeMatch)), true);
	}
}

export function ensureError(errors: vs.Diagnostic[], text: string) {
	const error = errors.find((e) => e.message.includes(text));
	assert.ok(
		error,
		`Couldn't find error for ${text} in\n`
		+ errors.map((e) => `        ${e.message}`).join("\n"),
	);
}

export function ensureArrayContainsArray<T>(haystack: T[], needle: T[]) {
	assert.ok(
		arrayContainsArray(haystack, needle),
		`Did not find ${needle} in ${haystack}`,
	);
}

export function ensureWorkspaceSymbol(symbols: vs.SymbolInformation[], name: string, kind: vs.SymbolKind, containerName: string | undefined, uriOrMatch: vs.Uri | { endsWith: string }): void {
	const symbol = symbols.find((f) =>
		f.name === name
		&& f.kind === kind
		&& (f.containerName || "") === (containerName || ""),
	);
	assert.ok(
		symbol,
		`Couldn't find symbol for ${name}/${vs.SymbolKind[kind]}/${containerName} in\n`
		+ symbols.map((s) => `        ${s.name}/${vs.SymbolKind[s.kind]}/${s.containerName}`).join("\n"),
	);
	if (uriOrMatch instanceof vs.Uri)
		assert.equal(
			fsPath(symbol.location.uri),
			fsPath(uriOrMatch),
			`${fsPath(symbol.location.uri)} should equal ${fsPath(uriOrMatch)}`
		);
	else
		assert.ok(
			fsPath(symbol.location.uri).endsWith(uriOrMatch.endsWith),
			`${fsPath(symbol.location.uri)} should end with ${uriOrMatch.endsWith})`,
		);
	assert.ok(symbol.location);
	assert.ok(symbol.location.range);
}

export function ensureDocumentSymbol(symbols: Array<vs.DocumentSymbol & { parent: vs.DocumentSymbol | undefined }>, name: string, kind: vs.SymbolKind, parentName?: string): void {
	const symbol = symbols.find((f) =>
		f.name === name
		&& f.kind === kind
		&& (f.parent ? f.parent.name : "") === (parentName || ""),
	);
	assert.ok(
		symbol,
		`Couldn't find symbol for ${name}/${vs.SymbolKind[kind]}/${parentName} in\n`
		+ symbols.map((s) => `        ${s.name}/${vs.SymbolKind[s.kind]}/${s.parent ? s.parent.name : ""}`).join("\n"),
	);
	const range = symbol.range;
	assert.ok(range);
	assert.ok(range.start);
	assert.ok(range.start.line);
	assert.ok(range.end);
	assert.ok(range.end.line);
}

function rangeString(range: vs.Range) {
	return `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
}

export function ensureLocation(locations: vs.Location[] | undefined, uri: vs.Uri, range: vs.Range): void {
	if (!locations)
		throw new Error("Locations to search was undefined");
	const location = locations.find((l) =>
		l.uri.toString() === uri.toString()
		&& l.range.isEqual(range),
	);
	assert.ok(
		location,
		`Couldn't find location for ${uri}/${rangeString(range)} in\n`
		+ locations.map((l) => `        ${l.uri}/${rangeString(l.range)}`).join("\n"),
	);
}

export function ensureNoLocation(locations: vs.Location[], uri: vs.Uri, range: vs.Range): void {
	const location = locations.find((l) =>
		l.uri.toString() === uri.toString()
		&& l.range.isEqual(range),
	);
	assert.ok(
		!location,
		`Unexpectedly found location for ${uri}/${rangeString(range)}`,
	);
}

export function ensureIsRange(actual: vs.Range, expected: vs.Range) {
	assert.ok(actual);
	assert.equal(actual.start.line, expected.start.line, "Start lines did not match");
	assert.equal(actual.start.character, expected.start.character, "Start characters did not match");
	assert.equal(actual.end.line, expected.end.line, "End lines did not match");
	assert.equal(actual.end.character, expected.end.character, "End characters did not match");
}

export function snippetValue(text: string | vs.SnippetString | undefined) {
	return !text || typeof text === "string" ? text : text.value;
}

export async function getCompletionsAt(
	searchText: string,
	{ triggerCharacter, resolveCount = 1, requireComplete = false }: { triggerCharacter?: string, resolveCount?: number, requireComplete?: boolean } = {},
): Promise<vs.CompletionItem[]> {
	const position = positionOf(searchText);
	let results: vs.CompletionList | undefined;
	// If we require complete, keep going until isIncomplete=false *and* there are some results (because VS code drops isIncomplete for empty results).
	let remainingTries = 10;
	while (!results || (requireComplete && (results.isIncomplete || results.items.length === 0))) {
		if (results) {
			// When we're calling a subsequent time, add a delay.
			await delay(100);
		}
		results = await vs.commands.executeCommand<vs.CompletionList>("vscode.executeCompletionItemProvider", currentDoc().uri, position, triggerCharacter, resolveCount);
		if (--remainingTries <= 0)
			break;
	}
	return results.items;
}

export async function getSnippetCompletionsAt(
	searchText: string,
	{ triggerCharacter, resolveCount = 1, requireComplete = false }: { triggerCharacter?: string, resolveCount?: number, requireComplete?: boolean } = {},
): Promise<vs.CompletionItem[]> {
	const completions = await getCompletionsAt(searchText, { triggerCharacter, resolveCount, requireComplete });
	return completions.filter((c) => c.kind === vs.CompletionItemKind.Snippet);
}

export function ensureCompletion(items: vs.CompletionItem[], kind: vs.CompletionItemKind, expectedLabel: string, expectedFilterText?: string, documentation?: string): vs.CompletionItem {
	const kinds = Array.isArray(kind) ? kind : [kind];
	// Sometimes our mismatch is just the details afterwards, so we'll try to match on labels with/without and then verify
	// afterwards so we can get better errors ("expected `exit(...)` but got `exit`" instead of "can't find `exit(...)` in [big list]").
	const expectedShortLabel = expectedLabel.split("(")[0].trim();
	const completionCandidates = items.filter((item) => {
		const actualLabel = completionLabel(item);
		const actualShortLabel = actualLabel.split("(")[0].trim();
		return expectedShortLabel === actualShortLabel && kinds.includes(item.kind!);
	});
	if (completionCandidates.length === 0) {
		assert.fail(
			`Couldn't find completion for ${expectedLabel} in\n`
			+ items.map((item) => `        ${item.kind && vs.CompletionItemKind[item.kind]}/${completionLabel(item)}`).join("\n"),
		);
	}
	if (completionCandidates.length > 1) {
		assert.fail(
			`Found multiple completions for ${expectedLabel} in\n`
			+ completionCandidates.map((item) => `        ${item.kind && vs.CompletionItemKind[item.kind]}/${completionLabel(item)}`).join("\n"),
		);
	}
	const completion = completionCandidates[0];
	const actualLabel = completionLabel(completion);
	const actualLabelLong = completionLabelWithDetails(completion);

	// Either we should have a single string label that matches expectedLabel, or we should be a non-string label
	// where actualLabelLong starts with label.
	if (typeof completion.label === "string")
		assert.equal(actualLabel.trim(), expectedLabel.trim()); // For labels, trailing whitespace is not important.
	else
		// We use startsWith because the new long labels may have return values that
		// the tests do not (`exit(…) → Never`).
		// TODO(dantup): Once stable is using label details, change these tests to verify the whole new object.
		assert.ok(actualLabelLong.startsWith(expectedLabel), `Expected label to start with "${expectedLabel}" but was "${actualLabelLong}"`);

	const expectedResolvedFilterText = expectedFilterText ?? expectedLabel;
	const actualResolvedFilterText = completion.filterText ?? actualLabel;
	assert.equal(actualResolvedFilterText.trim(), expectedResolvedFilterText.trim());

	if (documentation)
		assert.equal((completion.documentation as any).value.trim(), documentation);
	return completion;
}

export function completionLabel(completion: vs.CompletionItem): string {
	const label = completion.label;
	return typeof label === "string"
		? label
		: label.label;
}

function completionLabelWithDetails(completion: vs.CompletionItem): string {
	const label = completion.label;
	return typeof label === "string"
		? label
		: label.label + (label.detail ?? "");
}

export function ensureSnippet(items: vs.CompletionItem[], label: string, filterText: string, documentation?: string): void {
	ensureCompletion(items, vs.CompletionItemKind.Snippet, label, filterText, documentation);
}

export function ensureNoCompletion(items: vs.CompletionItem[], kind: vs.CompletionItemKind | vs.CompletionItemKind[], label: string): void {
	const kinds = Array.isArray(kind) ? kind : [kind];
	const completion = items.find((item) =>
		(item.label === label || item.filterText === label)
		&& kinds.includes(item.kind!),
	);
	assert.ok(
		!completion,
		`Found unexpected completion for ${label}`,
	);
}

export function ensureNoSnippet(items: vs.CompletionItem[], label: string): void {
	ensureNoCompletion(items, vs.CompletionItemKind.Snippet, label);
}

export async function ensureTestContent(expected: string, allowNewMismatches = false): Promise<void> {
	return ensureFileContent(currentDoc().uri, expected, allowNewMismatches);
}

export async function ensureFileContent(uri: vs.Uri, expected: string, allowNewMismatches = false): Promise<void> {
	const doc = await vs.workspace.openTextDocument(uri);
	function normalise(text: string) {
		text = text.replace(/\r/g, "").trim();
		if (allowNewMismatches)
			text = text.replace(/ new /g, " ");
		return text;
	}
	// Wait for a short period before checking to reduce changes of flaky tests.
	await waitForResult(
		() => normalise(doc.getText()) === normalise(expected),
		"Document content did not match expected",
		100,
		false,
	);
	assert.equal(normalise(doc.getText()), normalise(expected));
}

function ensureTestSelection(expected: vs.Range): void {
	const editor = currentEditor();
	assert.equal(editor.selection.isEqual(expected), true, `actual: ${rangeString(editor.selection)} (${editor.document.getText(editor.selection)}) vs expected: ${rangeString(expected)} (${editor.document.getText(expected)})`);
}


export async function ensureTestContentWithSelection(expected: string): Promise<void> {
	await ensureTestContent(expected.replace(/\|/g, ""));
	ensureTestSelection(rangeOf(expected));
}

export function checkTreeNodeResults(actual: string, expected: string, description?: string) {
	// To simplify tests, `expected` always has forward slashes, but in reality should
	// match the platform, so in `expected`, replace any forward slashes with path.sep but only
	// if they come before `.dart` (since we don't want to mess with `0/1 Passed`).
	const segments = expected.split(".dart");
	segments[0] = segments[0].replace(/\//g, path.sep);
	expected = segments.join(".dart");
	assert.equal(actual.trim(), expected.trim(), description);
}

export function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function getRandomTempFolder(): string {
	const r = Math.floor(Math.random() * 100000);
	const base = path.join(tmpdir(), "dart-code-tests");
	if (!fs.existsSync(base))
		fs.mkdirSync(base);
	const tmpPath = path.join(base, r.toString());
	if (!fs.existsSync(tmpPath))
		fs.mkdirSync(tmpPath);
	return tmpPath;
}

export async function waitForResult(action: () => boolean | Promise<boolean>, message?: string, milliseconds = 6000, throwOnFailure = true): Promise<void> {
	const res = await waitFor(action, undefined, milliseconds);
	if (throwOnFailure && !res)
		throw new Error(`Action didn't return true within ${milliseconds}ms (${message})`);
}


export async function waitForEditorChange(action: () => Thenable<void>): Promise<void> {
	const doc = currentDoc();
	const oldVersion = doc.version;
	await action();
	await waitFor(() => doc.version !== oldVersion, 20, 2000);
	await delay(1);
}

export async function waitForNextAnalysis(action: () => void | Thenable<void>, timeoutSeconds?: number): Promise<void> {
	logger.info("Waiting for any in-progress analysis to complete");
	await privateApi.currentAnalysis();
	// Get a new completer for the next analysis.
	const nextAnalysis = privateApi.nextAnalysis();
	logger.info("Running requested action");
	await action();
	logger.info(`Waiting for analysis to complete`);
	await withTimeout(nextAnalysis, "Analysis did not complete within specified timeout", timeoutSeconds);
}

export async function getResolvedDebugConfiguration(extraConfiguration?: { program: string | undefined, [key: string]: any }): Promise<(vs.DebugConfiguration & DartLaunchArgs)> {
	const debugConfig: vs.DebugConfiguration = Object.assign({}, {
		name: `Dart & Flutter (${currentTestName})`,
		request: "launch",
		type: "dart",
	}, extraConfiguration);
	return await privateApi.debugProvider.resolveDebugConfigurationWithSubstitutedVariables!(vs.workspace.workspaceFolders![0], debugConfig) as vs.DebugConfiguration & DartLaunchArgs;
}

export async function getLaunchConfiguration(script?: URI | string, extraConfiguration?: Record<string, any>): Promise<vs.DebugConfiguration & DartLaunchArgs | undefined | null> {
	if (script && typeof script !== "string")
		script = getProgramString(script);
	const launchConfig = Object.assign({}, {
		program: script,
	}, extraConfiguration);
	return await getResolvedDebugConfiguration(launchConfig);
}

export async function getAttachConfiguration(extraConfiguration?: Record<string, any>): Promise<vs.DebugConfiguration & DartLaunchArgs | undefined | null> {
	const attachConfig = Object.assign({}, {
		program: undefined,
		request: "attach",
	}, extraConfiguration);
	return await getResolvedDebugConfiguration(attachConfig);
}

export async function writeBrokenDartCodeIntoFileForTest(file: vs.Uri): Promise<void> {
	const nextAnalysis = privateApi.nextAnalysis();
	fs.writeFileSync(fsPath(file), "this is broken dart code");
	await nextAnalysis;
	// HACK: Sometimes we see analysis the analysis flag toggle quickly and we get an empty error list
	// so we need to add a small delay here and then wait for any in progress analysis.
	await delay(50);
	await privateApi.currentAnalysis();
	defer("Remove broken Dart file", () => tryDelete(file));
}

export function deleteFileIfExists(filePath: string) {
	if (fs.existsSync(filePath)) {
		fs.unlinkSync(filePath);
	}
}

export async function captureDebugSessionCustomEvents(startDebug: () => void, expectMultipleSessions = false): Promise<vs.DebugSessionCustomEvent[]> {
	let totalSessionsStarted = 0;
	const sessions = new Set<vs.DebugSession>();
	let startSub: IAmDisposable | undefined;
	let endSub: IAmDisposable | undefined;
	const events: vs.DebugSessionCustomEvent[] = [];

	const startPromise = new Promise<void>((resolve) => {
		startSub = vs.debug.onDidStartDebugSession((s) => {
			sessions.add(s);
			totalSessionsStarted++;
			resolve();
		});
	});
	const eventSub = vs.debug.onDidReceiveDebugSessionCustomEvent((e) => {
		if (sessions.has(e.session))
			events.push(e);
	});
	const endPromise = new Promise<void>((resolve) => {
		endSub = vs.debug.onDidTerminateDebugSession(async (s) => {
			sessions.delete(s);
			// Allow some time for another session to start in case of multi-session test runs.
			if (expectMultipleSessions)
				await waitFor(() => totalSessionsStarted > 1);
			if (sessions.size === 0)
				resolve();
		});
	});

	startDebug();
	await Promise.all([startPromise, endPromise]);
	await startSub?.dispose();
	await endSub?.dispose();
	eventSub.dispose();

	return events;
}

export function prepareHasRunFile(root: string, name: string) {
	const hasRunFile = path.join(root, `scripts/has_run/${name}`);
	deleteFileIfExists(hasRunFile);
	return hasRunFile;
}

export function ensureHasRunRecently(root: string, name: string, allowedModificationSeconds = 60) {
	const hasRunFile = path.isAbsolute(name)
		? name
		: path.join(root, `scripts/has_run/${name}`);
	assert.ok(fs.existsSync(hasRunFile));
	const lastModified = fs.statSync(hasRunFile).mtime;
	const modifiedSecondsAgo = (Date.now() - lastModified.getTime()) / 1000;
	assert.ok(modifiedSecondsAgo < allowedModificationSeconds, `File hasn't been modified for ${modifiedSecondsAgo} seconds`);
}

export function ensureHasRunWithArgsStarting(root: string, name: string, expectedArgs: string) {
	ensureHasRunRecently(root, name);
	const hasRunFile = path.isAbsolute(name)
		? name
		: path.join(root, `scripts/has_run/${name}`);
	assert.ok(fs.existsSync(hasRunFile));
	const contents = fs.readFileSync(hasRunFile).toString()
		// On Windows we get all the quotes from the args, but they're not
		// important for the test so strip them so we can use the same
		// expectation across platforms.
		.replace(/"/g, "").trim();
	if (!contents.startsWith(expectedArgs.trim()))
		throw new Error(`Contents:\n${contents}\nExpected start:\n${expectedArgs}`);
}

export async function saveTrivialChangeToFile(uri: vs.Uri) {
	const editor = await openFile(uri);
	const doc = editor.document;
	await setTestContent(doc.getText() + " // test");
	await doc.save();
}

export function makeTrivialChangeToFileDirectly(uri: vs.Uri): Promise<void> {
	return new Promise((resolve, reject) => {
		const filePath = fsPath(uri);
		const originalContents = fs.readFileSync(filePath).toString();
		fs.writeFile(filePath, originalContents + " // test", (error) => {
			if (error)
				reject(error);
			else
				resolve();
		});
	});
}

// Watches a promise and reports every 10s while it's unresolved. This is to aid tracking
// down hangs in test runs where multiple promises can be spawned together and generate
// lots of log output, making it hard to keep track of which did not complete.
export function watchPromise<T>(name: string, promise: Promise<T> | T): Promise<T> {
	const activeTestName = currentTestName;
	// For convenience, this method might get wrapped around things that are not
	// promises.
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
	const promiseAny = promise as any;
	if (!promise || !promiseAny.then || !promiseAny.catch)
		return Promise.resolve(promise);
	promise = promise as Promise<T>;
	let didComplete = false;
	// We'll log completion of the promise only if we'd logged that it was still in
	// progress at some point.
	let logCompletion = false;
	void promise.then(() => {
		didComplete = true;
		if (logCompletion)
			logger.info(`Promise ${name} resolved!`, LogCategory.CI);
	});
	promise.catch(() => {
		didComplete = true;
		if (logCompletion)
			logger.warn(`[${activeTestName}] Promise ${name} rejected!`, LogCategory.CI);
	});

	const initialCheck = 3000;
	const subsequentCheck = 10000;
	const maxTime = 60000;
	const checkResult = (timeMS: number) => {
		if (didComplete)
			return;
		logCompletion = true;
		logger.info(`Promise ${name} is still unresolved!`, LogCategory.CI);
		if (timeMS > maxTime) {
			logger.error(`[${activeTestName}] Promise ${name} not resolved after ${maxTime}ms so no longer watching!`, LogCategory.CI);
			return;
		}
		setTimeout(() => checkResult(timeMS + subsequentCheck), subsequentCheck).unref();
	};
	setTimeout(() => checkResult(initialCheck), initialCheck).unref(); // First log is after 3s, rest are 10s.

	return promise;
}

export async function setConfigForTest(section: string, key: string, value: any): Promise<void> {
	const conf = vs.workspace.getConfiguration(section);
	const values = conf.inspect(key);
	const oldValue = values?.globalValue;
	await conf.update(key, value, vs.ConfigurationTarget.Global);
	defer("Restore test config", () => conf.update(key, oldValue, vs.ConfigurationTarget.Global));
}

export async function addLaunchConfigsForTest(workspaceUri: vs.Uri, configs: any[]) {
	const launchConfig = vs.workspace.getConfiguration("launch", workspaceUri);
	const originalConfigs = launchConfig.get<any[]>("configurations") || [];
	logger.info(`Adding ${configs?.length} launch configs to the ${originalConfigs?.length} that already existed!`);
	const newConfigs = (originalConfigs || []).slice().concat(configs);
	await launchConfig.update("configurations", newConfigs);
	defer("Restore launch configs", async () => {
		logger.info(`Resetting back to ${originalConfigs?.length} original launch configs`);
		await launchConfig.update("configurations", originalConfigs.length ? originalConfigs : undefined);
		logger.info(`Done resetting back to ${originalConfigs?.length} original launch configs!`);
		await resolvedPromise;
	});
}

export async function clearAllContext(context: Context): Promise<void> {
	await context.clear();
}

export function ensurePackageTreeNode(items: vs.TreeItem[] | undefined | null, nodeContext: string, label: string, description?: string): vs.TreeItem {
	if (!items)
		throw new Error("No tree nodes found to check");

	const item = items.find((item) =>
		item.contextValue?.includes(nodeContext)
		&& renderedItemLabel(item) === label,
	);
	if (!item)
		throw new Error(`Did not find item matching ${label} in:\n${items.map((item) => `    ${renderedItemLabel(item)} (${typeof item.label === "string" ? item.label : item.label?.label ?? "<unnamed>"}, ${item.contextValue})`).join("\n")}`);

	if (description)
		assert.equal(item.description, description);

	assert.ok(
		item,
		`Couldn't find ${nodeContext} tree node for ${label} in\n`
		+ items.map((item) => `        ${item.constructor.name}/${renderedItemLabel(item)}`).join("\n"),
	);
	return item;
}

export function renderedItemLabel(item: vs.TreeItem): string {
	return treeLabel(item) || path.basename(fsPath(item.resourceUri!));
}

/// Gets the source line for a TestItem.
///
/// If the item has no source, will return the line of its earliest child (recursively).
function getSourceLine(item: vs.TestItem): number {
	// If we have our own line, always use that.
	const line = item.range?.start.line;
	if (line)
		return line;

	// Otherwise, collect all child lines.
	const lines: number[] = [];
	item.children.forEach((child) => lines.push(getSourceLine(child)));

	// Return the lowest child line, or something really high to put us at the end (this
	// shouldn't really happen, but the API allows for it).
	return Math.min(99999999, ...lines);
}

export function isTestDoneSuccessNotification(e: vs.DebugSessionCustomEvent) {
	if (e.event !== "dart.testNotification")
		return false;
	const notification = e.body as TestDoneNotification;
	return notification.type === "testDone" && notification.result !== "error" && !notification.hidden;
}

export function makeTestTextTree(items?: vs.TestItemCollection | vs.Uri, { buffer = [], indent = 0, onlyFailures, onlyActive, sortByLabel }: { buffer?: string[]; indent?: number, onlyFailures?: boolean, onlyActive?: boolean, sortByLabel?: boolean } = {}): string[] {
	const collection = items instanceof vs.Uri
		? privateApi.testController.controller.items
		: items ?? privateApi.testController.controller.items;
	const parentResourceUri = items instanceof vs.Uri ? items : undefined;

	const testItems: vs.TestItem[] = [];
	collection.forEach((item) => {
		if (!parentResourceUri || item.uri?.toString() === parentResourceUri.toString())
			testItems.push(item);
	});

	// Sort the items by their locations by default so we get stable results. Otherwise the order that items
	// are created would be used, which is usually source-order, but could be different if the user
	// selectively runs tests starting at the end of the file.
	// Allow overriding to sort by name for tests that are modifying files and running subsets of tests
	// and don't care about source order.
	sortBy(testItems, sortByLabel ? (item) => item.label : getSourceLine);

	for (const item of testItems) {
		const lastResult = privateApi.testController.getLatestData(item);
		const lastResultTestNode = lastResult as TestNode;

		let nodeString = item.label;
		if (item.description)
			nodeString += ` [${item.description}]`;

		let includeNode = true;
		if (lastResult) {
			if (lastResultTestNode.status)
				nodeString += ` ${TestStatus[lastResultTestNode.status]}`;
			else if (lastResult.children.length)
				nodeString += ` ${TestStatus[lastResult.getHighestChildStatus(true)]}`;

			// If this node has a different file to the parent, include that in the output.
			if (lastResult.path && lastResult.parent?.path && lastResult.path !== lastResult.parent?.path)
				nodeString += ` (${path.basename(lastResult.path)})`;

			const isStale = lastResult.isStale;
			const isFailure = lastResultTestNode.status === TestStatus.Failed;
			if ((isStale && onlyActive) || (!isFailure && onlyFailures))
				includeNode = false;
		} else {
			nodeString += " (not found in model)";
		}

		if (includeNode)
			buffer.push(`${" ".repeat(indent * 4)}${nodeString}`);

		makeTestTextTree(item.children, { buffer, indent: indent + 1, onlyFailures, onlyActive, sortByLabel });
	}

	return buffer;
}

export async function makeTextTreeUsingCustomTree(parent: vs.TreeItem | vs.Uri | undefined, provider: vs.TreeDataProvider<vs.TreeItem>, { buffer = [], indent = 0 }: { buffer?: string[]; indent?: number } = {}): Promise<string[]> {
	const parentNode = parent instanceof vs.Uri ? undefined : parent;
	const parentResourceUri = parent instanceof vs.Uri ? parent : undefined;

	const items = await provider.getChildren(parentNode) || [];

	for (const item of items) {
		const treeItem = await provider.getTreeItem(item);
		// Filter to only the suite we were given (though includes all children).
		if (parentResourceUri && fsPath(treeItem.resourceUri!) !== fsPath(parentResourceUri))
			continue;

		const label = treeItem.label;
		const labelString = typeof label === "string" ? label : label?.label ?? "<unnamed>";
		const description = treeItem.description ? ` [${treeItem.description}]` : "";
		const iconUri = treeItem.iconPath ? treeItem.iconPath instanceof vs.Uri
			? treeItem.iconPath
			: "dark" in (treeItem.iconPath as any)
				? (treeItem.iconPath as any).dark as string | vs.Uri
				: undefined
			: undefined;
		const iconFile = iconUri instanceof vs.Uri ? path.basename(fsPath(iconUri)).replace("-dark", "") : undefined;
		const iconSuffix = iconFile ? ` (${iconFile})` : "";
		buffer.push(`${" ".repeat(indent * 4)}${labelString}${description}${iconSuffix}`);
		await makeTextTreeUsingCustomTree(item, provider, { buffer, indent: indent + 1 });
	}
	return buffer;
}

export function createTempTestFile(absolutePath: string) {
	createFolderForFile(absolutePath);
	fs.writeFileSync(absolutePath, "");
	defer("delete temp file", () => tryDeleteFile(absolutePath));
}
