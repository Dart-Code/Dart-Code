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

	function pubspecContains(packageName: string) {
		const contents = fs.readFileSync(pubspecPath);
		return contents.includes(`  ${packageName}:`);
	}

	it("can add a dependency using command", async () => {
		assert.equal(pubspecContains("collection"), false);
		sb.stub(extApi.addDependencyCommand, "promptForPackage").resolves("collection");
		await vs.commands.executeCommand("dart.addDependency");
		await waitFor(() => pubspecContains("collection"));
		assert.equal(pubspecContains("collection"), true);
	});

	it("can add a dev-dependency using command", async () => {
		assert.equal(pubspecContains("collection"), false);
		sb.stub(extApi.addDependencyCommand, "promptForPackage").resolves("collection");
		await vs.commands.executeCommand("dart.addDevDependency");
		await waitFor(() => pubspecContains("collection"));
		assert.equal(pubspecContains("collection"), true);
	});

	it("can add from a quick fix if not listed in pubspec.yaml", async () => {
		const packageName = "built_value";
		assert.equal(pubspecContains(packageName), false);
		await waitForNextAnalysis(() => setTestContent(`import 'package:${packageName}/${packageName}.dart'`));

		const fixResults = await (vs.commands.executeCommand("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf(`|package:${packageName}|`)) as Thenable<vs.CodeAction[]>);
		const addDependency = fixResults.find((r) => r.title.indexOf(`Add '${packageName}' to dependencies in pubspec.yaml`) !== -1);
		assert.equal(!!addDependency, true);
	});

	it("cannot add from a quick fix if already listed in pubspec.yaml", async () => {
		const packageName = "convert";
		assert.equal(pubspecContains(packageName), true);
		await waitForNextAnalysis(() => setTestContent(`import 'package:${packageName}/${packageName}.dart'`));

		const fixResults = await (vs.commands.executeCommand("vscode.executeCodeActionProvider", currentDoc().uri, rangeOf(`|package:${packageName}|`)) as Thenable<vs.CodeAction[]>);
		const addDependency = fixResults.find((r) => r.title.indexOf(`Add '${packageName}' to dependencies in pubspec.yaml`) !== -1);
		assert.equal(!!addDependency, false);
	});
});
