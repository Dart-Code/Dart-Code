import { strict as assert } from "assert";
import * as fs from "fs";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { waitFor } from "../../../shared/utils/promises";
import { activate, currentDoc, defer, helloWorldExampleSubFolder, helloWorldExampleSubFolderPubspecFile, helloWorldFolder, helloWorldPubspec, privateApi, rangeOf, sb, setTestContent, waitForNextAnalysis } from "../../helpers";

describe("pub add", () => {
	const pubspecPath = fsPath(helloWorldPubspec);
	const pubspec2Path = fsPath(helloWorldExampleSubFolderPubspecFile);
	beforeEach("activate", () => activate());
	beforeEach("ensure pubspecs reset", () => {
		const contents = fs.readFileSync(pubspecPath);
		defer("Reset pubspec", () => fs.writeFileSync(pubspecPath, contents));
		const contents2 = fs.readFileSync(pubspec2Path);
		defer("Reset pubspec2", () => fs.writeFileSync(pubspec2Path, contents2));
	});

	function pubspecContainsPackage(packageName: string) {
		const contents = fs.readFileSync(pubspecPath);
		return contents.includes(`\n  ${packageName}:`);
	}

	function pubspec2ContainsPackage(packageName: string) {
		const contents = fs.readFileSync(pubspec2Path);
		return contents.includes(`\n  ${packageName}:`);
	}

	function pubspecContainsText(text: string) {
		const contents = fs.readFileSync(pubspecPath);
		return contents.includes(text);
	}

	it("can add a dependency using command", async () => {
		assert.equal(pubspecContainsPackage("collection"), false);
		sb.stub(privateApi.addDependencyCommand, "promptForPackageInfo").resolves("collection");
		sb.stub(vs.window, "showQuickPick").resolves([{ path: fsPath(helloWorldFolder) }]);

		await vs.commands.executeCommand("dart.addDependency");
		await waitFor(() => pubspecContainsPackage("collection"));
		assert.equal(pubspecContainsPackage("collection"), true);
	});

	it("can add a dependency to multiple projects", async () => {
		assert.equal(pubspecContainsPackage("collection"), false);
		assert.equal(pubspec2ContainsPackage("collection"), false);
		sb.stub(privateApi.addDependencyCommand, "promptForPackageInfo").resolves("collection");
		sb.stub(vs.window, "showQuickPick").callsFake((items: Array<vs.QuickPickItem & { path: string }>) => {
			// Ensure the `picked` fields are set correctly.
			assert.equal(items.length, 2);
			assert.equal(items[0].path, fsPath(helloWorldFolder));
			assert.equal(items[0].picked, true);
			assert.equal(items[1].path, fsPath(helloWorldExampleSubFolder));
			assert.equal(items[1].picked, false);
			return items;
		});

		await vs.commands.executeCommand("dart.addDependency");
		await waitFor(() => pubspecContainsPackage("collection"));
		assert.equal(pubspecContainsPackage("collection"), true);
		await waitFor(() => pubspec2ContainsPackage("collection"));
		assert.equal(pubspec2ContainsPackage("collection"), true);
	});

	for (const separator of [",", " ", ", "]) {
		it(`can add multiple dependencies separated by "${separator}" using command`, async () => {
			assert.equal(pubspecContainsPackage("path"), false);
			assert.equal(pubspecContainsPackage("crypto"), false);
			sb.stub(privateApi.addDependencyCommand, "promptForPackageInfo").resolves(`path${separator}crypto`);
			sb.stub(vs.window, "showQuickPick").resolves([{ path: fsPath(helloWorldFolder) }]);

			await vs.commands.executeCommand("dart.addDependency");
			await waitFor(() => pubspecContainsPackage("path"));
			await waitFor(() => pubspecContainsPackage("crypto"));
			assert.equal(pubspecContainsPackage("path"), true);
			assert.equal(pubspecContainsPackage("crypto"), true);
		});
	}

	it("can add a dependency with trailing whitespace using command", async () => {
		assert.equal(pubspecContainsPackage("collection"), false);
		sb.stub(privateApi.addDependencyCommand, "promptForPackageInfo").resolves("collection ");
		sb.stub(vs.window, "showQuickPick").resolves([{ path: fsPath(helloWorldFolder) }]);

		await vs.commands.executeCommand("dart.addDependency");
		await waitFor(() => pubspecContainsPackage("collection"));
		assert.equal(pubspecContainsPackage("collection"), true);
	});

	it("can add a dev-dependency using command", async () => {
		assert.equal(pubspecContainsPackage("collection"), false);
		sb.stub(privateApi.addDependencyCommand, "promptForPackageInfo").resolves("collection");
		sb.stub(vs.window, "showQuickPick").resolves([{ path: fsPath(helloWorldFolder) }]);

		await vs.commands.executeCommand("dart.addDevDependency");
		await waitFor(() => pubspecContainsPackage("collection"));
		assert.equal(pubspecContainsPackage("collection"), true);
	});

	it("can add a dependency by URL by pasting", async () => {
		assert.equal(pubspecContainsPackage("timing"), false);
		sb.stub(privateApi.addDependencyCommand, "promptForPackageInfo").resolves("https://github.com/dart-lang/timing");
		sb.stub(privateApi.addDependencyCommand, "promptForPackageName").resolves("timing");
		sb.stub(privateApi.addDependencyCommand, "promptForGitRef").resolves("");
		sb.stub(privateApi.addDependencyCommand, "promptForGitPath").resolves("");
		sb.stub(vs.window, "showQuickPick").resolves([{ path: fsPath(helloWorldFolder) }]);

		await vs.commands.executeCommand("dart.addDependency");
		await waitFor(() => pubspecContainsText("git: https://github.com/dart-lang/timing"));
		assert.equal(pubspecContainsPackage("timing"), true);
		assert.equal(pubspecContainsText("git: https://github.com/dart-lang/timing"), true);
	});

	it("can add a dependency by URL by selecting the GIT option", async () => {
		assert.equal(pubspecContainsPackage("timing"), false);
		sb.stub(privateApi.addDependencyCommand, "promptForPackageInfo").resolves({ marker: "GIT" });
		sb.stub(privateApi.addDependencyCommand, "promptForGitUrl").resolves("https://github.com/dart-lang/timing");
		sb.stub(privateApi.addDependencyCommand, "promptForPackageName").resolves("timing");
		sb.stub(privateApi.addDependencyCommand, "promptForGitRef").resolves("");
		sb.stub(privateApi.addDependencyCommand, "promptForGitPath").resolves("");
		sb.stub(vs.window, "showQuickPick").resolves([{ path: fsPath(helloWorldFolder) }]);

		await vs.commands.executeCommand("dart.addDependency");
		await waitFor(() => pubspecContainsText("git: https://github.com/dart-lang/timing"));
		assert.equal(pubspecContainsPackage("timing"), true);
		assert.equal(pubspecContainsText("git: https://github.com/dart-lang/timing"), true);
	});

	it("can add from a quick fix if not listed in pubspec.yaml", async () => {
		// Because we've enabled the depend_on_referenced_packages lint, we'll get two diagnostics
		// for this, but expect only one fix.
		const packageName = "built_value";
		assert.equal(pubspecContainsPackage(packageName), false);
		await waitForNextAnalysis(() => setTestContent(`import 'package:${packageName}/${packageName}.dart';`));

		const fixResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf(`|package:${packageName}|`));
		const addDependencyFixes = fixResults.filter((r) => r.title.includes(`Add '${packageName}' to dependencies`));
		assert.equal(addDependencyFixes.length, 1);
		const addDependencyFix = addDependencyFixes[0];

		await vs.commands.executeCommand(addDependencyFix.command!.command, ...addDependencyFix.command!.arguments!); // eslint-disable-line @typescript-eslint/no-unsafe-argument
		await waitFor(() => pubspecContainsText(packageName));
		assert.equal(pubspecContainsPackage(packageName), true);
	});

	it("cannot add from a quick fix if already listed in pubspec.yaml", async () => {
		const packageName = "convert";
		assert.equal(pubspecContainsPackage(packageName), true);
		await waitForNextAnalysis(() => setTestContent(`import 'package:${packageName}/${packageName}.dart';`));

		const fixResults = await vs.commands.executeCommand<vs.CodeAction[]>("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf(`|package:${packageName}|`));
		const addDependencyFixes = fixResults.filter((r) => r.title.includes(`Add '${packageName}' to dependencies`));
		assert.equal(addDependencyFixes.length, 0);
	});
});
