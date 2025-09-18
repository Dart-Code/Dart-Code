import { DebugProtocol } from "@vscode/debugprotocol";
import { strict as assert } from "assert";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { DartVsCodeLaunchArgs } from "../../shared/debug/interfaces";
import { DebuggerType } from "../../shared/enums";
import { DartDebugClient } from "../dart_debug_client";
import { createDebugClient, flutterTestDeviceId, flutterTestDeviceIsWeb, killFlutterTester, spawnFlutterProcess, waitAllThrowIfTerminates } from "../debug_helpers";
import { activateWithoutAnalysis, deferUntilLast, delay, fileSafeCurrentTestName, flutterHelloWorldMainFile, getAttachConfiguration, logger, watchPromise } from "../helpers";

describe("flutter run debugger (attach)", () => {
	beforeEach("Skip attach tests for web devices", function () {
		if (flutterTestDeviceIsWeb)
			this.skip();
	});

	beforeEach("activate flutterHelloWorldMainFile", () => activateWithoutAnalysis(flutterHelloWorldMainFile));

	beforeEach(() => {
		deferUntilLast("Kill flutter_tester", () => watchPromise("Killing flutter_tester processes", killFlutterTester()));
	});

	let dc: DartDebugClient;
	beforeEach("create debug client", () => {
		dc = createDebugClient(DebuggerType.Flutter);
	});

	async function attachDebugger(vmServiceUri?: string): Promise<vs.DebugConfiguration & DartVsCodeLaunchArgs> {
		const config = await getAttachConfiguration({
			args: [
				// Disable DDS when connecting, because we launch processes with `flutter run` which
				// connects a VM Service client, which will prevent DDS from connecting. This should not
				// be required if the app was started as a native app (as would usually be the case, outside
				// of tests).
				"--disable-dds",
				// Use pid-file as a convenient way of getting the test name into the command line args
				// for easier debugging of processes that hang around on CI (we dump the process command
				// line at the end of the test run).
				"--pid-file", path.join(os.tmpdir(), fileSafeCurrentTestName),
			],
			deviceId: flutterTestDeviceId,
			vmServiceUri,
		});
		if (!config)
			throw new Error(`Could not get attach configuration (got ${config})`);
		await dc.start();
		// Make sure any stdErr is logged to console + log file for debugging.
		dc.on("output", (event: DebugProtocol.OutputEvent) => {
			if (event.body.category === "stderr")
				logger.error(event.body.output);
		});
		return config;
	}

	it("attaches to a Flutter application and collects stdout", async () => {
		const process = await spawnFlutterProcess(flutterHelloWorldMainFile);
		const vmServiceUri = await process.vmServiceUri;
		const config = await attachDebugger(vmServiceUri);

		await waitAllThrowIfTerminates(dc,
			watchPromise("attaches_and_collects_stdout->configurationSequence", dc.configurationSequence()),
			watchPromise("attaches_and_collects_stdout->output", dc.assertOutput("stdout", "Hello, world!")),
			watchPromise("attaches_and_collects_stdout->launch", dc.launch(config)),
		);
	});

	it("attaches to a Flutter application and remains active until told to detach", async () => {
		const process = await spawnFlutterProcess(flutterHelloWorldMainFile);
		const vmServiceUri = await process.vmServiceUri;
		const config = await attachDebugger(vmServiceUri);

		await waitAllThrowIfTerminates(dc,
			dc.debuggerReady(),
			watchPromise("attaches_and_waits->configurationSequence", dc.configurationSequence()),
			watchPromise("attaches_and_waits->launch", dc.launch(config)),
		);

		// Ensure we're still responsive after 3 seconds.
		await delay(3000);
		await watchPromise("attaches_and_waits->threadsRequest", dc.threadsRequest());

		await waitAllThrowIfTerminates(dc,
			watchPromise("attaches_and_waits->waitForEvent:terminated", dc.waitForEvent("terminated")),
			watchPromise("attaches_and_waits->terminateRequest", dc.terminateRequest()),
		);
	});

	it("detaches without terminating the app", async () => {
		const process = await spawnFlutterProcess(flutterHelloWorldMainFile);
		const vmServiceUri = await process.vmServiceUri;
		const config = await attachDebugger(vmServiceUri);

		await waitAllThrowIfTerminates(dc,
			dc.debuggerReady(),
			watchPromise("attaches_and_waits->configurationSequence", dc.configurationSequence()),
			watchPromise("attaches_and_waits->launch", dc.launch(config)),
		);

		await waitAllThrowIfTerminates(dc,
			watchPromise("attaches_and_waits->waitForEvent:terminated", dc.waitForEvent("terminated")),
			watchPromise("attaches_and_waits->terminateRequest", dc.terminateRequest()),
		);

		// Ensure the main process is still alive.
		await delay(4000);
		assert.equal(process.hasExited, false);
	});
});
