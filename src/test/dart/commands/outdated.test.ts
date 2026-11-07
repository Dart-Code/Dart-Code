import { strict as assert } from "assert";
import * as vs from "vscode";
import { RunProcessResult } from "../../../shared/processes";
import { activate, captureOutput, closeAllOpenFiles, helloWorldPubspec, sb, setConfigForTest } from "../../helpers";
import { ChildProcessSpawnStub } from "../../mocks/child_process_spawn_stub";

describe("pub outdated", () => {
	beforeEach("activate", () => activate());

	it("does nothing when pub is disabled", async () => {
		await setConfigForTest("dart", "enablePub", false);
		const spawn = ChildProcessSpawnStub.dartOrFlutterPub();
		await vs.commands.executeCommand("dart.listOutdatedPackages", helloWorldPubspec);
		spawn.assertCalls([]);
	});

	it("does nothing when folder selection is cancelled", async () => {
		await closeAllOpenFiles();
		sb.stub(vs.window, "showQuickPick").resolves();
		const spawn = ChildProcessSpawnStub.dartOrFlutterPub();
		await vs.commands.executeCommand("dart.listOutdatedPackages");
		spawn.assertCalls([]);
	});

	it("runs and prints output", async () => {
		const buffer = captureOutput("dart (package:hello_world)");
		ChildProcessSpawnStub.dartPub({ stdout: "Outdated dependencies\n" });
		const result: RunProcessResult = await vs.commands.executeCommand("pub.outdated");
		assert.equal(result.exitCode, 0);

		const output = buffer.join("").trim();
		assert.equal(output.startsWith(`--\n\n[package:hello_world] dart pub outdated`), true);
		assert.notEqual(output.indexOf("Outdated dependencies"), -1);
		assert.equal(output.endsWith("exit code 0"), true);
	});
});
