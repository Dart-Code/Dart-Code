import * as assert from "assert";
import * as fs from "fs";
import { tmpdir } from "os";
import * as path from "path";
import * as semver from "semver";
import * as vs from "vscode";
import { AnalyzerCapabilities } from "../src/analysis/analyzer";
import { DartRenameProvider } from "../src/providers/dart_rename_provider";
import { DebugConfigProvider } from "../src/providers/debug_config_provider";
import { Sdks, fsPath, vsCodeVersionConstraint } from "../src/utils";
import { logTo } from "../src/utils/log";
import sinon = require("sinon");

export const ext = vs.extensions.getExtension<{
	analyzerCapabilities: AnalyzerCapabilities,
	currentAnalysis: () => Promise<void>,
	debugProvider: DebugConfigProvider,
	nextAnalysis: () => Promise<void>,
	initialAnalysis: Promise<void>,
	reanalyze: () => void,
	renameProvider: DartRenameProvider,
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

export const isWin = /^win/.test(process.platform);
export const helloWorldFolder = vs.Uri.file(path.join(ext.extensionPath, "test/test_projects/hello_world"));
export const helloWorldMainFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/main.dart"));
export const helloWorldGettersFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/getters.dart"));
export const helloWorldBrokenFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/broken.dart"));
export const helloWorldGoodbyeFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/goodbye.dart"));
export const helloWorldHttpFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin/http.dart"));
export const helloWorldCreateMethodClassAFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/create_method/class_a.dart"));
export const helloWorldCreateMethodClassBFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/create_method/class_b.dart"));
export const emptyFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/empty.dart"));
export const everythingFile = vs.Uri.file(path.join(fsPath(helloWorldFolder), "lib/everything.dart"));
export const flutterHelloWorldFolder = vs.Uri.file(path.join(ext.extensionPath, "test/test_projects/flutter_hello_world"));
export const flutterEmptyFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/empty.dart"));
export const flutterHelloWorldMainFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/main.dart"));
export const flutterHelloWorldBrokenFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "lib/broken.dart"));
export const flutterTestMainFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test/widget_test.dart"));
export const flutterTestOtherFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test/other_test.dart"));
export const flutterTestBrokenFile = vs.Uri.file(path.join(fsPath(flutterHelloWorldFolder), "test/broken_test.dart"));

// TODO: Make these always return for the current active file (which is what many tests already use).
export let doc: vs.TextDocument;
export let editor: vs.TextEditor;
export let documentEol: string;
export let platformEol: string;

export async function activate(file: vs.Uri = emptyFile): Promise<void> {
	await ext.activate();
	await ext.exports.initialAnalysis;
	await ext.exports.currentAnalysis();
	await closeAllOpenFiles();
	doc = await vs.workspace.openTextDocument(file);
	editor = await vs.window.showTextDocument(doc);
	documentEol = doc.eol === vs.EndOfLine.CRLF ? "\r\n" : "\n";
	platformEol = isWin ? "\r\n" : "\n";
}

export async function getPackages() {
	await vs.commands.executeCommand("dart.getPackages", helloWorldFolder);
	const nextAnalysis = ext.exports.nextAnalysis();
	await ext.exports.reanalyze();
	await nextAnalysis;
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

export async function openFile(file: vs.Uri): Promise<vs.TextEditor> {
	return vs.window.showTextDocument(await vs.workspace.openTextDocument(file));
}

const deferredItems: Array<(result?: "failed" | "passed") => Promise<void> | void> = [];
// tslint:disable-next-line:only-arrow-functions
afterEach("run deferred functions", async function () {
	for (const d of deferredItems) {
		try {
			await d(this.currentTest.state);
		} catch (e) {
			console.error(`Error running deferred function: ${e}`);
			console.warn(d.toString());
			throw e;
		}
	}
	deferredItems.length = 0;
});
export function defer(callback: (result?: "failed" | "passed") => Promise<void> | void): void {
	deferredItems.push(callback);
}

export let sb: sinon.SinonSandbox;
beforeEach("create sinon sandbox", function () { sb = sinon.createSandbox(); }); // tslint:disable-line:only-arrow-functions
afterEach("destroy sinon sandbox", () => sb.restore());

beforeEach("set logger", async function () {
	const logFolder = process.env.DC_TEST_LOGS || path.join(ext.extensionPath, ".dart_code_test_logs");
	if (!fs.existsSync(logFolder))
		fs.mkdirSync(logFolder);
	const logFile = filenameSafe(this.currentTest.fullTitle()) + ".txt";
	const logPath = path.join(logFolder, logFile);

	const logger = logTo(logPath);

	defer(async (testResult: "passed" | "failed") => {
		await logger.dispose();
		// On CI, we delete logs for passing tests to save money on S3 :-)
		if (process.env.CI && testResult === "passed") {
			try {
				fs.unlinkSync(logPath);
			} catch { }
		}
	});
});

before("throw if DART_CODE_IS_TEST_RUN is not set", () => {
	if (!process.env.DART_CODE_IS_TEST_RUN)
		throw new Error("DART_CODE_IS_TEST_RUN env var should be set for test runs.");
});

export async function setTestContent(content: string): Promise<boolean> {
	const all = new vs.Range(
		doc.positionAt(0),
		doc.positionAt(doc.getText().length),
	);
	// TODO: May be able to replace this with
	// return editor.edit((eb) => eb.replace(all, content));
	// once the fix for https://github.com/dart-lang/sdk/issues/32914
	// has made it all the way through.
	return editor.edit((eb) => eb.replace(all, content));
}

export function select(range: vs.Range) {
	editor.selection = new vs.Selection(range.start, range.end);
}

export function positionOf(searchText: string): vs.Position {
	const doc = vs.window.activeTextEditor.document;
	const caretOffset = searchText.indexOf("^");
	assert.notEqual(caretOffset, -1, `Couldn't find a ^ in search text (${searchText})`);
	const matchedTextIndex = doc.getText().indexOf(searchText.replace("^", "").replace(/\n/g, documentEol));
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
	let matchedTextIndex = doc.getText().indexOf(searchText.replace(/\|/g, "").replace(/\n/g, documentEol), startSearchAt);
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

export async function getDefinitions(position: vs.Position): Promise<vs.Location[]> {
	const doc = vs.window.activeTextEditor.document;
	const definitionResult = await (vs.commands.executeCommand("vscode.executeDefinitionProvider", doc.uri, position) as Thenable<vs.Location[]>);
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

export function ensureCompletion(items: vs.CompletionItem[], kind: vs.CompletionItemKind, label: string, filterText?: string, documentation?: string): void {
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

export async function ensureTestContentWithCursorPos(expected: string): Promise<void> {
	await ensureTestContent(expected.replace("^", ""));
	await tryFor(() => assert.equal(doc.offsetAt(editor.selection.active), expected.indexOf("^")), 100);
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

export async function tryFor(action: () => Promise<void> | void, milliseconds: number = 2000): Promise<void> {
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
	const oldVersion = doc.version;
	await action();
	await waitFor(() => doc.version !== oldVersion);
}

export function filenameSafe(input: string) {
	return input.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}

async function getResolvedDebugConfiguration(extraConfiguration?: { [key: string]: any }): Promise<vs.DebugConfiguration> {
	const debugConfig: vs.DebugConfiguration = Object.assign({}, {
		name: "Dart & Flutter",
		request: "launch",
		type: "dart",
	}, extraConfiguration);
	return await ext.exports.debugProvider.resolveDebugConfiguration(vs.workspace.workspaceFolders[0], debugConfig);
}

export async function getLaunchConfiguration(script?: vs.Uri | string, extraConfiguration?: { [key: string]: any }): Promise<vs.DebugConfiguration> {
	if (script instanceof vs.Uri)
		script = fsPath(script);
	const launchConfig = Object.assign({}, {
		program: script,
	}, extraConfiguration);
	return await getResolvedDebugConfiguration(launchConfig);
}

export async function getAttachConfiguration(observatoryUri: string, extraConfiguration?: { [key: string]: any }): Promise<vs.DebugConfiguration> {
	const attachConfig = Object.assign({}, {
		observatoryUri,
		request: "attach",
	}, extraConfiguration);
	return await getResolvedDebugConfiguration(attachConfig);
}
