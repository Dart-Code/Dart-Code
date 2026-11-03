import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { activate, defer, flutterHelloWorldFolder, privateApi } from "../../helpers";
import { ChildProcessSpawnStub } from "../../mocks/child_process_spawn_stub";

describe("dart.upgradePackages.majorVersions", () => {
	before("activate", () => activate());

	it("runs flutter pub upgrade --major-versions for a Flutter project", async () => {
		privateApi.context.globalState.hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation = true;
		defer("Reset the warning state", () => privateApi.context.globalState.hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation = false);
		const spawn = ChildProcessSpawnStub.flutterPub();
		await vs.commands.executeCommand("dart.upgradePackages.majorVersions", flutterHelloWorldFolder);
		spawn.assertFlutterCalls([{ cwd: fsPath(flutterHelloWorldFolder), args: ["pub", "upgrade", "--major-versions"] }]);
	});
});
