import { strict as assert } from "assert";
import * as fs from "fs";
import * as vs from "vscode";
import { fiveMinutesInMs } from "../../shared/constants";
import { RunProcessResult } from "../../shared/processes";
import { fsPath } from "../../shared/utils/fs";
import { activate, deleteFileIfExists, flutterHelloWorldMainFile, flutterHelloWorldPackageConfigFile, helloWorldMainFile, helloWorldPackageConfigFile, waitForResult } from "../helpers";

describe("dart.getPackages", () => {
	it("successfully fetches packages for Dart project", async () => {
		const packageFile = fsPath(helloWorldPackageConfigFile);
		deleteFileIfExists(packageFile);

		await activate();
		// Normally this fires with the pubspec.yaml file, but as long as it's a file in
		// the correct folder, it'll do the same.
		const res: RunProcessResult = await vs.commands.executeCommand("dart.getPackages", helloWorldMainFile);
		assert.equal(res.exitCode, 0); // If we run the wrong command, we'll get an error code.

		// Verify the package config now exists.
		await waitForResult(() => fs.existsSync(packageFile), ".dart_tool/package_config.json did not exist", 10000);
	}).timeout(fiveMinutesInMs);

	it("successfully fetches packages for Flutter project", async () => {
		const packageFile = fsPath(flutterHelloWorldPackageConfigFile);
		deleteFileIfExists(packageFile);

		await activate();
		// Normally this fires with the pubspec.yaml file, but as long as it's a file in
		// the correct folder, it'll do the same.
		const res: RunProcessResult = await vs.commands.executeCommand("dart.getPackages", flutterHelloWorldMainFile);
		assert.equal(res.exitCode, 0); // If we run the wrong command, we'll get an error code.

		// Verify the package config now exists.
		await waitForResult(() => fs.existsSync(packageFile), ".dart_tool/package_config.json did not exist", 10000);
	}).timeout(fiveMinutesInMs);

	it("successfully fetches packages for all projects", async () => {
		const packageFiles = [
			fsPath(helloWorldPackageConfigFile),
			fsPath(flutterHelloWorldPackageConfigFile),
		];
		packageFiles.forEach(deleteFileIfExists);

		await activate();
		await vs.commands.executeCommand("dart.getPackages.all");

		// Verify the package config now exists.
		await Promise.all(packageFiles.map((f) => waitForResult(() => fs.existsSync(f), `${f} did not exist`, 10000)));
	}).timeout(fiveMinutesInMs);
});
