import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { activate, doc, setTestContent, getSnippetCompletionsAt, ensureSnippet, eol, ensureNoSnippet, emptyFile, flutterEmptyFile } from "../../helpers";

describe("snippet_provider", () => {

	before(() => activate(flutterEmptyFile));

	it("returns dart items", async () => {
		await setTestContent("mai");
		const snippets = await getSnippetCompletionsAt("mai^");
		ensureSnippet(snippets, "class", "class", `\`\`\`${eol}class \${1:Name} {${eol}  $2${eol}}${eol}\`\`\``);
		ensureSnippet(snippets, "main", "main", `\`\`\`${eol}main(List<String> args) {${eol}  $1${eol}}${eol}\`\`\``);
	});

	it("returns flutter items", async () => {
		await setTestContent("stf");
		const snippets = await getSnippetCompletionsAt("stf^");
		ensureSnippet(snippets, "Flutter stateful widget", "stful");
	});
});
