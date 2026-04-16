import { strict as assert } from "assert";
import * as fs from "fs";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { waitFor } from "../../../shared/utils/promises";
import { activate, defer, flutterHelloWorldFolder, flutterHelloWorldPubspec, privateApi, sb } from "../../helpers";

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
		sb.stub(privateApi.addDependencyCommand, "promptForPackageInfo").resolves("collection");
		sb.stub(vs.window, "showQuickPick").resolves([{ path: fsPath(flutterHelloWorldFolder) }]);

		await vs.commands.executeCommand("dart.addDependency");
		await waitFor(() => pubspecContains("collection"));
		assert.equal(pubspecContains("collection"), true);
	});

	it("can add a dev-dependency using command", async () => {
		assert.equal(pubspecContains("collection"), false);
		sb.stub(privateApi.addDependencyCommand, "promptForPackageInfo").resolves("collection");
		sb.stub(vs.window, "showQuickPick").resolves([{ path: fsPath(flutterHelloWorldFolder) }]);

		await vs.commands.executeCommand("dart.addDevDependency");
		await waitFor(() => pubspecContains("collection"));
		assert.equal(pubspecContains("collection"), true);
	});

	it("can add a Flutter SDK dependency using command", async () => {
		assert.equal(pubspecContains("flutter_localizations"), false);
		sb.stub(privateApi.addDependencyCommand, "promptForPackageInfo").resolves("flutter_localizations");
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

	it("runs without --sdk for a Pub package", async () => {
		const runFlutter = sb.stub(privateApi.addDependencyCommand as any, "runFlutter").resolves(undefined);

		await vs.commands.executeCommand("_dart.addDependency", [flutterHelloWorldFolder], { marker: undefined, packageNames: "collection" }, false);

		assert.equal(runFlutter.callCount, 1);
		assert.deepStrictEqual(runFlutter.firstCall.args, [["pub", "add", "collection"], flutterHelloWorldFolder]);
	});

	it("runs with --sdk for a Flutter SDK package", async () => {
		const runFlutter = sb.stub(privateApi.addDependencyCommand as any, "runFlutter").resolves(undefined);

		await vs.commands.executeCommand("_dart.addDependency", [flutterHelloWorldFolder], { marker: undefined, packageNames: "flutter_test" }, false);

		assert.equal(runFlutter.callCount, 1);
		assert.deepStrictEqual(runFlutter.firstCall.args, [["pub", "add", "flutter_test", "--sdk", "flutter"], flutterHelloWorldFolder]);
	});

	it("runs separate commands for multiple Flutter SDK packages", async () => {
		const runFlutter = sb.stub(privateApi.addDependencyCommand as any, "runFlutter").resolves(undefined);

		await vs.commands.executeCommand("_dart.addDependency", [flutterHelloWorldFolder], { marker: undefined, packageNames: "flutter_test flutter_localizations" }, false);

		assert.equal(runFlutter.callCount, 2);
		assert.deepStrictEqual(runFlutter.firstCall.args, [["pub", "add", "flutter_test", "--sdk", "flutter"], flutterHelloWorldFolder]);
		assert.deepStrictEqual(runFlutter.secondCall.args, [["pub", "add", "flutter_localizations", "--sdk", "flutter"], flutterHelloWorldFolder]);
	});

	it("runs multiple commands for a mix of Flutter SDK/Pub packages", async () => {
		const runFlutter = sb.stub(privateApi.addDependencyCommand as any, "runFlutter").resolves(undefined);

		await vs.commands.executeCommand("_dart.addDependency", [flutterHelloWorldFolder], { marker: undefined, packageNames: "foo flutter_test bar flutter_driver" }, false);

		assert.equal(runFlutter.callCount, 3);
		assert.deepStrictEqual(runFlutter.firstCall.args, [["pub", "add", "foo", "bar"], flutterHelloWorldFolder]);
		assert.deepStrictEqual(runFlutter.secondCall.args, [["pub", "add", "flutter_test", "--sdk", "flutter"], flutterHelloWorldFolder]);
		assert.deepStrictEqual(runFlutter.thirdCall.args, [["pub", "add", "flutter_driver", "--sdk", "flutter"], flutterHelloWorldFolder]);
	});
});
