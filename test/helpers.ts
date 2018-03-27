import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { EOL, tmpdir } from "os";
import { Sdks } from "../src/utils";
import { AnalyzerCapabilities } from "../src/analysis/analyzer";

export const ext = vs.extensions.getExtension<{
	analysisComplete: Promise<void>,
	analyzerCapabilities: AnalyzerCapabilities,
	sdks: Sdks,
}>("Dart-Code.dart-code");
export const helloWorldFolder = vs.Uri.file(path.join(ext.extensionPath, "test/test_projects/hello_world"));
export const emptyFile = vs.Uri.file(path.join(helloWorldFolder.fsPath, "lib/empty.dart"));
export const everythingFile = vs.Uri.file(path.join(helloWorldFolder.fsPath, "lib/everything.dart"));
export const flutterHelloWorldFolder = vs.Uri.file(path.join(ext.extensionPath, "test/test_projects/flutter_hello_world"));
export const flutterEmptyFile = vs.Uri.file(path.join(flutterHelloWorldFolder.fsPath, "lib/empty.dart"));
export const flutterHelloWorldMainFile = vs.Uri.file(path.join(flutterHelloWorldFolder.fsPath, "lib/main.dart"));

export let doc: vs.TextDocument;
export let editor: vs.TextEditor;
export let eol: string;

export async function activate(file: vs.Uri = emptyFile): Promise<void> {
	await ext.activate();
	await ext.exports.analysisComplete;
	doc = await vs.workspace.openTextDocument(file);
	editor = await vs.window.showTextDocument(doc);
	eol = doc.eol === vs.EndOfLine.CRLF ? "\r\n" : "\n";
}

export function setTestContent(content: string): Thenable<boolean> {
	const all = new vs.Range(
		doc.positionAt(0),
		doc.positionAt(doc.getText().length),
	);
	return editor.edit((eb) => eb.replace(all, content));
}

export function getPositionOf(searchText: string): vs.Position {
	const caretOffset = searchText.indexOf("^");
	assert.notEqual(caretOffset, -1, `Couldn't find a ^ in search text (${searchText})`);
	const matchedTextIndex = doc.getText().indexOf(searchText.replace("^", "").replace(/\n/g, eol));
	assert.notEqual(matchedTextIndex, -1, `Couldn't find string ${searchText.replace("^", "")} in the document to get position of`);

	return doc.positionAt(matchedTextIndex + caretOffset);
}

export function rangeAt(startLine: number, startCharacter: number, endLine: number, endCharacter: number): vs.Range {
	return new vs.Range(new vs.Position(startLine, startCharacter), new vs.Position(endLine, endCharacter));
}

export function rangeOf(searchText: string): vs.Range {
	const startOffset = searchText.indexOf("|");
	assert.notEqual(startOffset, -1, `Couldn't find a | in search text (${searchText})`);
	const endOffset = searchText.lastIndexOf("|");
	assert.notEqual(endOffset, -1, `Couldn't find a second | in search text (${searchText})`);

	const matchedTextIndex = doc.getText().indexOf(searchText.replace(/\|/g, "").replace(/\n/g, eol));
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
	assert.deepStrictEqual(symbol.location.uri.fsPath, uri.fsPath);
	assert.ok(symbol.location);
	// Ensure we have a range, but don't check specifically what it is (this will make the test fragile and the range mapping is trivial)
	assert.ok(symbol.location.range);
	assert.ok(symbol.location.range.start);
	assert.ok(symbol.location.range.start.line);
	assert.ok(symbol.location.range.end);
	assert.ok(symbol.location.range.end.line);
}

export async function getCompletionsAt(searchText: string, triggerCharacter?: string): Promise<vs.CompletionItem[]> {
	const position = getPositionOf(searchText);
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

export async function ensureTestContent(expected: string) {
	// Wait for a short period before checking to reduce changes of flaky tests.
	await delay(50);
	const actual = doc.getText();
	assert.equal(actual.replace(/\r/g, "").trim(), expected.replace(/\r/g, "").trim());
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

export async function waitFor(action: () => boolean, milliseconds: number): Promise<void> {
	let timeRemaining = milliseconds;
	while (timeRemaining > 0) {
		if (action())
			return;
		await new Promise((resolve) => setTimeout(resolve, 100));
		timeRemaining -= 100;
	}
	throw new Error("Action didn't return true within specified timeout");
}
