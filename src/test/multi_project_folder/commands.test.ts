import * as assert from "assert";
import * as vs from "vscode";
import { fiveMinutesInMs } from "../../extension/constants";
import { activate, flutterHelloWorldMainFile, helloWorldMainFile } from "../helpers";

describe("dart.getPackages", () => {
	it("successfully fetches packages for Dart project", async () => {
		await activate();
		// Normally this fires with the pubspec.yaml file, but as long as it's a file in
		// the correct folder, it'll do the same.
		const res = await vs.commands.executeCommand("dart.getPackages", helloWorldMainFile);
		assert.equal(res, 0); // If we run the wrong command, we'll get an error code.
	}).timeout(1000 * 60 * 5); // 5 minutes
	it("successfully fetches packages for Flutter project", async () => {
		await activate();
		// Normally this fires with the pubspec.yaml file, but as long as it's a file in
		// the correct folder, it'll do the same.
		const res = await vs.commands.executeCommand("dart.getPackages", flutterHelloWorldMainFile);
		assert.equal(res, 0); // If we run the wrong command, we'll get an error code.
	}).timeout(fiveMinutesInMs);
});
