import { strict as assert } from "assert";
import * as fs from "fs";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { waitFor } from "../../../shared/utils/promises";
import { activate, defer, extApi, flutterHelloWorldFolder, flutterHelloWorldPubspec, sb } from "../../helpers";

describe("pub add", () => {
	const pubspecPath = fsPath(flutterHelloWorldPubspec);
	beforeEach("activate", () => activate());
	beforeEach("ensure pubspec resets", () => {
		const contents = fs.readFileSync(pubspecPath);
		defer("Reset pubspec", () => fs.writeFileSync(pubspecPath, contents));
	});

	function pubspecContains(packageName: string) {
		const contents = fs.readFileSync(pubspecPath);
		return contents.includes(`  ${packageName}:`);
	}

	it("can add a dependency using command", async () => {
		assert.equal(pubspecContains("collection"), false);
		sb.stub(extApi.addDependencyCommand, "promptForPackageInfo").resolves("collection");
		sb.stub(vs.window, "showQuickPick").resolves([{ path: fsPath(flutterHelloWorldFolder) }]);

		await vs.commands.executeCommand("dart.addDependency");
		await waitFor(() => pubspecContains("collection"));
		assert.equal(pubspecContains("collection"), true);
	});

	it("can add a dev-dependency using command", async () => {
		assert.equal(pubspecContains("collection"), false);
		sb.stub(extApi.addDependencyCommand, "promptForPackageInfo").resolves("collection");
		sb.stub(vs.window, "showQuickPick").resolves([{ path: fsPath(flutterHelloWorldFolder) }]);

		await vs.commands.executeCommand("dart.addDevDependency");
		await waitFor(() => pubspecContains("collection"));
		assert.equal(pubspecContains("collection"), true);
	});

	it("can add a Flutter SDK dependency using command", async () => {
		assert.equal(pubspecContains("flutter_localizations"), false);
		sb.stub(extApi.addDependencyCommand, "promptForPackageInfo").resolves("flutter_localizations");
		sb.stub(vs.window, "showQuickPick").resolves([{ path: fsPath(flutterHelloWorldFolder) }]);

		await vs.commands.executeCommand("dart.addDevDependency");
		await waitFor(() => pubspecContains("flutter_localizations"));

		const fileContents = fs.readFileSync(pubspecPath).toString().replace(/[\s\r]*\n/g, "\n");
		const expectedString = "flutter_localizations:\n    sdk: flutter";
		assert.equal(
			fileContents.includes(expectedString),
			true,
			`Did not find string "${expectedString}" in file contents:\n${fileContents}`,
		);
	});
});
