import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { activate, flutterHelloWorldFolder, privateApi, sb } from "../../helpers";
import { ChildProcessSpawnStub } from "../../mocks/child_process_spawn_stub";

describe("pub add", () => {
	beforeEach("activate", () => activate());

	it("can add a dependency using command", async () => {
		const spawn = ChildProcessSpawnStub.flutterPub();
		sb.stub(privateApi.addDependencyCommand, "promptForPackageInfo").resolves("collection");
		sb.stub(vs.window, "showQuickPick").resolves([{ path: fsPath(flutterHelloWorldFolder) }]);

		await vs.commands.executeCommand("dart.addDependency");

		spawn.assertFlutterCalls([{ cwd: fsPath(flutterHelloWorldFolder), args: ["pub", "add", "collection"] }]);
	});

	it("can add a dev-dependency using command", async () => {
		const spawn = ChildProcessSpawnStub.flutterPub();
		sb.stub(privateApi.addDependencyCommand, "promptForPackageInfo").resolves("collection");
		sb.stub(vs.window, "showQuickPick").resolves([{ path: fsPath(flutterHelloWorldFolder) }]);

		await vs.commands.executeCommand("dart.addDevDependency");

		spawn.assertFlutterCalls([{ cwd: fsPath(flutterHelloWorldFolder), args: ["pub", "add", "collection", "--dev"] }]);
	});

	it("can add a Flutter SDK dependency using command", async () => {
		const spawn = ChildProcessSpawnStub.flutterPub();
		sb.stub(privateApi.addDependencyCommand, "promptForPackageInfo").resolves("flutter_localizations");
		sb.stub(vs.window, "showQuickPick").resolves([{ path: fsPath(flutterHelloWorldFolder) }]);

		await vs.commands.executeCommand("dart.addDevDependency");

		spawn.assertFlutterCalls([{ cwd: fsPath(flutterHelloWorldFolder), args: ["pub", "add", "flutter_localizations", "--sdk", "flutter", "--dev"] }]);
	});

	it("runs without --sdk for a Pub package", async () => {
		const spawn = ChildProcessSpawnStub.flutterPub();

		await vs.commands.executeCommand("_dart.addDependency", [flutterHelloWorldFolder], { marker: undefined, packageNames: "collection" }, false);

		spawn.assertFlutterCalls([{ cwd: fsPath(flutterHelloWorldFolder), args: ["pub", "add", "collection"] }]);
	});

	it("runs with --sdk for a Flutter SDK package", async () => {
		const spawn = ChildProcessSpawnStub.flutterPub();

		await vs.commands.executeCommand("_dart.addDependency", [flutterHelloWorldFolder], { marker: undefined, packageNames: "flutter_test" }, false);

		spawn.assertFlutterCalls([{ cwd: fsPath(flutterHelloWorldFolder), args: ["pub", "add", "flutter_test", "--sdk", "flutter"] }]);
	});

	it("runs separate commands for multiple Flutter SDK packages", async () => {
		const spawn = ChildProcessSpawnStub.flutterPub();

		await vs.commands.executeCommand("_dart.addDependency", [flutterHelloWorldFolder], { marker: undefined, packageNames: "flutter_test flutter_localizations" }, false);

		spawn.assertFlutterCalls([
			{ cwd: fsPath(flutterHelloWorldFolder), args: ["pub", "add", "flutter_test", "--sdk", "flutter"] },
			{ cwd: fsPath(flutterHelloWorldFolder), args: ["pub", "add", "flutter_localizations", "--sdk", "flutter"] },
		]);
	});

	it("runs multiple commands for a mix of Flutter SDK/Pub packages", async () => {
		const spawn = ChildProcessSpawnStub.flutterPub();

		await vs.commands.executeCommand("_dart.addDependency", [flutterHelloWorldFolder], { marker: undefined, packageNames: "foo flutter_test bar flutter_driver" }, false);

		spawn.assertFlutterCalls([
			{ cwd: fsPath(flutterHelloWorldFolder), args: ["pub", "add", "foo", "bar"] },
			{ cwd: fsPath(flutterHelloWorldFolder), args: ["pub", "add", "flutter_test", "--sdk", "flutter"] },
			{ cwd: fsPath(flutterHelloWorldFolder), args: ["pub", "add", "flutter_driver", "--sdk", "flutter"] },
		]);
	});
});
