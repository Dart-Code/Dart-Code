import { strict as assert } from "assert";
import * as vs from "vscode";
import { RunProcessResult } from "../../../shared/processes";
import { activate, captureOutput } from "../../helpers";
import { ChildProcessSpawnStub } from "../../mocks/child_process_spawn_stub";

describe("flutter packages outdated", () => {

	beforeEach("activate", () => activate());

	it("runs and prints output", async () => {
		const buffer = captureOutput("flutter (package:flutter_hello_world)");
		ChildProcessSpawnStub.flutterPub({ stdout: "Outdated dependencies\n" });
		const result: RunProcessResult = await vs.commands.executeCommand("flutter.packages.outdated");
		assert.equal(result.exitCode, 0);

		const output = buffer.join("").trim();
		assert.equal(output.startsWith(`--\n\n[package:flutter_hello_world] flutter --suppress-analytics pub outdated`), true);
		assert.notEqual(output.indexOf("Outdated dependencies"), -1);
		assert.equal(output.endsWith("exit code 0"), true);
	});
});
