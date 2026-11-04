import { strict as assert } from "assert";
import * as vs from "vscode";
import { ExtensionRestartReason } from "../../../shared/constants";
import * as f from "../../../shared/flutter/daemon_interfaces";
import { LogMessage } from "../../../shared/interfaces";
import { DartToolingDaemon } from "../../../shared/services/tooling_daemon";
import { EventKind, Stream } from "../../../shared/services/tooling_daemon_services";
import { PromiseCompleter } from "../../../shared/utils";
import { activateWithoutAnalysis, delay, flutterHelloWorldMainFile, openFile, privateApi, sb, setConfigForTest, waitForResult } from "../../helpers";
import { physicalAndroidMobile } from "../flutter_test_devices";

// Tests for the events that `EditorServices` sends to the Dart Tooling Daemon,
// including https://github.com/Dart-Code/Dart-Code/issues/6347.
describe("dart tooling daemon editor events", () => {
	beforeEach("activate", () => activateWithoutAnalysis());

	beforeEach("skip if not supported", async function () {
		if (!privateApi.dartCapabilities.supportsToolingDaemon || !privateApi.deviceManager)
			this.skip();
	});

	async function reloadExtension() {
		await vs.commands.executeCommand("_dart.reloadExtension", ExtensionRestartReason.Test);
		await activateWithoutAnalysis();
	}

	it("sends device events to the daemon while connected", async () => {
		const daemon = privateApi.toolingDaemon!;
		const deviceManager = privateApi.deviceManager!;
		await daemon.connected;

		const sendEvent = sb.spy(daemon, "sendEvent");
		sb.stub(deviceManager, "getSupportedPlatformsForWorkspace").resolves(["android"]);

		const previousDeviceId = deviceManager.currentDevice?.id;
		try {
			void deviceManager.deviceAdded(physicalAndroidMobile);
			await waitForResult(
				() => sendEvent.getCalls().some((call) => call.args[1]?.kind === EventKind.deviceAdded),
				"deviceAdded event was not sent to the daemon",
			);

			const event = sendEvent.getCalls().find((call) => call.args[1]?.kind === EventKind.deviceAdded)!.args;
			assert.equal(event[0], Stream.Editor);
			assert.equal(event[1].device.id, physicalAndroidMobile.id);
		} finally {
			await deviceManager.deviceRemoved(physicalAndroidMobile);
			await deviceManager.selectDeviceById(previousDeviceId);
		}
	});

	it("does not produce an unhandled rejection when an event is in-flight during dispose", async () => {
		const daemon = privateApi.toolingDaemon!;
		const deviceManager = privateApi.deviceManager!;
		await daemon.connected;

		const sendEvent = sb.spy(daemon, "sendEvent");
		const getSupportedPlatforms = sb.stub(deviceManager, "getSupportedPlatformsForWorkspace");
		// Let the call inside deviceAdded() complete quickly but hold the event
		// listener's call, so the listener is still in-flight when we dispose.
		const listenerGate = new PromiseCompleter<f.PlatformType[]>();
		getSupportedPlatforms.onCall(0).resolves([]);
		getSupportedPlatforms.returns(listenerGate.promise);

		const logMessages: string[] = [];
		const logListener = privateApi.logger.onLog((msg: LogMessage) => logMessages.push(msg.message));
		try {
			// Our listener is invoked after the daemon's listener has started (and
			// suspended on the gate above), so this marks the daemon's listener
			// as being in-flight.
			let emitterFired = false;
			const marker = deviceManager.onDeviceAdded(() => emitterFired = true);
			try {
				void deviceManager.deviceAdded(physicalAndroidMobile);
				await waitForResult(() => emitterFired, "deviceAdded event did not fire");
				await waitForResult(() => getSupportedPlatforms.callCount >= 2, "device event listener did not start");

				daemon.dispose();
				listenerGate.resolve([]);

				// The in-flight listener should still attempt to send the event,
				// which the daemon should drop (and log) rather than throw (which
				// is an unhandled rejection in an async event callback).
				await waitForResult(
					() => sendEvent.getCalls().some((call) => call.args[1]?.kind === EventKind.deviceAdded),
					"in-flight deviceAdded event did not reach sendEvent",
				);
			} finally {
				marker.dispose();
			}
			// Allow time for any unhandled rejection to be reported by Mocha while
			// it can still be attributed to this test.
			await delay(1500);
			assert.ok(
				logMessages.some((m) => m.includes("DTD connection is unavailable")),
				"the dropped event was not logged",
			);
		} finally {
			logListener.dispose();
			await reloadExtension();
		}
	});

	it("unsubscribes device event listeners when disposed", async () => {
		const daemon = privateApi.toolingDaemon!;
		const deviceManager = privateApi.deviceManager!;
		await daemon.connected;

		const sendEvent = sb.spy(daemon, "sendEvent");
		sb.stub(deviceManager, "getSupportedPlatformsForWorkspace").resolves(["android"]);

		try {
			daemon.dispose();
			await deviceManager.deviceAdded(physicalAndroidMobile);
			// Allow time for any listener that leaked to run.
			await delay(100);
			assert.ok(
				!sendEvent.getCalls().some((call) => call.args[1]?.kind === EventKind.deviceAdded),
				"deviceAdded event was sent after the daemon was disposed",
			);
		} finally {
			await reloadExtension();
		}
	});

	it("does not register event listeners if disposed before register() runs", async () => {
		const daemon = privateApi.toolingDaemon!;
		const deviceManager = privateApi.deviceManager!;
		await daemon.connected;

		const sendEvent = sb.spy(daemon, "sendEvent");
		sb.stub(deviceManager, "getSupportedPlatformsForWorkspace").resolves(["android"]);
		const editorServices = (daemon as any).editorServices as { dispose(): void; register(): Promise<void> };

		try {
			// Simulate the race where the daemon is disposed after connecting but before
			// EditorServices.register() runs (for example an extension reload).
			editorServices.dispose();
			await editorServices.register();

			await deviceManager.deviceAdded(physicalAndroidMobile);
			// Allow time for any listener that was registered to run.
			await delay(100);
			assert.ok(
				!sendEvent.getCalls().some((call) => call.args[1]?.kind === EventKind.deviceAdded),
				"deviceAdded event was sent by a listener registered after dispose",
			);
		} finally {
			await reloadExtension();
		}
	});

	it("does not send pending active-location events after dispose", async function () {
		if (!privateApi.dartCapabilities.supportsLspOverDtd)
			this.skip();

		const daemon = privateApi.toolingDaemon!;
		await daemon.connected;

		const sendEvent = sb.spy(daemon, "sendEvent");
		const dtdDebounceMs = 1000;
		await setConfigForTest("dart", "dtdEditorActiveLocationDelay", dtdDebounceMs);

		// Our marker listener is registered after the daemon's, so when it fires the
		// daemon has already queued its (1s) debounced send. Disposing immediately
		// guarantees the timer is still pending and must be cancelled.
		let selectionChanged = false;
		const marker = vs.window.onDidChangeTextEditorSelection(() => selectionChanged = true);
		try {
			const editor = await openFile(flutterHelloWorldMainFile);
			editor.selection = new vs.Selection(new vs.Position(1, 0), new vs.Position(2, 0));
			await waitForResult(() => selectionChanged, "selection change event did not fire");
			sendEvent.resetHistory();

			daemon.dispose(); // Must cancel the pending debounced send.
			await delay(dtdDebounceMs * 2);
			assert.ok(
				!sendEvent.getCalls().some((call) => call.args[1]?.kind === EventKind.activeLocationChanged),
				"debounced active-location event was sent after dispose",
			);
		} finally {
			marker.dispose();
			await reloadExtension();
		}
	});

	it("still throws when sending an event while not connected and not shutting down", () => {
		// A daemon whose process cannot start never connects but is also not
		// (yet) shutting down, so a sendEvent here is an unexpected failure that
		// should still be surfaced rather than silently dropped.
		const daemon = new DartToolingDaemon(
			privateApi.logger,
			{ dart: "does-not-exist", dartSdkIsFromFlutter: false, isPreReleaseSdk: false },
			privateApi.dartCapabilities,
			undefined,
			[],
			1000,
			() => ({}),
			async () => { },
		);
		try {
			assert.throws(() => daemon.sendEvent(Stream.Editor, { kind: EventKind.deviceRemoved, deviceId: "fake" }));
		} finally {
			daemon.dispose();
		}
	});
});
