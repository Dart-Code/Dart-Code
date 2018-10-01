import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { DebugProtocol } from "vscode-debugprotocol";
import { isWin } from "../../../src/debug/utils";
import { fsPath } from "../../../src/utils";
import { logError } from "../../../src/utils/log";
import { DartDebugClient } from "../../dart_debug_client";
import { spawnFlutterProcess } from "../../debug_helpers";
import { activate, defer, delay, ext, extApi, flutterHelloWorldExampleSubFolder, flutterHelloWorldFolder, flutterHelloWorldMainFile, getAttachConfiguration, getLaunchConfiguration, watchPromise } from "../../helpers";

describe("flutter run debugger (attach)", () => {
	beforeEach("activate flutterHelloWorldMainFile", () => activate(flutterHelloWorldMainFile));
	beforeEach("set timeout", function () {
		this.timeout(60000); // These tests can be slow due to flutter package fetches when running.
	});

	beforeEach("skip if no test device", function () {
		if (extApi.daemonCapabilities.flutterTesterMayBeFlaky)
			this.skip();
		// Skip on Windows due to https://github.com/flutter/flutter/issues/17833
		if (isWin)
			this.skip();
	});

	// We don't commit all the iOS/Android stuff to this repo to save space, but we can bring it back with
	// `flutter create .`!
	before("run 'flutter create'", () => vs.commands.executeCommand("_flutter.create", path.join(fsPath(flutterHelloWorldFolder), "dummy"), "."));
	before("run 'flutter create' for example", () => vs.commands.executeCommand("_flutter.create", path.join(fsPath(flutterHelloWorldExampleSubFolder), "dummy"), "."));

	let dc: DartDebugClient;
	beforeEach("create debug client", () => {
		dc = new DartDebugClient(process.execPath, path.join(ext.extensionPath, "out/src/debug/flutter_debug_entry.js"), "dart");
		dc.defaultTimeout = 30000;
		defer(() => dc.stop());
	});

	async function attachDebugger(observatoryUri?: string): Promise<vs.DebugConfiguration> {
		const config = await getAttachConfiguration({ deviceId: "flutter-tester", observatoryUri });
		await dc.start(config.debugServer);
		// Make sure any stdErr is logged to console + log file for debugging.
		dc.on("output", (event: DebugProtocol.OutputEvent) => {
			if (event.body.category === "stderr")
				logError(event.body.output);
		});
		return config;
	}

	it("attaches to a Flutter application and remains active until told to detach", async () => {
		const process = spawnFlutterProcess(await getLaunchConfiguration(flutterHelloWorldMainFile));
		const observatoryUri = await process.observatoryUri;
		const config = await attachDebugger(observatoryUri);

		await Promise.all([
			watchPromise("attaches_and_waits->configurationSequence", dc.configurationSequence()),
			watchPromise("attaches_and_waits->launch", dc.launch(config)),
		]);

		// Ensure we're still responsive after 10 seconds.
		await delay(10000);
		await watchPromise("attaches_and_waits->threadsRequest", dc.threadsRequest());

		await Promise.all([
			watchPromise("attaches_and_waits->waitForEvent:terminated", dc.waitForEvent("terminated")),
			watchPromise("attaches_and_waits->terminateRequest", dc.terminateRequest()),
		]);
	});

	it("detaches without terminating the app", async () => {
		const process = spawnFlutterProcess(await getLaunchConfiguration(flutterHelloWorldMainFile));
		const observatoryUri = await process.observatoryUri;
		const config = await attachDebugger(observatoryUri);

		await Promise.all([
			watchPromise("attaches_and_waits->configurationSequence", dc.configurationSequence()),
			watchPromise("attaches_and_waits->launch", dc.launch(config)),
		]);

		await Promise.all([
			watchPromise("attaches_and_waits->waitForEvent:terminated", dc.waitForEvent("terminated")),
			watchPromise("attaches_and_waits->terminateRequest", dc.terminateRequest()),
		]);

		// Ensure the main process is still alive.
		await delay(4000);
		assert.equal(process.hasExited, false);

	});
});
