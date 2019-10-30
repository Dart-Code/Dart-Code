import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { DebugProtocol } from "vscode-debugprotocol";
import { fsPath } from "../../../shared/vscode/utils";
import { DartDebugClient } from "../../dart_debug_client";
import { killFlutterTester, spawnFlutterProcess } from "../../debug_helpers";
import { activate, defer, delay, ext, extApi, fileSafeCurrentTestName, flutterHelloWorldExampleSubFolder, flutterHelloWorldFolder, flutterHelloWorldMainFile, getAttachConfiguration, getPackages, logger, watchPromise } from "../../helpers";

describe("flutter run debugger (attach)", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());
	beforeEach("activate flutterHelloWorldMainFile", () => activate(flutterHelloWorldMainFile));

	// We don't commit all the iOS/Android stuff to this repo to save space, but we can bring it back with
	// `flutter create .`!
	before("run 'flutter create'", () => vs.commands.executeCommand("_flutter.create", fsPath(flutterHelloWorldFolder)));
	before("run 'flutter create' for example", () => vs.commands.executeCommand("_flutter.create", fsPath(flutterHelloWorldExampleSubFolder)));

	beforeEach(() => {
		defer(() => watchPromise("Killing flutter_tester processes", killFlutterTester()));
	});

	let dc: DartDebugClient;
	beforeEach("create debug client", () => {
		dc = new DartDebugClient(process.execPath, path.join(ext.extensionPath, "out/extension/debug/flutter_debug_entry.js"), "dart", undefined, extApi.debugCommands, undefined);
		dc.defaultTimeout = 60000;
		defer(() => dc.stop());
	});

	async function attachDebugger(observatoryUri?: string): Promise<vs.DebugConfiguration> {
		const config = await getAttachConfiguration({
			// Use pid-file as a convenient way of getting the test name into the command line args
			// for easier debugging of processes that hang around on CI (we dump the process command
			// line at the end of the test run).
			args: extApi.flutterCapabilities.supportsPidFileForMachine
				? ["--pid-file", path.join(os.tmpdir(), fileSafeCurrentTestName)]
				: [],
			deviceId: "flutter-tester",
			observatoryUri,
		});
		if (!config)
			throw new Error(`Could not get attach configuration (got ${config})`);
		await dc.start(config.debugServer);
		// Make sure any stdErr is logged to console + log file for debugging.
		dc.on("output", (event: DebugProtocol.OutputEvent) => {
			if (event.body.category === "stderr")
				logger.error(event.body.output);
		});
		return config;
	}

	it("attaches to a Flutter application and remains active until told to detach", async () => {
		const process = await spawnFlutterProcess(flutterHelloWorldMainFile);
		const observatoryUri = await process.observatoryUri;
		const config = await attachDebugger(observatoryUri);

		await Promise.all([
			watchPromise("attaches_and_waits->configurationSequence", dc.configurationSequence()),
			watchPromise("attaches_and_waits->launch", dc.launch(config)),
		]);

		// Ensure we're still responsive after 3 seconds.
		await delay(3000);
		await watchPromise("attaches_and_waits->threadsRequest", dc.threadsRequest());

		await Promise.all([
			watchPromise("attaches_and_waits->waitForEvent:terminated", dc.waitForEvent("terminated")),
			watchPromise("attaches_and_waits->terminateRequest", dc.terminateRequest()),
		]);
	});

	it("detaches without terminating the app", async () => {
		const process = await spawnFlutterProcess(flutterHelloWorldMainFile);
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
