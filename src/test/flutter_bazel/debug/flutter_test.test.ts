import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../../shared/utils/fs";
import { DartDebugClient } from "../../dart_debug_client";
import { killFlutterTester } from "../../debug_helpers";
import { activate, defer, delay, ext, extApi, flutterBazelHelloWorldFolder, flutterBazelTestMainFile, getLaunchConfiguration, getPackages, logger, prepareHasRunFile, withTimeout } from "../../helpers";

describe("flutter test debugger", () => {

	// We have tests that require external packages.
	before("get packages", () => getPackages());
	beforeEach("activate flutterTestMainFile", async () => {
		await activate(flutterBazelTestMainFile);
	});

	// We don't commit all the iOS/Android stuff to this repo to save space, but we can bring it back with
	// `flutter create .`!
	before("run 'flutter create'", () => vs.commands.executeCommand("_flutter.create", fsPath(flutterBazelHelloWorldFolder)));
	before("run 'flutter clean'", () => vs.commands.executeCommand("_flutter.clean", fsPath(flutterBazelHelloWorldFolder)));

	let dc: DartDebugClient;
	beforeEach("create debug client", () => {
		dc = new DartDebugClient(
			process.execPath,
			path.join(ext.extensionPath, "out/extension/debug/flutter_test_debug_entry.js"),
			"dart",
			undefined,
			extApi.debugCommands,
			extApi.testTreeProvider,
		);
		dc.defaultTimeout = 60000;
		// The test runner doesn't quit on the first SIGINT, it prints a message that it's waiting for the
		// test to finish and then runs cleanup. Since we don't care about this for these tests, we just send
		// a second request and that'll cause it to quit immediately.
		const thisDc = dc;
		defer(() => withTimeout(
			Promise.all([
				thisDc.terminateRequest().catch((e) => logger.error(e)),
				delay(500).then(() => thisDc.stop()).catch((e) => logger.error(e)),
			]),
			"Timed out disconnecting - this is often normal because we have to try to quit twice for the test runner",
			60,
		));
	});

	afterEach(killFlutterTester);

	async function startDebugger(script?: vs.Uri | string): Promise<vs.DebugConfiguration> {
		const config = await getLaunchConfiguration(script);
		if (!config)
			throw new Error(`Could not get launch configuration (got ${config})`);
		await dc.start(config.debugServer);
		return config;
	}

	it("runs a Flutter test script to completion using custom script", async () => {
		const hasRunFile = prepareHasRunFile("flutter_test");

		const config = await startDebugger(flutterBazelTestMainFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);

		assert.ok(fs.existsSync(hasRunFile));
	});
});
