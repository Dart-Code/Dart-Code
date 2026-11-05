import { strict as assert } from "assert";
import * as vs from "vscode";
import * as f from "../../../shared/flutter/daemon_interfaces";
import { LogMessage } from "../../../shared/interfaces";
import { DartToolingDaemon } from "../../../shared/services/tooling_daemon";
import { EventKind, Stream } from "../../../shared/services/tooling_daemon_services";
import { PromiseCompleter } from "../../../shared/utils";
import { FlutterDeviceManager } from "../../../shared/vscode/device_manager";
import { activateWithoutAnalysis, defer, delay, privateApi, sb, waitForResult } from "../../helpers";
import { physicalAndroidMobile } from "../flutter_test_devices";

// Tests for the events that `EditorServices` sends to the Dart Tooling Daemon,
// including https://github.com/Dart-Code/Dart-Code/issues/6347.
describe("dart tooling daemon editor events", () => {
	beforeEach("activate", () => activateWithoutAnalysis());

	beforeEach("skip if not supported", function () {
		// This workspace is a Flutter project so deviceManager should always be
		// initialized on activation. If it isn't, these tests should fail rather
		// than silently skip.
		if (!privateApi.dartCapabilities.supportsToolingDaemon)
			this.skip();
	});

	// Creates a locally constructed daemon that connects to its own DTD process.
	// Unlike the extension's own privateApi.toolingDaemon singleton, this can be
	// disposed inside tests without needing to reload the whole extension.
	async function createDaemon() {
		const daemon = new DartToolingDaemon(
			privateApi.logger,
			privateApi.workspaceContext.sdks,
			privateApi.dartCapabilities,
			undefined,
			[],
			1000,
			() => ({}),
			async () => { },
		);
		defer("Dispose daemon", () => daemon.dispose());
		await daemon.connected;
		return daemon;
	}

	// Creates EditorServices bound to the shared daemon and device manager.
	// registerService is stubbed so registering our services doesn't collide
	// with the services the real daemon already registered.
	function createEditorServices() {
		const daemon = privateApi.toolingDaemon!;
		const deviceManager = privateApi.deviceManager!;
		sb.stub(daemon, "registerService").resolves();
		const editorServices = privateApi.createEditorServices(daemon, deviceManager);
		defer("Dispose EditorServices", () => { editorServices.dispose(); });
		return { daemon, deviceManager, editorServices };
	}

	// Marks the device so a deferred cleanup can remove it again.
	function trackTestDevice(deviceManager: FlutterDeviceManager) {
		defer("Remove test device", async () => {
			await deviceManager.deviceRemoved(physicalAndroidMobile);
		});
	}

	it("sends device events to the daemon while connected", async () => {
		const daemon = privateApi.toolingDaemon!;
		const deviceManager = privateApi.deviceManager!;
		await daemon.connected;

		const sendEvent = sb.spy(daemon, "sendEvent");
		sb.stub(deviceManager, "getSupportedPlatformsForWorkspace").resolves(["android"]);

		const previousDeviceId = deviceManager.currentDevice?.id;
		defer("Restore selected device", async () => {
			await deviceManager.deviceRemoved(physicalAndroidMobile);
			await deviceManager.selectDeviceById(previousDeviceId);
		});

		void deviceManager.deviceAdded(physicalAndroidMobile);
		await waitForResult(
			() => sendEvent.getCalls().some((call) => call.args[1]?.kind === EventKind.deviceAdded),
			"deviceAdded event was not sent to the daemon",
		);

		const event = sendEvent.getCalls().find((call) => call.args[1]?.kind === EventKind.deviceAdded)!.args;
		assert.equal(event[0], Stream.Editor);
		assert.equal(event[1].device.id, physicalAndroidMobile.id);
	});

	it("does not produce an unhandled rejection when an event is in-flight during dispose", async () => {
		// This test disposes the daemon, so it needs its own isolated instance
		// rather than the shared privateApi.toolingDaemon.
		const daemon = await createDaemon();
		const deviceManager = privateApi.deviceManager!;
		const editorServices = privateApi.createEditorServices(daemon, deviceManager);
		defer("Dispose EditorServices", () => { editorServices.dispose(); });
		await editorServices.register();

		const sendEvent = sb.spy(daemon, "sendEvent");
		const getSupportedPlatforms = sb.stub(deviceManager, "getSupportedPlatformsForWorkspace");
		// Let the call inside deviceAdded() complete quickly but hold the event
		// listener's call, so the listener is still in-flight when we dispose.
		const listenerGate = new PromiseCompleter<f.PlatformType[]>();
		getSupportedPlatforms.onCall(0).resolves([]);
		getSupportedPlatforms.returns(listenerGate.promise);

		const logMessages: string[] = [];
		const logListener = privateApi.logger.onLog((msg: LogMessage) => logMessages.push(msg.message));
		defer("Dispose log listener", () => { logListener.dispose(); });

		// Our listener is invoked after the daemon's listeners have started (and
		// suspended on the gate above), so this marks them as being in-flight.
		let emitterFired = false;
		const marker = deviceManager.onDeviceAdded(() => emitterFired = true);
		defer("Dispose marker", () => { marker.dispose(); });

		trackTestDevice(deviceManager);
		void deviceManager.deviceAdded(physicalAndroidMobile);
		await waitForResult(() => emitterFired && getSupportedPlatforms.callCount >= 2, "device event listeners did not start");

		daemon.dispose();
		listenerGate.resolve([]);

		// The in-flight listeners should resume and call sendEvent, which is
		// dropped (and logged) because the daemon is shutting down. Before the
		// fix this threw and became an unhandled rejection in an async event
		// callback.
		await delay(1);
		assert.ok(
			sendEvent.getCalls().some((call) => call.args[1]?.kind === EventKind.deviceAdded),
			"in-flight device event did not reach sendEvent",
		);
		assert.ok(
			logMessages.some((m) => m.includes("DTD connection is unavailable")),
			"the dropped event was not logged",
		);
	});

	it("does not send a deviceChanged event that resolves after EditorServices was disposed", async () => {
		const { daemon, deviceManager, editorServices } = createEditorServices();

		// Replace onDeviceChanged with our own emitter so the event can be
		// fired without going through enablePlatformType (which requires a
		// real Flutter daemon). This also means the event only reaches our
		// EditorServices' listeners and not the shared daemon's own listeners
		// (which were already registered on the real emitter).
		const onDeviceChanged = new vs.EventEmitter<f.Device>();
		defer("Dispose emitter", () => { onDeviceChanged.dispose(); });
		sb.stub(deviceManager, "onDeviceChanged").value(onDeviceChanged.event);

		await editorServices.register();

		const sendEvent = sb.spy(daemon, "sendEvent");
		const listenerGate = new PromiseCompleter<f.PlatformType[]>();
		sb.stub(deviceManager, "getSupportedPlatformsForWorkspace").returns(listenerGate.promise);

		// Our listener is invoked after the EditorServices listener has started
		// (and suspended on the gate above), so this marks it as in-flight.
		let emitterFired = false;
		const marker = deviceManager.onDeviceChanged(() => emitterFired = true);
		defer("Dispose marker", () => { marker.dispose(); });

		onDeviceChanged.fire(physicalAndroidMobile);
		await waitForResult(() => emitterFired, "deviceChanged listener did not start");

		editorServices.dispose();
		listenerGate.resolve([]);

		await delay(1);
		assert.ok(
			!sendEvent.getCalls().some((call) => call.args[1]?.kind === EventKind.deviceChanged),
			"in-flight deviceChanged event was sent after EditorServices was disposed",
		);
	});

	it("does not send events from listeners that were in-flight when EditorServices was disposed", async () => {
		const { daemon, deviceManager, editorServices } = createEditorServices();

		// Use our own emitter so the event only reaches our EditorServices'
		// listeners and not the shared daemon's own listeners (which were
		// already registered on the real emitter).
		const onDeviceAdded = new vs.EventEmitter<f.Device>();
		defer("Dispose emitter", () => { onDeviceAdded.dispose(); });
		sb.stub(deviceManager, "onDeviceAdded").value(onDeviceAdded.event);

		await editorServices.register();

		const sendEvent = sb.spy(daemon, "sendEvent");
		const listenerGate = new PromiseCompleter<f.PlatformType[]>();
		sb.stub(deviceManager, "getSupportedPlatformsForWorkspace").returns(listenerGate.promise);

		// Our listener is invoked after the EditorServices listener has started
		// (and suspended on the gate above), so this marks it as in-flight.
		let emitterFired = false;
		const marker = deviceManager.onDeviceAdded(() => emitterFired = true);
		defer("Dispose marker", () => { marker.dispose(); });

		onDeviceAdded.fire(physicalAndroidMobile);
		await waitForResult(() => emitterFired, "device event listeners did not start");

		// Disposing EditorServices while a listener is suspended on
		// getSupportedPlatformsForWorkspace() should cause it to return without
		// sending the event when it resumes.
		editorServices.dispose();
		listenerGate.resolve([]);

		await delay(1);
		assert.ok(
			!sendEvent.getCalls().some((call) => call.args[1]?.kind === EventKind.deviceAdded),
			"in-flight device event was sent after EditorServices was disposed",
		);
	});

	it("unsubscribes device event listeners when disposed", async () => {
		const { daemon, deviceManager, editorServices } = createEditorServices();

		const onDeviceAdded = new vs.EventEmitter<f.Device>();
		defer("Dispose emitter", () => { onDeviceAdded.dispose(); });
		sb.stub(deviceManager, "onDeviceAdded").value(onDeviceAdded.event);

		await editorServices.register();

		const sendEvent = sb.spy(daemon, "sendEvent");
		sb.stub(deviceManager, "getSupportedPlatformsForWorkspace").resolves(["android"]);

		// Verify the listener actually fires before disposing.
		onDeviceAdded.fire(physicalAndroidMobile);
		await waitForResult(
			() => sendEvent.getCalls().some((call) => call.args[1]?.kind === EventKind.deviceAdded),
			"deviceAdded event was not sent before dispose",
		);
		sendEvent.resetHistory();

		editorServices.dispose();
		onDeviceAdded.fire(physicalAndroidMobile);
		// Allow time for any listener that leaked to run.
		await delay(1);
		assert.ok(
			!sendEvent.getCalls().some((call) => call.args[1]?.kind === EventKind.deviceAdded),
			"deviceAdded event was sent after EditorServices was disposed",
		);
	});

	it("does not register event listeners if disposed before register() runs", async () => {
		const { daemon, deviceManager, editorServices } = createEditorServices();

		const onDeviceAdded = new vs.EventEmitter<f.Device>();
		defer("Dispose emitter", () => { onDeviceAdded.dispose(); });
		sb.stub(deviceManager, "onDeviceAdded").value(onDeviceAdded.event);

		const sendEvent = sb.spy(daemon, "sendEvent");
		sb.stub(deviceManager, "getSupportedPlatformsForWorkspace").resolves(["android"]);

		// Simulate the race where EditorServices is disposed after the daemon
		// connects but before register() runs (for example an extension reload).
		editorServices.dispose();
		await editorServices.register();

		onDeviceAdded.fire(physicalAndroidMobile);
		// Allow time for any listener that was registered to run.
		await delay(1);
		assert.ok(
			!sendEvent.getCalls().some((call) => call.args[1]?.kind === EventKind.deviceAdded),
			"deviceAdded event was sent by a listener registered after dispose",
		);
	});
});
