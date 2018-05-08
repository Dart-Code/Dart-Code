import * as assert from "assert";
import * as fs from "fs";
import { tmpdir } from "os";
import * as path from "path";
import * as semver from "semver";
import * as vs from "vscode";
import { AnalyzerCapabilities } from "../src/analysis/analyzer";
import { DebugConfigProvider } from "../src/providers/debug_config_provider";
import { Sdks, fsPath, vsCodeVersionConstraint } from "../src/utils";
import sinon = require("sinon");

export const ext = vs.extensions.getExtension<{
	analyzerCapabilities: AnalyzerCapabilities,
	debugProvider: DebugConfigProvider,
	nextAnalysis: () => Promise<void>,
	initialAnalysis: Promise<void>,
	sdks: Sdks,
}>("Dart-Code.dart-code");

if (!ext) {
	if (semver.satisfies(vs.version, vsCodeVersionConstraint)) {
		console.error("Quitting with error because extension failed to load.");
		process.exit(1);
	} else {
		console.error("Skipping because extension failed to load due to requiring newer VS Code version.");
		console.error(`    Required: ${vsCodeVersionConstraint}`);
		console.error(`    Current: ${vs.version}`);
		process.exit(0);
	}
}

export const helloWorldFolder = vs.Uri.file(path.join(ext.extensionPath, "test/test_projects/hello_world"));
export const helloWorldMainFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/main.dart"));
export const helloWorldBrokenFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/broken.dart"));
export const helloWorldGoodbyeFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/goodbye.dart"));
export const emptyFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/empty.dart"));
export const everythingFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/everything.dart"));
export const flutterHelloWorldFolder = vs.Uri.file(path.join(ext.extensionPath, "test/test_projects/flutter_hello_world"));
export const flutterEmptyFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/empty.dart"));
export const flutterHelloWorldMainFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/main.dart"));
export const flutterHelloWorldBrokenFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/broken.dart"));
export const flutterTestMainFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test/widget_test.dart"));
export const flutterTestOtherFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test/other_test.dart"));
export const flutterTestBrokenFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test/broken_test.dart"));

export let doc: vs.TextDocument;
export let editor: vs.TextEditor;
export let eol: string;

export async function activate(file: vs.Uri = emptyFile): Promise<void> {
	await ext.activate();
	await ext.exports.initialAnalysis;
	await closeAllOpenFiles();
	doc = await vs.workspace.openTextDocument(file);
	editor = await vs.window.showTextDocument(doc);
	eol = doc.eol === vs.EndOfLine.CRLF ? "\r\n" : "\n";
}

export async function closeAllOpenFiles(): Promise<void> {
	while (vs.window.activeTextEditor) {
		await vs.commands.executeCommand("workbench.action.closeActiveEditor");
	}
}

export async function closeFile(file: vs.Uri): Promise<void> {
	for (const editor of vs.window.visibleTextEditors) {
		if (editor.document.uri === file) {
			await vs.window.showTextDocument(editor.document);
			await vs.commands.executeCommand("workbench.action.closeActiveEditor");
		}
	}
}

export async function openFile(file: vs.Uri): Promise<void> {
	await vs.window.showTextDocument(await vs.workspace.openTextDocument(file));
}

const deferredItems: Array<(result?: "failed" | "passed") => Promise<void> | void> = [];
// tslint:disable-next-line:only-arrow-functions
afterEach(async function () {
	for (const d of deferredItems) {
		await d(this.currentTest.state);
	}
	deferredItems.length = 0;
});
export function defer(callback: (result?: "failed" | "passed") => Promise<void> | void): void {
	deferredItems.push(callback);
}

export let sb: sinon.SinonSandbox;
beforeEach(function () { sb = sinon.createSandbox(); }); // tslint:disable-line:only-arrow-functions
afterEach(() => sb.restore());

// Set up log files for individual test logging.
// tslint:disable-next-line:only-arrow-functions
beforeEach(async function () {
	const logFolder = process.env.DC_TEST_LOGS || path.join(ext.extensionPath, ".dart_code_test_logs");
	if (!fs.existsSync(logFolder))
		fs.mkdirSync(logFolder);
	const prefix = filenameSafe(this.currentTest.fullTitle()) + "_";

	await setLogs(
		vs.workspace.getConfiguration("dart"),
		logFolder,
		prefix,
		["analyzer", "flutterDaemon"],
	);
	await setLogs(
		vs.workspace.getConfiguration("dart", vs.workspace.workspaceFolders[0].uri),
		logFolder,
		prefix,
		["observatory", "flutterRun", "flutterTest"],
	);

	// HACK: Give config time to reload
	await delay(50);
});

before(() => {
	if (!process.env.DART_CODE_IS_TEST_RUN)
		throw new Error("DART_CODE_IS_TEST_RUN env var should be set for test runs.");
});

async function setLogs(conf: vs.WorkspaceConfiguration, logFolder: string, prefix: string, logFiles: string[]): Promise<void> {
	for (const logFile of logFiles) {
		const key = logFile + "LogFile";
		const logPath = path.join(logFolder, `${prefix}${logFile}.txt`);
		const oldValue = conf.get<string>(key);
		await conf.update(key, logPath);
		defer(async (testResult: "passed" | "failed") => {
			if (testResult === "passed") {
				try {
					fs.unlinkSync(logPath);
				} catch { }
			}
			await conf.update(key, oldValue);
		});
	}
}

export async function setTestContent(content: string): Promise<void> {
	const all = new vs.Range(
		doc.positionAt(0),
		doc.positionAt(doc.getText().length),
	);
	// TODO: May be able to replace this with
	// return editor.edit((eb) => eb.replace(all, content));
	// once the fix for https://github.com/dart-lang/sdk/issues/32914
	// has made it all the way through.
	if (await editor.edit((eb) => eb.replace(all, content))) {
		// Wait a short period for the server to process the update
		await delay(100);
	} else {
		throw new Error("Edits not applied!");
	}
}

export function positionOf(searchText: string): vs.Position {
	const doc = vs.window.activeTextEditor.document;
	const caretOffset = searchText.indexOf("^");
	assert.notEqual(caretOffset, -1, `Couldn't find a ^ in search text (${searchText})`);
	const matchedTextIndex = doc.getText().indexOf(searchText.replace("^", "").replace(/\n/g, eol));
	assert.notEqual(matchedTextIndex, -1, `Couldn't find string ${searchText.replace("^", "")} in the document to get position of`);

	return doc.positionAt(matchedTextIndex + caretOffset);
}

export function rangeOf(searchText: string, inside?: vs.Range): vs.Range {
	const doc = vs.window.activeTextEditor.document;
	const startOffset = searchText.indexOf("|");
	assert.notEqual(startOffset, -1, `Couldn't find a | in search text (${searchText})`);
	const endOffset = searchText.lastIndexOf("|");
	assert.notEqual(endOffset, -1, `Couldn't find a second | in search text (${searchText})`);

	const startSearchAt = inside ? doc.offsetAt(inside.start) : 0;
	const endSearchAt = inside ? doc.offsetAt(inside.end) : -1;
	let matchedTextIndex = doc.getText().indexOf(searchText.replace(/\|/g, "").replace(/\n/g, eol), startSearchAt);
	if (endSearchAt > -1 && matchedTextIndex > endSearchAt)
		matchedTextIndex = -1;
	assert.notEqual(matchedTextIndex, -1, `Couldn't find string ${searchText.replace(/\|/g, "")} in the document to get range of`);

	return new vs.Range(
		doc.positionAt(matchedTextIndex + startOffset),
		doc.positionAt(matchedTextIndex + endOffset - 1),
	);
}

export async function getDocumentSymbols(): Promise<vs.SymbolInformation[]> {
	const documentSymbolResult = await (vs.commands.executeCommand("vscode.executeDocumentSymbolProvider", doc.uri) as Thenable<vs.SymbolInformation[]>);
	return documentSymbolResult || [];
}

export async function getWorkspaceSymbols(query: string): Promise<vs.SymbolInformation[]> {
	const workspaceSymbolResult = await (vs.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", query) as Thenable<vs.SymbolInformation[]>);
	return workspaceSymbolResult || [];
}

export function waitForDiagnosticChange(resource?: vs.Uri): Promise<void> {
	return new Promise((resolve, reject) => {
		const disposable = vs.languages.onDidChangeDiagnostics((e) => {
			console.log("test");
			if (!resource || e.uris.find((r) => fsPath(r) === fsPath(resource))) {
				resolve();
				disposable.dispose();
			}
		});
	});
}

export function ensureError(errors: vs.Diagnostic[], text: string) {
	const error = errors.find((e) => e.message.indexOf(text) !== -1);
	assert.ok(
		error,
		`Couldn't find error for ${text} in\n`
		+ errors.map((e) => `        ${e.message}`).join("\n"),
	);
}

export function ensureSymbol(symbols: vs.SymbolInformation[], name: string, kind: vs.SymbolKind, containerName: string, uri: vs.Uri = doc.uri): void {
	const symbol = symbols.find((f) =>
		f.name === name
		&& f.kind === kind
		&& f.containerName === containerName,
	);
	assert.ok(
		symbol,
		`Couldn't find symbol for ${name}/${vs.SymbolKind[kind]}/${containerName} in\n`
		+ symbols.map((s) => `        ${s.name}/${vs.SymbolKind[s.kind]}/${s.containerName}`).join("\n"),
	);
	assert.equal(fsPath(symbol.location.uri), fsPath(uri));
	assert.ok(symbol.location);
	assert.ok(symbol.location.range);
	assert.ok(symbol.location.range.start);
	assert.ok(symbol.location.range.start.line);
	assert.ok(symbol.location.range.end);
	assert.ok(symbol.location.range.end.line);
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
	const results = await (vs.commands.executeCommand("vscode.executeCompletionItemProvider", doc.uri, position, triggerCharacter) as Thenable<vs.CompletionList>);
	return results.items;
}

export async function getSnippetCompletionsAt(searchText: string, triggerCharacter?: string): Promise<vs.CompletionItem[]> {
	const completions = await getCompletionsAt(searchText, triggerCharacter);
	return completions.filter((c) => c.kind === vs.CompletionItemKind.Snippet);
}

export function ensureCompletion(items: vs.CompletionItem[], kind: vs.CompletionItemKind, label: string, filterText: string, documentation?: string): void {
	const completion = items.find((item) =>
		item.label === label
		&& item.filterText === filterText
		&& item.kind === kind,
	);
	assert.ok(
		completion,
		`Couldn't find completion for ${label}/${filterText} in\n`
		+ items.map((item) => `        ${vs.CompletionItemKind[item.kind]}/${item.label}/${item.filterText}`).join("\n"),
	);
	if (documentation) {
		assert.equal(((completion.documentation as any).value as string).trim(), documentation);
	}
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
	// Wait for a short period before checking to reduce changes of flaky tests.
	await waitFor(() =>
		doc.getText().replace(/\r/g, "").trim() === expected.replace(/\r/g, "").trim(),
		"Document content did not match expected",
		100,
		false,
	);
	assert.equal(doc.getText().replace(/\r/g, "").trim(), expected.replace(/\r/g, "").trim());
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

export async function waitFor(action: () => boolean, message?: string, milliseconds: number = 2000, throwOnFailure = true): Promise<void> {
	let timeRemaining = milliseconds;
	while (timeRemaining > 0) {
		if (action())
			return;
		await new Promise((resolve) => setTimeout(resolve, 20));
		timeRemaining -= 20;
	}
	if (throwOnFailure)
		throw new Error("Action didn't return true within specified timeout" + (message ? ` (${message})` : ""));
}

export async function waitForEditorChange(action: () => Thenable<void>): Promise<void> {
	const oldVersion = doc.version;
	await action();
	await waitFor(() => doc.version !== oldVersion);
}

export function filenameSafe(input: string) {
	return input.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}
