import { strict as assert } from "assert";
import * as fs from "fs";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { waitFor } from "../../../shared/utils/promises";
import { activate, currentDoc, defer, extApi, helloWorldPubspec, rangeOf, sb, setTestContent, waitForNextAnalysis } from "../../helpers";

describe("pub add", () => {
	const pubspecPath = fsPath(helloWorldPubspec);
	beforeEach("activate", () => activate());
	beforeEach("ensure pubspec resets", () => {
		const contents = fs.readFileSync(pubspecPath);
		defer(() => fs.writeFileSync(pubspecPath, contents));
	});

	function pubspecContainsPackage(packageName: string) {
		const contents = fs.readFileSync(pubspecPath);
		return contents.includes(`  ${packageName}:`);
	}

	function pubspecContainsText(text: string) {
		const contents = fs.readFileSync(pubspecPath);
		return contents.includes(text);
	}

	it("can add a dependency using command", async () => {
		assert.equal(pubspecContainsPackage("collection"), false);
		sb.stub(extApi.addDependencyCommand, "promptForPackageInfo").resolves("collection");

		await vs.commands.executeCommand("dart.addDependency");
		await waitFor(() => pubspecContainsPackage("collection"));
		assert.equal(pubspecContainsPackage("collection"), true);
	});

	it("can add a dev-dependency using command", async () => {
		assert.equal(pubspecContainsPackage("collection"), false);
		sb.stub(extApi.addDependencyCommand, "promptForPackageInfo").resolves("collection");

		await vs.commands.executeCommand("dart.addDevDependency");
		await waitFor(() => pubspecContainsPackage("collection"));
		assert.equal(pubspecContainsPackage("collection"), true);
	});

	it("can add a dependency by URL by pasting", async () => {
		assert.equal(pubspecContainsPackage("timing"), false);
		sb.stub(extApi.addDependencyCommand, "promptForPackageInfo").resolves("https://github.com/dart-lang/timing");
		sb.stub(extApi.addDependencyCommand, "promptForPackageName").resolves("timing");
		sb.stub(extApi.addDependencyCommand, "promptForGitRef").resolves("");
		sb.stub(extApi.addDependencyCommand, "promptForGitPath").resolves("");

		await vs.commands.executeCommand("dart.addDependency");
		await waitFor(() => pubspecContainsText("git: https://github.com/dart-lang/timing"));
		assert.equal(pubspecContainsPackage("timing"), true);
		assert.equal(pubspecContainsText("git: https://github.com/dart-lang/timing"), true);
	});

	it("can add a dependency by URL by selecting pasting", async () => {
		assert.equal(pubspecContainsPackage("timing"), false);
		sb.stub(extApi.addDependencyCommand, "promptForPackageInfo").resolves({ marker: "GIT" });
		sb.stub(extApi.addDependencyCommand, "promptForGitUrl").resolves("https://github.com/dart-lang/timing");
		sb.stub(extApi.addDependencyCommand, "promptForPackageName").resolves("timing");
		sb.stub(extApi.addDependencyCommand, "promptForGitRef").resolves("");
		sb.stub(extApi.addDependencyCommand, "promptForGitPath").resolves("");

		await vs.commands.executeCommand("dart.addDependency");
		await waitFor(() => pubspecContainsText("git: https://github.com/dart-lang/timing"));
		assert.equal(pubspecContainsPackage("timing"), true);
		assert.equal(pubspecContainsText("git: https://github.com/dart-lang/timing"), true);
	});

	it("can add from a quick fix if not listed in pubspec.yaml", async () => {
		const packageName = "built_value";
		assert.equal(pubspecContainsPackage(packageName), false);
		await waitForNextAnalysis(() => setTestContent(`import 'package:${packageName}/${packageName}.dart'`));

		const fixResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf(`|package:${packageName}|`));
		const addDependency = fixResults.find((r) => r.title.indexOf(`Add '${packageName}' to dependencies`) !== -1);
		assert.equal(!!addDependency, true);
	});

	it("cannot add from a quick fix if already listed in pubspec.yaml", async () => {
		const packageName = "convert";
		assert.equal(pubspecContainsPackage(packageName), true);
		await waitForNextAnalysis(() => setTestContent(`import 'package:${packageName}/${packageName}.dart'`));

		const fixResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf(`|package:${packageName}|`));
		const addDependency = fixResults.find((r) => r.title.indexOf(`Add '${packageName}' to dependencies`) !== -1);
		assert.equal(!!addDependency, false);
	});
});
