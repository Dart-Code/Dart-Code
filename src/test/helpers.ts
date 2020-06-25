import * as assert from "assert";
import * as fs from "fs";
import { tmpdir } from "os";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { dartCodeExtensionIdentifier, DART_TEST_SUITE_NODE_CONTEXT } from "../shared/constants";
import { LogCategory } from "../shared/enums";
import { Logger } from "../shared/interfaces";
import { captureLogs } from "../shared/logging";
import { internalApiSymbol } from "../shared/symbols";
import { BufferedLogger, escapeRegExp, filenameSafe, flatMap } from "../shared/utils";
import { fsPath, tryDeleteFile } from "../shared/utils/fs";
import { waitFor } from "../shared/utils/promises";
import { InternalExtensionApi } from "../shared/vscode/interfaces";
import { SourceSortMembersCodeActionKind } from "../shared/vscode/utils";
import { Context } from "../shared/vscode/workspace";

export const ext = vs.extensions.getExtension(dartCodeExtensionIdentifier)!;
export let extApi: InternalExtensionApi;
export let logger: Logger = new BufferedLogger();
export const threeMinutesInMilliseconds = 1000 * 60 * 3;
export const fakeCancellationToken: vs.CancellationToken = {
	isCancellationRequested: false,
	onCancellationRequested: (_) => ({ dispose: () => undefined }),
};

if (!ext) {
	logger.error("Quitting with error because extension failed to load.");
	process.exit(1);
}

const testFolder = path.join(ext.extensionPath, "src/test");

// Dart
export const helloWorldFolder = vs.Uri.file(path.join(testFolder, "test_projects/hello_world"));
export const helloWorldMainFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/main.dart"));
export const helloWorldInspectionFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/inspect.dart"));
export const helloWorldLongRunningFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/long_running.dart"));
export const helloWorldMainLibFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/basic.dart"));
export const helloWorldDeferredEntryFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/deferred_entry.dart"));
export const helloWorldPartEntryFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/part.dart"));
export const helloWorldPubspec = vs.Uri.file(path.join(fsPath(helloWorldFolder), "pubspec.yaml"));
export const helloWorldGettersFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/getters.dart"));
export const helloWorldBrokenFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/broken.dart"));
export const helloWorldThrowInSdkFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/throw_in_sdk_code.dart"));
export const helloWorldThrowInExternalPackageFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/throw_in_external_package.dart"));
export const helloWorldThrowInLocalPackageFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/throw_in_local_package.dart"));
export const helloWorldGoodbyeFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/goodbye.dart"));
export const helloWorldHttpFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/http.dart"));
export const helloWorldPathFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/path.dart"));
export const helloWorldLocalPackageFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/local_package.dart"));
export const helloWorldCreateMethodClassAFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/create_method/class_a.dart"));
export const helloWorldCreateMethodClassBFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/create_method/class_b.dart"));
export const helloWorldExampleSubFolder = vs.Uri.file(path.join(fsPath(helloWorldFolder), "example"));
export const helloWorldExampleSubFolderMainFile = vs.Uri.file(path.join(fsPath(helloWorldExampleSubFolder), "bin/main.dart"));
export const emptyFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/empty.dart"));
export const missingFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/missing.dart"));
export const emptyFileInExcludedFolder = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/excluded/empty.dart"));
export const emptyExcludedFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/excluded_empty.dart"));
export const helloWorldCompletionFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/completion.dart"));
export const helloWorldDeferredScriptFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/deferred_script.dart"));
export const helloWorldPartWrapperFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/part_wrapper.dart"));
export const helloWorldPartFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/part.dart"));
export const everythingFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/everything.dart"));
// Package
export const myPackageFolder = vs.Uri.file(path.join(testFolder, "test_projects/my_package"));
export const myPackageThingFile = vs.Uri.file(path.join(fsPath(myPackageFolder), "lib/my_thing.dart"));
// Dart tests
export const helloWorldTestFolder = vs.Uri.file(path.join(fsPath(helloWorldFolder), "test"));
export const helloWorldTestMainFile = vs.Uri.file(path.join(fsPath(helloWorldTestFolder), "basic_test.dart"));
export const helloWorldTestTreeFile = vs.Uri.file(path.join(fsPath(helloWorldTestFolder), "tree_test.dart"));
export const helloWorldTestDupeNameFile = vs.Uri.file(path.join(fsPath(helloWorldTestFolder), "dupe_name_test.dart"));
export const helloWorldTestBrokenFile = vs.Uri.file(path.join(fsPath(helloWorldTestFolder), "broken_test.dart"));
export const helloWorldTestSkipFile = vs.Uri.file(path.join(fsPath(helloWorldTestFolder), "skip_test.dart"));
// Flutter
export const flutterHelloWorldFolder = vs.Uri.file(path.join(testFolder, "test_projects/flutter_hello_world"));
export const flutterEmptyFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/empty.dart"));
export const flutterHelloWorldMainFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/main.dart"));
export const flutterHelloWorldOutlineFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/outline.dart"));
export const flutterHelloWorldExampleSubFolder = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "example"));
export const flutterHelloWorldExampleSubFolderMainFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldExampleSubFolder), "lib/main.dart"));
export const flutterHelloWorldBrokenFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/broken.dart"));
export const flutterHelloWorldHttpFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/http.dart"));
export const flutterHelloWorldGettersFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/getters.dart"));
export const flutterHelloWorldPathFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/path.dart"));
export const flutterHelloWorldLocalPackageFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/local_package.dart"));
export const flutterHelloWorldThrowInSdkFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/throw_in_sdk_code.dart"));
export const flutterHelloWorldThrowInExternalPackageFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/throw_in_external_package.dart"));
export const flutterHelloWorldThrowInLocalPackageFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/throw_in_local_package.dart"));
// Flutter Bazel
export const flutterBazelRoot = vs.Uri.file(path.join(testFolder, "test_projects/bazel_workspace"));
export const flutterBazelHelloWorldFolder = vs.Uri.file(path.join(fsPath(flutterBazelRoot), "flutter_hello_world_bazel"));
export const flutterBazelHelloWorldMainFile = vs.Uri.file(path.join(fsPath(flutterBazelHelloWorldFolder), "lib/main.dart"));
export const flutterBazelTestMainFile = vs.Uri.file(path.join(fsPath(flutterBazelHelloWorldFolder), "test/widget_test.dart"));
// Flutter tests
export const flutterTestMainFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test/widget_test.dart"));
export const flutterTestOtherFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test/other_test.dart"));
export const flutterTestAnotherFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test/another_test.dart"));
export const flutterTestBrokenFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test/broken_test.dart"));
// Web
export const webProjectContainerFolder = vs.Uri.file(path.join(testFolder, "test_projects/web"));
export const webHelloWorldFolder = vs.Uri.file(path.join(fsPath(webProjectContainerFolder), "hello_world"));
export const webHelloWorldMainFile = vs.Uri.file(path.join(fsPath(webHelloWorldFolder), "lib/src/todo_list/todo_list_component.dart"));
export const webHelloWorldIndexFile = vs.Uri.file(path.join(fsPath(webHelloWorldFolder), "web/index.html"));
export const webHelloWorldExampleSubFolder = vs.Uri.file(path.join(fsPath(webHelloWorldFolder), "example"));
export const webHelloWorldExampleSubFolderIndexFile = vs.Uri.file(path.join(fsPath(webHelloWorldExampleSubFolder), "web/index.html"));
export const webBrokenFolder = vs.Uri.file(path.join(fsPath(webProjectContainerFolder), "broken"));
export const webBrokenIndexFile = vs.Uri.file(path.join(fsPath(webBrokenFolder), "web/index.html"));
export const webBrokenMainFile = vs.Uri.file(path.join(fsPath(webBrokenFolder), "lib/src/todo_list/todo_list_component.dart"));
// Web tests
export const webTestMainFile = vs.Uri.file(path.join(fsPath(webHelloWorldFolder), "test/basic_test.dart"));
export const webTestBrokenFile = vs.Uri.file(path.join(fsPath(webHelloWorldFolder), "test/broken_test.dart"));
export const webTestOtherFile = vs.Uri.file(path.join(fsPath(webHelloWorldFolder), "test/other_test.dart"));

export const flutterTestSurveyID = "flutterVsCodeTestSurvey";

const startOfDocument = new vs.Range(new vs.Position(0, 0), new vs.Position(0, 0));

export function currentEditor(): vs.TextEditor {
	let editor = vs.window.activeTextEditor;
	if (!editor || editor.document.uri.scheme !== "file") {
		const firstEditor = vs.window.visibleTextEditors.find((e) => e.document.uri.scheme === "file");
		if (firstEditor)
			logger.warn(`Current active editor is not a file (${editor ? editor.document.uri : "none"}) so using first visible editor (${firstEditor.document.uri})`);
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
	if (extApi.workspaceContext.hasAnyFlutterProjects)
		return flutterEmptyFile;
	else
		return emptyFile;
}

export async function activateWithoutAnalysis(): Promise<void> {
	// TODO: Should we do this, or should we just check that it has been activated?
	await ext.activate();
	if (ext.exports) {
		extApi = ext.exports[internalApiSymbol];
		setupTestLogging();
	} else
		console.warn("Extension has no exports, it probably has not activated correctly! Check the extension startup logs.");
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

	extApi = ext.exports[internalApiSymbol];
	const emittingLogger = extApi.logger;

	if (fileSafeCurrentTestName) {
		const logFolder = process.env.DC_TEST_LOGS || path.join(ext.extensionPath, ".dart_code_test_logs");
		if (!fs.existsSync(logFolder))
			fs.mkdirSync(logFolder);
		const logFile = fileSafeCurrentTestName + ".txt";
		const logPath = path.join(logFolder, logFile);

		// For debugger tests, the analyzer log is just noise, so we filter it out.
		const excludeLogCategories = process.env.BOT && process.env.BOT.indexOf("debug") !== -1
			? [LogCategory.Analyzer]
			: undefined;
		const testLogger = captureLogs(emittingLogger, logPath, extApi.getLogHeader(), 20000, excludeLogCategories, true);

		deferUntilLast(async (testResult?: "passed" | "failed") => {
			// Put a new buffered logger back to capture any logging output happening
			// after we closed our log file to be included in the next.
			logger = new BufferedLogger();

			// Wait a little before closing, to ensure we capture anything in-progress.
			await delay(1000);
			await testLogger.dispose();
			// On CI, we delete logs for passing tests to save money on S3 :-)
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

export async function activate(file?: vs.Uri | null | undefined): Promise<void> {
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
	await extApi.initialAnalysis;
	// Opening a file above may start analysis after a short period so give it time to start
	// before we continue.
	await delay(200);
	logger.info(`Waiting for in-progress analysis`);
	await extApi.currentAnalysis();

	logger.info(`Cancelling any in-progress requests`);
	extApi.cancelAllAnalysisRequests();

	logger.info(`Ready to start test`);
}

export async function getPackages(uri?: vs.Uri) {
	await activateWithoutAnalysis();
	if (!(uri || (vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length))) {
		logger.error("Cannot getPackages because there is no workspace folder and no URI was supplied");
		return;
	}
	await waitForNextAnalysis(async () => {
		await vs.commands.executeCommand("dart.getPackages", uri || vs.workspace.workspaceFolders![0].uri);
	}, 60);
}

function logOpenEditors() {
	logger.info(`Current open editors are:`);
	if (vs.window.visibleTextEditors && vs.window.visibleTextEditors.length) {
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
	const channel = vs.window.createOutputChannel(name);

	sb.stub(channel, "append").callsFake((s: string) => buffer.push(s));
	sb.stub(channel, "appendLine").callsFake((s: string) => buffer.push(`${s}\n`));

	// Ensure calls to create this output channel return our stubbed output channel.
	const createOutputChannel = sb.stub(vs.window, "createOutputChannel").callThrough();
	createOutputChannel.withArgs(sinon.match(new RegExp(`^${escapeRegExp(name)}`))).returns(channel);

	return {
		buffer,
		channel,
	};
}

export async function closeAllOpenFiles(): Promise<void> {
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
	await delay(100);
	logger.info(`Done closing editors!`);
	logOpenEditors();
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

export async function openFile(file: vs.Uri): Promise<vs.TextEditor> {
	logger.info(`Opening ${fsPath(file)}`);
	const doc = await vs.workspace.openTextDocument(file);
	documentEol = doc.eol === vs.EndOfLine.CRLF ? "\r\n" : "\n";
	logger.info(`Showing ${fsPath(file)}`);
	try {
		return await vs.window.showTextDocument(doc);
	} catch (e) {
		logger.warn(`Failed to show ${fsPath(file)} on first attempt, trying again...`, LogCategory.CI);
		logger.warn(e, LogCategory.CI);
		return await vs.window.showTextDocument(doc);
	} finally {
		await delay(100);
	}
}

export function tryDelete(file: vs.Uri) {
	tryDeleteFile(fsPath(file));
}

export function deleteDirectoryRecursive(folder: string) {
	if (!fs.existsSync(folder))
		return;
	if (!fs.statSync(folder).isDirectory()) {
		logger.error(`deleteDirectoryRecursive was passed a file: ${folder}`);
	}
	fs.readdirSync(folder)
		.map((item) => path.join(folder, item))
		.forEach((item) => {
			if (fs.statSync(item).isDirectory()) {
				deleteDirectoryRecursive(item);
			} else
				fs.unlinkSync(item);
		});
	fs.rmdirSync(folder);
}

export let currentTestName = "unknown";
export let fileSafeCurrentTestName: string = "unknown";
beforeEach("stash current test name", async function () {
	currentTestName = this.currentTest ? this.currentTest.fullTitle() : "unknown";
	fileSafeCurrentTestName = filenameSafe(currentTestName);

	deferUntilLast(() => fileSafeCurrentTestName = "unknown");
});

export let sb: sinon.SinonSandbox;
beforeEach("create sinon sandbox", () => {
	if (logger)
		logger.info(`Creating sinon sandbox`);
	sb = sinon.createSandbox();
});

before("throw if DART_CODE_IS_TEST_RUN is not set", () => {
	if (!process.env.DART_CODE_IS_TEST_RUN)
		throw new Error("DART_CODE_IS_TEST_RUN env var should be set for test runs.");
});

const deferredItems: Array<(result?: "failed" | "passed") => Promise<any> | any> = [];
const deferredToLastItems: Array<(result?: "failed" | "passed") => Promise<any> | any> = [];
afterEach("run deferred functions", async function () {
	let firstError: any;
	for (const d of [...deferredItems.reverse(), ...deferredToLastItems.reverse()]) {
		try {
			await watchPromise(`afterEach->deferred->${d.toString()}`, d(this.currentTest ? this.currentTest.state : undefined));
		} catch (e) {
			logger.error(`Error running deferred function: ${e}`);
			// TODO: Add named for deferred functions instead...
			logger.warn(d.toString());
			firstError = firstError || e;
		}
	}
	deferredItems.length = 0;
	deferredToLastItems.length = 0;
	// We delay throwing until the end so that other cleanup can run
	if (firstError)
		throw firstError;
});
export function defer(callback: (result?: "failed" | "passed") => Promise<any> | any): void {
	deferredItems.push(callback);
}
export function deferUntilLast(callback: (result?: "failed" | "passed") => Promise<any> | any): void {
	deferredToLastItems.push(callback);
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
	await delay(300);
	await extApi.currentAnalysis();
}

export async function uncommentTestFile(): Promise<void> {
	await setTestContent(currentDoc().getText().replace(/\n\/\/ /mg, "\n"));
}

export function getExpectedResults() {
	const start = positionOf("// == EXPECTED RESULTS ==^");
	const end = positionOf("^// == /EXPECTED RESULTS ==");
	const doc = vs.window.activeTextEditor!.document;
	const results = doc.getText(new vs.Range(start, end));
	return results.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.startsWith("// ") && !l.startsWith("// #")) // Allow "comment" lines within the comment
		.map((l) => l.substr(3))
		.join("\n");
}

export function select(range: vs.Range) {
	currentEditor().selection = new vs.Selection(range.start, range.end);
}

export async function executeOrganizeImportsCodeAction() {
	return executeCodeAction({ kind: vs.CodeActionKind.SourceOrganizeImports }, startOfDocument);
}

export async function executeSortMembersCodeAction() {
	return executeCodeAction({ kind: SourceSortMembersCodeActionKind }, startOfDocument);
}

export async function getCodeActions({ kind, title }: { kind?: vs.CodeActionKind, title?: string }, range: vs.Range) {
	const codeActions = await (vs.commands.executeCommand("vscode.executeCodeActionProvider", currentDoc().uri, range) as Thenable<vs.CodeAction[]>);
	const matchingActions = codeActions.filter((ca) => {
		return (!kind || kind.contains(ca.kind!))
			&& (!title || ca.title === title);
	});
	return matchingActions;
}
export async function executeCodeAction({ kind, title }: { kind?: vs.CodeActionKind, title?: string }, range: vs.Range) {
	const matchingActions = await getCodeActions({ kind, title }, range);
	assert.equal(matchingActions.length, 1);
	await waitForEditorChange(() => vs.commands.executeCommand(matchingActions[0].command!.command, ...matchingActions[0].command!.arguments!));
}

export function positionOf(searchText: string): vs.Position {
	// Normalise search text to match the document, since our literal template
	// strings in tests end up compiled as only \n on Windows even thouh the
	// source file is \r\n!
	searchText = searchText.replace(/\r/g, "").replace(/\n/g, documentEol);
	const doc = currentDoc();
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

export function rangesOf(searchText: string): vs.Range[] {
	const doc = currentDoc();
	const results = [];
	let searchRange: vs.Range | undefined;
	let range: vs.Range | undefined;
	// tslint:disable-next-line: no-conditional-assignment
	while (range = rangeOf(searchText, searchRange, true)) {
		results.push(range);
		// Next time, search starting from after this range.
		searchRange = new vs.Range(range.end, doc.positionAt(doc.getText().length));
	}
	return results;
}

export async function getDocumentSymbols(): Promise<Array<vs.DocumentSymbol & { parent: vs.DocumentSymbol | undefined }>> {
	const documentSymbolResult = await (vs.commands.executeCommand("vscode.executeDocumentSymbolProvider", currentDoc().uri) as Thenable<vs.DocumentSymbol[]>);
	if (!documentSymbolResult)
		return [];

	// Return a flattened list with references to parent for simplified testing.
	const resultWithEmptyParents = documentSymbolResult.map((c) => Object.assign(c, { parent: undefined as vs.DocumentSymbol | undefined }));
	return resultWithEmptyParents.concat(flatMap(
		documentSymbolResult,
		(s) => s.children ? s.children.map((c) => Object.assign(c, { parent: s })) : [],
	));
}

export async function getDefinitions(position: vs.Position): Promise<Array<vs.Location | vs.DefinitionLink>> {
	const definitionResult = await (vs.commands.executeCommand("vscode.executeDefinitionProvider", currentDoc().uri, position) as Thenable<Array<vs.Location | vs.DefinitionLink>>);
	return definitionResult || [];
}

export async function getCodeLens(document: vs.TextDocument): Promise<vs.CodeLens[]> {
	const fileCodeLens = await (vs.commands.executeCommand("vscode.executeCodeLensProvider", document.uri, 500) as Thenable<vs.CodeLens[]>);
	return fileCodeLens || [];
}

export async function getDefinition(position: vs.Position): Promise<vs.Location | vs.DefinitionLink> {
	const defs = await getDefinitions(position);
	assert.ok(defs && defs.length);
	return defs[0];
}

export function breakpointFor(def: vs.Location | vs.DefinitionLink) {
	return {
		line: rangeFor(def).start.line + 1,
		path: fsPath(uriFor(def)),
	};
}

export function uriFor(def: vs.Location | vs.DefinitionLink) {
	return "uri" in def ? def.uri : def.targetUri;
}

export function rangeFor(def: vs.Location | vs.DefinitionLink) {
	return "range" in def ? def.range : def.targetRange;
}

export async function getWorkspaceSymbols(query: string): Promise<vs.SymbolInformation[]> {
	const workspaceSymbolResult = await (vs.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", query) as Thenable<vs.SymbolInformation[]>);
	return workspaceSymbolResult || [];
}

export function waitForDiagnosticChange(resource?: vs.Uri): Promise<void> {
	return new Promise((resolve, reject) => {
		const disposable = vs.languages.onDidChangeDiagnostics((e) => {
			if (!resource || e.uris.find((r) => fsPath(r) === fsPath(resource))) {
				resolve();
				disposable.dispose();
			}
		});
	});
}

export async function acceptFirstSuggestion(): Promise<void> {
	// TODO: Can we make this better (we're essentially waiting to ensure resolve completed
	// before we accept, so that we don't insert the standard label without the extra
	// edits which are added in in resolve).
	await vs.commands.executeCommand("editor.action.triggerSuggest");
	await delay(6000);
	await waitForEditorChange(() => vs.commands.executeCommand("acceptSelectedSuggestion"));
	await delay(1000);
}

export function ensureInsertReplaceRanges(range: undefined | vs.Range | { inserting: vs.Range, replacing: vs.Range }, insertRangeMatch: string, replaceRangeMatch: string) {
	if (range && ("inserting" in range || "replacing" in range)) {
		assert.equal((range && "inserting" in range ? range.inserting : undefined)!.isEqual(rangeOf(insertRangeMatch)), true);
		assert.equal((range && "replacing" in range ? range.replacing : undefined)!.isEqual(rangeOf(replaceRangeMatch)), true);
	} else {
		assert.equal(range!.isEqual(rangeOf(replaceRangeMatch)), true);
	}
}

export function ensureError(errors: vs.Diagnostic[], text: string) {
	const error = errors.find((e) => e.message.indexOf(text) !== -1);
	assert.ok(
		error,
		`Couldn't find error for ${text} in\n`
		+ errors.map((e) => `        ${e.message}`).join("\n"),
	);
}

export function ensureWorkspaceSymbol(symbols: vs.SymbolInformation[], name: string, kind: vs.SymbolKind, containerName: string | undefined, uriOrMatch: vs.Uri | { endsWith?: string }): void {
	let symbol = symbols.find((f) =>
		f.name === name
		&& f.kind === kind
		&& (f.containerName || "") === (containerName || ""),
	);
	assert.ok(
		symbol,
		`Couldn't find symbol for ${name}/${vs.SymbolKind[kind]}/${containerName} in\n`
		+ symbols.map((s) => `        ${s.name}/${vs.SymbolKind[s.kind]}/${s.containerName}`).join("\n"),
	);
	symbol = symbol!;
	if (uriOrMatch instanceof vs.Uri)
		assert.equal(fsPath(symbol.location.uri), fsPath(uriOrMatch));
	else if (uriOrMatch.endsWith)
		assert.ok(fsPath(symbol.location.uri).endsWith(uriOrMatch.endsWith));
	else
		assert.equal(symbol.location.uri, uriOrMatch);
	assert.ok(symbol.location);
	if (extApi.isLsp)
		assert.ok(symbol.location.range);
	else // For non-LSP, we use resolve. This can be dropped when we're full LSP.
		assert.ok(!symbol.location.range);
}

export function ensureDocumentSymbol(symbols: Array<vs.DocumentSymbol & { parent: vs.DocumentSymbol | undefined }>, name: string, kind: vs.SymbolKind, parentName?: string): void {
	let symbol = symbols.find((f) =>
		f.name === name
		&& f.kind === kind
		&& (f.parent ? f.parent.name : "") === (parentName || ""),
	);
	assert.ok(
		symbol,
		`Couldn't find symbol for ${name}/${vs.SymbolKind[kind]}/${parentName} in\n`
		+ symbols.map((s) => `        ${s.name}/${vs.SymbolKind[s.kind]}/${s.parent ? s.parent.name : ""}`).join("\n"),
	);
	symbol = symbol!;
	const range = symbol.range;
	assert.ok(range);
	assert.ok(range.start);
	assert.ok(range.start.line);
	assert.ok(range.end);
	assert.ok(range.end.line);
}

export function rangeString(range: vs.Range) {
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

export async function getCompletionsAt(searchText: string, triggerCharacter?: string, resolveCount = 1): Promise<vs.CompletionItem[]> {
	const position = positionOf(searchText);
	const results = await (vs.commands.executeCommand("vscode.executeCompletionItemProvider", currentDoc().uri, position, triggerCharacter, resolveCount) as Thenable<vs.CompletionList>);
	return results.items;
}

export async function getSnippetCompletionsAt(searchText: string, triggerCharacter?: string): Promise<vs.CompletionItem[]> {
	const completions = await getCompletionsAt(searchText, triggerCharacter);
	return completions.filter((c) => c.kind === vs.CompletionItemKind.Snippet);
}

export function ensureCompletion(items: vs.CompletionItem[], kind: vs.CompletionItemKind, label: string, filterText?: string, documentation?: string): vs.CompletionItem {
	let completion = items.find((item) =>
		item.label === label
		&& (item.filterText === filterText || (item.filterText === undefined && filterText === label))
		&& item.kind === kind,
	);
	assert.ok(
		completion,
		`Couldn't find completion for ${label}/${filterText} in\n`
		+ items.map((item) => `        ${item.kind && vs.CompletionItemKind[item.kind]}/${item.label}/${item.filterText}`).join("\n"),
	);
	completion = completion!;
	if (documentation) {
		assert.equal((completion.documentation as any).value.trim(), documentation);
	}
	return completion;
}

export function ensureSnippet(items: vs.CompletionItem[], label: string, filterText: string, documentation?: string): void {
	ensureCompletion(items, vs.CompletionItemKind.Snippet, label, filterText, documentation);
}

export function ensureNoCompletion(items: vs.CompletionItem[], kind: vs.CompletionItemKind, label: string): void {
	const completion = items.find((item) =>
		(item.label === label || item.filterText === label)
		&& item.kind === kind,
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
	const doc = currentDoc();
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

export async function ensureTestSelection(expected: vs.Range): Promise<void> {
	const editor = currentEditor();
	assert.equal(editor.selection.isEqual(expected), true, `actual: ${rangeString(editor.selection)} (${editor.document.getText(editor.selection)}) vs expected: ${rangeString(expected)} (${editor.document.getText(expected)})`);
}

export async function ensureTestContentWithCursorPos(expected: string): Promise<void> {
	await ensureTestContent(expected.replace(/\^/g, ""));
	const pos = positionOf(expected);
	await ensureTestSelection(new vs.Range(pos, pos));
}

export async function ensureTestContentWithSelection(expected: string): Promise<void> {
	await ensureTestContent(expected.replace(/\|/g, ""));
	await ensureTestSelection(rangeOf(expected));
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

export async function waitForResult(action: () => boolean, message?: string, milliseconds: number = 6000, throwOnFailure = true): Promise<void> {
	const res = await waitFor(action, undefined, milliseconds);
	if (throwOnFailure && !res)
		throw new Error(`Action didn't return true within ${milliseconds}ms (${message})`);
}

export async function tryFor(action: () => Promise<void> | void, milliseconds: number = 3000): Promise<void> {
	let timeRemaining = milliseconds;
	while (timeRemaining > 0) {
		try {
			await action();
			return; // We succeeded, so return successfully.
		} catch {
			// Swallow the error so we can try again.
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
		timeRemaining -= 20;
	}
	// Run normally, so we get a good error message.
	await action();
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
	await extApi.currentAnalysis();
	// Get a new completer for the next analysis.
	const nextAnalysis = extApi.nextAnalysis();
	logger.info("Running requested action");
	await action();
	logger.info(`Waiting for analysis to complete`);
	await withTimeout(nextAnalysis, "Analysis did not complete within specified timeout", timeoutSeconds);
}

export async function withTimeout<T>(promise: Thenable<T>, message: string | (() => string), seconds: number = 360): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		// Set a timeout to reject the promise after the timout period.
		const timeoutTimer = setTimeout(() => {
			const msg = typeof message === "string" ? message : message();
			reject(new Error(`${msg} within ${seconds}s`));
		}, seconds * 1000);

		// When the main promise completes, cancel the timeout and return its result.
		promise.then((result) => {
			clearTimeout(timeoutTimer);
			resolve(result);
		});
	});
}

async function getResolvedDebugConfiguration(extraConfiguration?: { [key: string]: any }): Promise<vs.DebugConfiguration | undefined | null> {
	const debugConfig: vs.DebugConfiguration = Object.assign({}, {
		name: "Dart & Flutter",
		request: "launch",
		type: "dart",
	}, extraConfiguration);
	return await extApi.debugProvider.resolveDebugConfigurationWithSubstitutedVariables!(vs.workspace.workspaceFolders![0], debugConfig);
}

export async function getLaunchConfiguration(script?: vs.Uri | string, extraConfiguration?: { [key: string]: any }): Promise<vs.DebugConfiguration | undefined | null> {
	if (script instanceof vs.Uri)
		script = fsPath(script);
	const launchConfig = Object.assign({}, {
		program: script,
	}, extraConfiguration);
	return await getResolvedDebugConfiguration(launchConfig);
}

export async function getAttachConfiguration(extraConfiguration?: { [key: string]: any }): Promise<vs.DebugConfiguration | undefined | null> {
	const attachConfig = Object.assign({}, {
		request: "attach",
	}, extraConfiguration);
	return await getResolvedDebugConfiguration(attachConfig);
}

export async function writeBrokenDartCodeIntoFileForTest(file: vs.Uri): Promise<void> {
	const nextAnalysis = extApi.nextAnalysis();
	fs.writeFileSync(fsPath(file), "this is broken dart code");
	await nextAnalysis;
	// HACK: Sometimes we see analysis the analysis flag toggle quickly and we get an empty error list
	// so we need to add a small delay here and then wait for any in progress analysis.
	await delay(500);
	await extApi.currentAnalysis();
	defer(() => tryDelete(file));
}

export function deleteFileIfExists(filePath: string) {
	if (fs.existsSync(filePath)) {
		fs.unlinkSync(filePath);
	}
}

export function prepareHasRunFile(name: string) {
	const hasRunFile = path.join(fsPath(flutterBazelRoot), `scripts/has_run/${name}`);
	deleteFileIfExists(hasRunFile);
	return hasRunFile;
}

export function ensureHasRunRecently(name: string, allowedModificationSeconds = 60) {
	const hasRunFile = path.isAbsolute(name)
		? name
		: path.join(fsPath(flutterBazelRoot), `scripts/has_run/${name}`);
	assert.ok(fs.existsSync(hasRunFile));
	const lastModified = fs.statSync(hasRunFile).mtime;
	const modifiedSecondsAgo = (Date.now() - lastModified.getTime()) / 1000;
	assert.ok(modifiedSecondsAgo < allowedModificationSeconds, `File hasn't been modified for ${modifiedSecondsAgo} seconds`);
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
		const originalContents = fs.readFileSync(filePath);
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
export function watchPromise<T>(name: string, promise: Promise<T>): Promise<T> {
	// For convenience, this method might get wrapped around things that are not
	// promises.
	if (!promise || !promise.then || !promise.catch)
		return promise;
	let didComplete = false;
	// We'll log completion of the promise only if we'd logged that it was still in
	// progress at some point.
	let logCompletion = false;
	// tslint:disable-next-line: no-floating-promises
	promise.then((_) => {
		didComplete = true;
		if (logCompletion)
			logger.info(`Promise ${name} resolved!`, LogCategory.CI);
	});
	promise.catch((_) => {
		didComplete = true;
		if (logCompletion)
			logger.warn(`Promise ${name} rejected!`, LogCategory.CI);
	});

	const initialCheck = 3000;
	const subsequentCheck = 10000;
	const maxTime = 60000;
	let checkResult: (timeMS: number) => void;
	checkResult = (timeMS: number) => {
		if (didComplete)
			return;
		logCompletion = true;
		logger.info(`Promise ${name} is still unresolved!`, LogCategory.CI);
		if (timeMS > maxTime) {
			logger.error(`Promise ${name} not resolved after ${maxTime}ms so no longer watching!`, LogCategory.CI);
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
	const oldValue = values && values.globalValue;
	await conf.update(key, value, vs.ConfigurationTarget.Global);
	defer(() => conf.update(key, oldValue, vs.ConfigurationTarget.Global));
}

export async function addLaunchConfigsForTest(workspaceUri: vs.Uri, configs: any[]) {
	const launchConfig = vs.workspace.getConfiguration("launch", workspaceUri);
	const originalConfigs = launchConfig.get<any[]>("configurations") || [];
	logger.info(`Adding ${configs?.length} launch configs to the ${originalConfigs?.length} that already existed!`);
	const newConfigs = (originalConfigs || []).slice().concat(configs);
	await launchConfig.update("configurations", newConfigs);
	defer(async () => {
		logger.info(`Resetting back to ${originalConfigs?.length} original launch configs`);
		await launchConfig.update("configurations", originalConfigs.length ? originalConfigs : undefined);
		logger.info(`Done resetting back to ${originalConfigs?.length} original launch configs!`);
	});
}

export function clearAllContext(context: Context): Promise<void> {
	context.devToolsNotificationLastShown = undefined;
	context.devToolsNotificationDoNotShow = undefined;
	context.setFlutterSurveyNotificationLastShown(flutterTestSurveyID, undefined);
	context.setFlutterSurveyNotificationDoNotShow(flutterTestSurveyID, undefined);

	// HACK Updating context is async, but since we use setters we can't easily wait
	// and this is only test code...
	return new Promise((resolve) => setTimeout(resolve, 50));
}

export function ensurePackageTreeNode(items: vs.TreeItem[] | undefined | null, nodeContext: string, label: string, description?: string): vs.TreeItem {
	if (!items)
		throw new Error("No tree nodes found to check");

	const item = items.find((item) =>
		item.contextValue === nodeContext
		&& renderedItemLabel(item) === label,
	);
	if (!item)
		throw new Error(`Did not find item matching ${label}`);

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
	return item.label || path.basename(fsPath(item.resourceUri!));
}

export async function makeTextTree(parent: vs.TreeItem | vs.Uri | undefined, provider: vs.TreeDataProvider<vs.TreeItem>, includeDescription = true, buffer: string[] = [], indent = 0): Promise<string[]> {
	const parentNode = parent instanceof vs.TreeItem ? parent : undefined;
	const parentResourceUri = parent instanceof vs.Uri ? parent : undefined;

	const items = (await provider.getChildren(parentNode))!
		// Filter to only the suite we were given (though includes all children).
		.filter((item) => !parentResourceUri || fsPath(item.resourceUri!) === fsPath(parentResourceUri));
	for (const item of items) {
		// Suites don't have a .label (since the rendering is based on the resourceUri) so just
		// fabricate one here that can be compared in the test. Note: For simplity we always use
		// forward slashes in these names, since the comparison is against hard-coded comments
		// in the file that can only be on way.
		const expectedLabel = item.contextValue === DART_TEST_SUITE_NODE_CONTEXT
			? path.relative(
				fsPath(vs.workspace.getWorkspaceFolder(item.resourceUri!)!.uri),
				fsPath(item.resourceUri!),
			).replace("\\", "/")
			: item.label;
		const expectedDesc = includeDescription && item.description ? ` [${item.description}]` : "";
		const iconUri = item.iconPath instanceof vs.Uri
			? item.iconPath
			: "dark" in (item.iconPath as any)
				? (item.iconPath as any).dark
				: undefined;
		const iconFile = iconUri instanceof vs.Uri ? path.basename(fsPath(iconUri)).replace("_stale", "").replace("-dark", "") : "<unknown icon>";
		buffer.push(`${" ".repeat(indent * 4)}${expectedLabel}${expectedDesc} (${iconFile})`);
		await makeTextTree(item, provider, includeDescription, buffer, indent + 1);
	}
	return buffer;
}
