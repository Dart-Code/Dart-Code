import * as assert from "assert";
import * as fs from "fs";
import { tmpdir } from "os";
import * as path from "path";
import * as semver from "semver";
import * as sinon from "sinon";
import * as vs from "vscode";
import { LogCategory, LogSeverity } from "../extension/debug/utils";
import { DelayedCompletionItem } from "../extension/providers/dart_completion_item_provider";
import { isAnalyzable, vsCodeVersionConstraint } from "../extension/utils";
import { tryDeleteFile } from "../extension/utils/fs";
import { log, logError, logTo, logWarn } from "../extension/utils/log";
import { waitFor } from "../extension/utils/promises";
import { PackageDep } from "../extension/views/packages_view";
import { SuiteTreeItem } from "../extension/views/test_view";
import { dartCodeExtensionIdentifier } from "../shared/constants";
import { TestStatus } from "../shared/enums";
import { internalApiSymbol } from "../shared/symbols";
import { flatMap } from "../shared/utils";
import { InternalExtensionApi, TestItemTreeItem, TestResultsProvider } from "../shared/vscode/interfaces";
import { fsPath } from "../shared/vscode/utils";
import { Context } from "../shared/vscode/workspace";

export const ext = vs.extensions.getExtension(dartCodeExtensionIdentifier)!;
export let extApi: InternalExtensionApi;
export const threeMinutesInMilliseconds = 1000 * 60 * 3;
export const fakeCancellationToken: vs.CancellationToken = {
	isCancellationRequested: false,
	onCancellationRequested: (_) => ({ dispose: () => undefined }),
};

if (!ext) {
	if (semver.satisfies(vs.version, vsCodeVersionConstraint)) {
		logError("Quitting with error because extension failed to load.");
		process.exit(1);
	} else {
		logError("Skipping because extension failed to load due to requiring newer VS Code version.");
		logError(`    Required: ${vsCodeVersionConstraint}`);
		logError(`    Current: ${vs.version}`);
		process.exit(0);
	}
}

const testFolder = path.join(ext.extensionPath, "src/test");

// Dart
export const helloWorldFolder = vs.Uri.file(path.join(testFolder, "test_projects/hello_world"));
export const helloWorldMainFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/main.dart"));
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
export const helloWorldTestMainFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "test/basic_test.dart"));
export const helloWorldTestTreeFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "test/tree_test.dart"));
export const helloWorldTestDupeNameFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "test/dupe_name_test.dart"));
export const helloWorldTestBrokenFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "test/broken_test.dart"));
export const helloWorldTestSkipFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "test/skip_test.dart"));
// Flutter
export const flutterHelloWorldFolder = vs.Uri.file(path.join(testFolder, "test_projects/flutter_hello_world"));
export const flutterEmptyFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/empty.dart"));
export const flutterHelloWorldMainFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/main.dart"));
export const flutterHelloWorldExampleSubFolder = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "example"));
export const flutterHelloWorldExampleSubFolderMainFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldExampleSubFolder), "lib/main.dart"));
export const flutterHelloWorldBrokenFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/broken.dart"));
// Flutter tests
export const flutterTestMainFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test/widget_test.dart"));
export const flutterTestOtherFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test/other_test.dart"));
export const flutterTestAnotherFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test/another_test.dart"));
export const flutterTestBrokenFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test/broken_test.dart"));
// Flutter for Web
export const flutterWebProjectContainerFolder = vs.Uri.file(path.join(testFolder, "test_projects/flutter_web"));
export const flutterWebHelloWorldFolder = vs.Uri.file(path.join(fsPath(flutterWebProjectContainerFolder), "hello_world"));
export const flutterWebHelloWorldMainFile = vs.Uri.file(path.join(fsPath(flutterWebHelloWorldFolder), "lib/main.dart"));
export const flutterWebHelloWorldExampleSubFolder = vs.Uri.file(path.join(fsPath(flutterWebHelloWorldFolder), "example"));
export const flutterWebHelloWorldExampleSubFolderMainFile = vs.Uri.file(path.join(fsPath(flutterWebHelloWorldExampleSubFolder), "lib/main.dart"));
export const flutterWebBrokenFolder = vs.Uri.file(path.join(fsPath(flutterWebProjectContainerFolder), "broken"));
export const flutterWebBrokenMainFile = vs.Uri.file(path.join(fsPath(flutterWebBrokenFolder), "lib/main.dart"));
// Flutter for web tests
export const flutterWebTestMainFile = vs.Uri.file(path.join(fsPath(flutterWebHelloWorldFolder), "test/basic_test.dart"));
export const flutterWebTestBrokenFile = vs.Uri.file(path.join(fsPath(flutterWebHelloWorldFolder), "test/broken_test.dart"));
export const flutterWebTestOtherFile = vs.Uri.file(path.join(fsPath(flutterWebHelloWorldFolder), "test/other_test.dart"));

export function currentEditor(): vs.TextEditor {
	if (!vs.window.activeTextEditor)
		throw new Error("There is no active editor");
	return vs.window.activeTextEditor!;
}
export function currentDoc(): vs.TextDocument {
	if (!vs.window.activeTextEditor || !vs.window.activeTextEditor.document)
		throw new Error("There is no active document");
	return vs.window.activeTextEditor.document;
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
	log("Activating");
	await ext.activate();
	if (ext.exports)
		extApi = ext.exports[internalApiSymbol];
	else
		console.warn("Extension has no exports, it probably has not activated correctly! Check the extension startup logs.");
}

export async function activate(file?: vs.Uri | null | undefined): Promise<void> {
	await activateWithoutAnalysis();
	if (file === undefined) // undefined means use default, but explicit null will result in no file open.
		file = getDefaultFile();

	await closeAllOpenFiles();
	if (file) {
		await openFile(file);
	} else {
		log(`Not opening any file`);
	}
	log(`Waiting for initial and any in-progress analysis`);
	await extApi.initialAnalysis;
	// Opening a file above may start analysis after a short period so give it time to start
	// before we continue.
	await delay(200);
	await extApi.currentAnalysis();

	log(`Cancelling any in-progress requests`);
	extApi.cancelAllAnalysisRequests();

	log(`Ready to start test`);
}

export async function getPackages(uri?: vs.Uri) {
	log("Restoring packages and waiting for next analysis to complete");
	await activateWithoutAnalysis();
	if (!(uri || (vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length))) {
		logError("Cannot getPackages because there is no workspace folder and no URI was supplied");
		return;
	}
	await waitForNextAnalysis(async () => {
		await vs.commands.executeCommand("dart.getPackages", uri || vs.workspace.workspaceFolders![0].uri);
	}, 60);
}

function logOpenEditors() {
	log(`Current open editors are:`);
	if (vs.window.visibleTextEditors && vs.window.visibleTextEditors.length) {
		for (const editor of vs.window.visibleTextEditors) {
			log(`  - ${editor.document.uri}`);
		}
	} else {
		log(`  - (no open editors)`);
	}
}

export async function closeAllOpenFiles(): Promise<void> {
	log(`Closing all open editors...`);
	logOpenEditors();
	try {
		await withTimeout(
			vs.commands.executeCommand("workbench.action.closeAllEditors"),
			"closeAllEditors all editors did not complete",
			10,
		);
	} catch (e) {
		logWarn(e);
	}
	await delay(100);
	log(`Done closing editors!`);
	logOpenEditors();
}

export async function waitUntilAllTextDocumentsAreClosed(): Promise<void> {
	log(`Waiting for VS Code to mark all documents as closed...`);
	const getAllOpenDocs = () => vs.workspace.textDocuments.filter(isAnalyzable);
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
	log(`Opening ${fsPath(file)}`);
	const doc = await vs.workspace.openTextDocument(file);
	documentEol = doc.eol === vs.EndOfLine.CRLF ? "\r\n" : "\n";
	log(`Showing ${fsPath(file)}`);
	const editor = await vs.window.showTextDocument(doc);
	await delay(100);
	return editor;
}

export function tryDelete(file: vs.Uri) {
	tryDeleteFile(fsPath(file));
}

export function deleteDirectoryRecursive(folder: string) {
	if (!fs.existsSync(folder))
		return;
	if (!fs.statSync(folder).isDirectory()) {
		logError(`deleteDirectoryRecursive was passed a file: ${folder}`);
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
});

beforeEach("set logger", async function () {
	if (!this.currentTest)
		return;
	const logFolder = process.env.DC_TEST_LOGS || path.join(ext.extensionPath, ".dart_code_test_logs");
	if (!fs.existsSync(logFolder))
		fs.mkdirSync(logFolder);
	const logFile = filenameSafe(this.currentTest.fullTitle()) + ".txt";
	const logPath = path.join(logFolder, logFile);

	const logger = logTo(logPath);

	deferUntilLast(async (testResult?: "passed" | "failed") => {
		await logger.dispose();
		// On CI, we delete logs for passing tests to save money on S3 :-)
		if (process.env.CI && testResult === "passed") {
			try {
				fs.unlinkSync(logPath);
			} catch { }
		}
	});
});

export let sb: sinon.SinonSandbox;
beforeEach("create sinon sandbox", () => { sb = sinon.createSandbox(); });
afterEach("destroy sinon sandbox", () => sb.restore());
afterEach("make empty file empty", () => fs.writeFileSync(fsPath(emptyFile), ""));

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
			logError(`Error running deferred function: ${e}`);
			// TODO: Add named for deferred functions instead...
			logWarn(d.toString());
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

export async function setTestContent(content: string): Promise<void> {
	const doc = currentDoc();
	const all = new vs.Range(
		doc.positionAt(0),
		doc.positionAt(doc.getText().length),
	);
	// TODO: May be able to replace this with
	// return editor.edit((eb) => eb.replace(all, content));
	// once the fix for https://github.com/dart-lang/sdk/issues/32914
	// has made it all the way through.
	await currentEditor().edit((eb) => eb.replace(all, content));

	// HACK: Add a small delay to try and reduce the chance of a "Requested result
	// might be inconsistent with previously returned results" error.
	await delay(300);
	await extApi.currentAnalysis;
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

export function positionOf(searchText: string): vs.Position {
	// Normalise search text to match the document, since our literal template
	// strings in tests end up compiled as only \n on Windows even thouh the
	// source file is \r\n!
	searchText = searchText.replace(/\r/g, "").replace(/\n/g, documentEol);
	const doc = currentDoc();
	const caretOffset = searchText.indexOf("^");
	assert.notEqual(caretOffset, -1, `Couldn't find a ^ in search text (${searchText})`);
	const docText = doc.getText();
	const matchedTextIndex = docText.indexOf(searchText.replace("^", ""));
	assert.notEqual(matchedTextIndex, -1, `Couldn't find string ${searchText.replace("^", "")} in the document to get position of. Document contained:\n${docText}`);

	return doc.positionAt(matchedTextIndex + caretOffset);
}

export function rangeOf(searchText: string, inside?: vs.Range): vs.Range {
	const doc = currentDoc();
	const startOffset = searchText.indexOf("|");
	assert.notEqual(startOffset, -1, `Couldn't find a | in search text (${searchText})`);
	const endOffset = searchText.lastIndexOf("|");
	assert.notEqual(endOffset, -1, `Couldn't find a second | in search text (${searchText})`);

	const startSearchAt = inside ? doc.offsetAt(inside.start) : 0;
	const endSearchAt = inside ? doc.offsetAt(inside.end) : -1;
	const docText = doc.getText();
	let matchedTextIndex = docText.indexOf(searchText.replace(/\|/g, "").replace(/\n/g, documentEol), startSearchAt);
	if (endSearchAt > -1 && matchedTextIndex > endSearchAt)
		matchedTextIndex = -1;
	assert.notEqual(matchedTextIndex, -1, `Couldn't find string ${searchText.replace(/\|/g, "")} in the document to get range of. Document contained:\n${docText}`);

	return new vs.Range(
		doc.positionAt(matchedTextIndex + startOffset),
		doc.positionAt(matchedTextIndex + endOffset - 1),
	);
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

export async function getDefinitions(position: vs.Position): Promise<vs.Location[]> {
	const definitionResult = await (vs.commands.executeCommand("vscode.executeDefinitionProvider", currentDoc().uri, position) as Thenable<vs.Location[]>);
	return definitionResult || [];
}

export async function getDefinition(position: vs.Position): Promise<vs.Location> {
	const defs = await getDefinitions(position);
	assert.ok(defs && defs.length);
	return defs[0];
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

export function ensureError(errors: vs.Diagnostic[], text: string) {
	const error = errors.find((e) => e.message.indexOf(text) !== -1);
	assert.ok(
		error,
		`Couldn't find error for ${text} in\n`
		+ errors.map((e) => `        ${e.message}`).join("\n"),
	);
}

export function ensureWorkspaceSymbol(symbols: vs.SymbolInformation[], name: string, kind: vs.SymbolKind, containerName: string, uriOrMatch: vs.Uri | { endsWith?: string }): void {
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

export async function getCompletionsAt(searchText: string, triggerCharacter?: string): Promise<vs.CompletionItem[]> {
	const position = positionOf(searchText);
	const results = await (vs.commands.executeCommand("vscode.executeCompletionItemProvider", currentDoc().uri, position, triggerCharacter) as Thenable<vs.CompletionList>);
	return results.items;
}

export async function getCompletionsViaProviderAt(searchText: string, triggerCharacter?: string): Promise<vs.CompletionItem[]> {
	const position = positionOf(searchText);
	const results = await extApi.completionItemProvider.provideCompletionItems(
		currentDoc(),
		position,
		undefined,
		{ triggerCharacter, triggerKind: triggerCharacter ? vs.CompletionTriggerKind.TriggerCharacter : vs.CompletionTriggerKind.Invoke },
	) as vs.CompletionList;

	return results.items;
}

export async function getSnippetCompletionsAt(searchText: string, triggerCharacter?: string): Promise<vs.CompletionItem[]> {
	const completions = await getCompletionsAt(searchText, triggerCharacter);
	return completions.filter((c) => c.kind === vs.CompletionItemKind.Snippet);
}

export function ensureCompletion(items: vs.CompletionItem[], kind: vs.CompletionItemKind, label: string, filterText?: string, documentation?: string): vs.CompletionItem {
	let completion = items.find((item) =>
		item.label === label
		&& item.filterText === filterText
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

export async function resolveCompletion(completion: vs.CompletionItem): Promise<vs.CompletionItem> {
	const resolved = await extApi.completionItemProvider.resolveCompletionItem(completion as DelayedCompletionItem, undefined);
	return resolved || completion;
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

export async function ensureTestContent(expected: string): Promise<void> {
	const doc = currentDoc();
	// Wait for a short period before checking to reduce changes of flaky tests.
	await waitForResult(() =>
		doc.getText().replace(/\r/g, "").trim() === expected.replace(/\r/g, "").trim(),
		"Document content did not match expected",
		100,
		false,
	);
	assert.equal(doc.getText().replace(/\r/g, "").trim(), expected.replace(/\r/g, "").trim());
}

export async function ensureTestSelection(expected: vs.Range): Promise<void> {
	const editor = currentEditor();
	assert.equal(editor.selection.isEqual(expected), true, `${rangeString(editor.selection)} vs ${rangeString(expected)}`);
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

export async function waitForResult(action: () => boolean, message?: string, milliseconds: number = 3000, throwOnFailure = true): Promise<void> {
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
	log("Waiting for any in-progress analysis to complete");
	await extApi.currentAnalysis;
	// Get a new completer for the next analysis.
	const nextAnalysis = extApi.nextAnalysis();
	log("Running requested action");
	await action();
	log(`Waiting for analysis to complete`);
	await withTimeout(nextAnalysis, "Analysis did not complete within specified timeout", timeoutSeconds);
}

export async function withTimeout<T>(promise: Thenable<T>, message: string | (() => string), seconds: number = 120): Promise<T> {
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

// This same logic exists in the website to link back to logs.
export function filenameSafe(input: string) {
	return input.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}

async function getResolvedDebugConfiguration(extraConfiguration?: { [key: string]: any }): Promise<vs.DebugConfiguration | undefined | null> {
	const debugConfig: vs.DebugConfiguration = Object.assign({}, {
		name: "Dart & Flutter",
		request: "launch",
		type: "dart",
	}, extraConfiguration);
	return await extApi.debugProvider.resolveDebugConfiguration(vs.workspace.workspaceFolders![0], debugConfig);
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
	await extApi.currentAnalysis;
	defer(() => tryDelete(file));
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
	promise.then((_) => {
		didComplete = true;
		if (logCompletion)
			log(`Promise ${name} resolved!`, LogSeverity.Info, LogCategory.CI);
	});
	promise.catch((_) => {
		didComplete = true;
		if (logCompletion)
			log(`Promise ${name} rejected!`, LogSeverity.Warn, LogCategory.CI);
	});

	let checkResult: () => void;
	checkResult = () => {
		if (didComplete)
			return;
		logCompletion = true;
		log(`Promise ${name} is still unresolved!`, LogSeverity.Info, LogCategory.CI);
		setTimeout(checkResult, 10000);
	};
	setTimeout(checkResult, 3000); // First log is after 3s, rest are 10s.

	return promise;
}

export async function setConfigForTest(section: string, key: string, value: any): Promise<void> {
	const conf = vs.workspace.getConfiguration(section);
	const values = conf.inspect(key);
	const oldValue = values && values.globalValue;
	await conf.update(key, value, vs.ConfigurationTarget.Global);
	defer(() => conf.update(key, oldValue, vs.ConfigurationTarget.Global));
}

export function clearAllContext(context: Context): Promise<void> {
	context.devToolsNotificationsShown = undefined;
	context.devToolsNotificationLastShown = undefined;
	context.devToolsNotificationDoNotShow = undefined;
	context.flutterSurvey2019Q2NotificationLastShown = undefined;
	context.flutterSurvey2019Q2NotificationDoNotShow = undefined;

	// HACK Updating context is async, but since we use setters we can't easily wait
	// and this is only test code...
	return new Promise((resolve) => setTimeout(resolve, 50));
}

export function ensurePackageTreeNode<T extends PackageDep>(items: PackageDep[], constructor: new (...args: any[]) => T, label: string, description?: string): T {
	const item = items.find((item) =>
		item.constructor === constructor
		&& renderedItemLabel(item) === label,
	);
	if (description)
		assert.equal(item.description, description);
	assert.ok(
		item,
		`Couldn't find ${constructor.name} tree node for ${label} in\n`
		+ items.map((item) => `        ${item.constructor.name}/${renderedItemLabel(item)}`).join("\n"),
	);
	return item as T;
}

export function renderedItemLabel(item: PackageDep): string {
	return item.label || path.basename(fsPath(item.resourceUri));
}

export async function makeTextTree(suite: vs.Uri, provider: TestResultsProvider, parent?: TestItemTreeItem, buffer: string[] = [], indent = 0): Promise<string[]> {
	const items = (await provider.getChildren(parent))
		// Filter to only the suite we were given (though includes all children).
		.filter((item) => (fsPath(item.resourceUri!) === fsPath(suite)) || !!parent);
	const wsPath = fsPath(vs.workspace.getWorkspaceFolder(suite)!.uri);
	items.forEach(async (item) => {
		// Suites don't have a .label (since the rendering is based on the resourceUri) so just
		// fabricate one here that can be compared in the test. Note: For simplity we always use
		// forward slashes in these names, since the comparison is against hard-coded comments
		// in the file that can only be on way.
		const expectedLabel = item instanceof SuiteTreeItem
			? path.relative(wsPath, fsPath(item.resourceUri!)).replace("\\", "/")
			: item.label;
		buffer.push(`${" ".repeat(indent * 4)}${expectedLabel} (${TestStatus[item.status]})`);
		await makeTextTree(suite, provider, item, buffer, indent + 1);
	});
	return buffer;
}
