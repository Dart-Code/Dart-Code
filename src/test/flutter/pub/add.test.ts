import { strict as assert } from "assert";
import * as fs from "fs";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { waitFor } from "../../../shared/utils/promises";
import { activate, defer, extApi, flutterHelloWorldPubspec, sb } from "../../helpers";

describe("pub add", () => {
	const pubspecPath = fsPath(flutterHelloWorldPubspec);
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

	it("can add a Flutter SDK dependency using command", async () => {
		assert.equal(pubspecContains("flutter_localizations"), false);
		sb.stub(extApi.addDependencyCommand, "promptForPackage").resolves("flutter_localizations");
		await vs.commands.executeCommand("dart.addDevDependency");
		await waitFor(() => pubspecContains("flutter_localizations"));

		assert.equal(fs.readFileSync(pubspecPath).includes("flutter_localizations: \n    sdk: flutter"), true);
	});
});
