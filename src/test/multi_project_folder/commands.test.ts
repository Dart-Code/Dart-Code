import { strict as assert } from "assert";
import * as vs from "vscode";
import { fiveMinutesInMs } from "../../shared/constants";
import { RunProcessResult } from "../../shared/processes";
import { fsPath } from "../../shared/utils/fs";
import { activate, flutterHelloWorldFolder, flutterHelloWorldMainFile, helloWorldFolder, helloWorldMainFile } from "../helpers";
import { ChildProcessSpawnStub } from "../mocks/child_process_spawn_stub";

describe("dart.getPackages", () => {
	beforeEach("activate", () => activate());

	it("successfully fetches packages for Dart project", async () => {
		const spawn = ChildProcessSpawnStub.dartPub();

		// Normally this fires with the pubspec.yaml file, but as long as it's a file in
		// the correct folder, it'll do the same.
		const res: RunProcessResult = await vs.commands.executeCommand("dart.getPackages", helloWorldMainFile);
		assert.equal(res.exitCode, 0);

		spawn.assertDartCalls([
			{ cwd: fsPath(helloWorldFolder), args: ["pub", "get", "--no-example"] },
		]);
	}).timeout(fiveMinutesInMs);

	it("successfully fetches packages for Flutter project", async () => {
		const spawn = ChildProcessSpawnStub.flutterPub();

		// Normally this fires with the pubspec.yaml file, but as long as it's a file in
		// the correct folder, it'll do the same.
		const res: RunProcessResult = await vs.commands.executeCommand("dart.getPackages", flutterHelloWorldMainFile);
		assert.equal(res.exitCode, 0);

		spawn.assertFlutterCalls([
			{ cwd: fsPath(flutterHelloWorldFolder), args: ["pub", "get", "--no-example"] },
		]);
	}).timeout(fiveMinutesInMs);
});
