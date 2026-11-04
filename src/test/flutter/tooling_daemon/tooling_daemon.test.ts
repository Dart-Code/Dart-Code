import { strict as assert } from "assert";
import * as vs from "vscode";
import { ExtensionRestartReason } from "../../../shared/constants";
import * as f from "../../../shared/flutter/daemon_interfaces";
import { LogMessage } from "../../../shared/interfaces";
import { DartToolingDaemon } from "../../../shared/services/tooling_daemon";
import { EventKind, Stream } from "../../../shared/services/tooling_daemon_services";
import { PromiseCompleter } from "../../../shared/utils";
import { activateWithoutAnalysis, defer, delay, flutterHelloWorldMainFile, openFile, privateApi, sb, setConfigForTest, waitForResult } from "../../helpers";
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
		const daemon = privateApi.toolingDaemon!;
		const deviceManager = privateApi.deviceManager!;
		await daemon.connected;
		defer("Reload extension", reloadExtension);

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

		// Our listener is invoked after the daemon's listener has started (and
		// suspended on the gate above), so this marks the daemon's listener
		// as being in-flight.
		let emitterFired = false;
		const marker = deviceManager.onDeviceAdded(() => emitterFired = true);
		defer("Dispose marker", () => { marker.dispose(); });

		void deviceManager.deviceAdded(physicalAndroidMobile);
		(deviceManager as unknown as { onDeviceChangedEmitter: vs.EventEmitter<f.Device> })
			.onDeviceChangedEmitter.fire(physicalAndroidMobile);
		await waitForResult(() => emitterFired, "deviceAdded event did not fire");
		await waitForResult(() => getSupportedPlatforms.callCount >= 3, "device event listeners did not start");

		daemon.dispose();
		listenerGate.resolve([]);

		// The in-flight listeners should resume and exit via the disposed guard
		// rather than calling sendEvent (which before the fix threw and became
		// an unhandled rejection in an async event callback).
		await delay(50);
		assert.ok(
			!sendEvent.getCalls().some((call) => call.args[1]?.kind === EventKind.deviceAdded || call.args[1]?.kind === EventKind.deviceChanged),
			"in-flight device event reached sendEvent after dispose",
		);

		// Sending an event directly after dispose should still be dropped (and
		// logged) rather than thrown.
		daemon.sendEvent(Stream.Editor, { kind: EventKind.deviceRemoved, deviceId: "fake" });
		await delay(50);
		assert.ok(
			logMessages.some((m) => m.includes("DTD connection is unavailable")),
			"the dropped event was not logged",
		);
	});

	it("does not reject a service response that is in-flight during dispose", async () => {
		const daemon = privateApi.toolingDaemon!;
		const deviceManager = privateApi.deviceManager!;
		await daemon.connected;
		defer("Reload extension", reloadExtension);

		// Wait until the Editor services have been registered over the connection.
		const serviceHandlers = () => (daemon as unknown as { serviceHandlers: Record<string, unknown> }).serviceHandlers;
		await waitForResult(() => serviceHandlers()["Editor.getDevices"] !== undefined, "Editor.getDevices was not registered");

		const getSupportedPlatforms = sb.stub(deviceManager, "getSupportedPlatformsForWorkspace");
		const listenerGate = new PromiseCompleter<f.PlatformType[]>();
		getSupportedPlatforms.returns(listenerGate.promise);

		// Simulate the DTD sending a getDevices request while the handler is
		// suspended on getSupportedPlatformsForWorkspace(), then dispose before
		// it resumes so the response is sent after the connection is gone.
		const handleData = (data: unknown) => (daemon as unknown as { handleData(d: string): Promise<void> }).handleData(JSON.stringify(data));
		const request = handleData({ id: "1", jsonrpc: "2.0", method: "Editor.getDevices", params: {} });
		await waitForResult(() => getSupportedPlatforms.callCount >= 1, "service handler did not start");

		daemon.dispose();
		listenerGate.resolve([]);

		// Without the shutdown guard in send(), the response send would throw and
		// the error-path send would also throw, producing an unhandled rejection.
		await request;
	});

	it("safely ignores lifecycle calls made after dispose", async () => {
		const daemon = privateApi.toolingDaemon!;
		await daemon.connected;
		defer("Reload extension", reloadExtension);

		daemon.dispose();

		// Async continuations that resume after dispose should complete as safe
		// no-ops rather than throwing or doing work on a dead daemon.
		const d = daemon as unknown as {
			connect(): Promise<void>;
			handleOpen(): Promise<void>;
			registerServices(): Promise<void>;
			sendWorkspaceFolders(uris: string[]): Promise<void>;
			sendActiveLocation(location: unknown): Promise<void>;
			setUpVmServiceRegistrations(): Promise<void>;
			registerVmService(args: { name: string; vmServiceUri: string }): Promise<void>;
			unregisterVmService(uri: string): Promise<void>;
		};
		await d.connect();
		await d.handleOpen();
		await d.registerServices();
		await d.sendWorkspaceFolders([]);
		await d.sendActiveLocation({ selections: [] });
		await d.setUpVmServiceRegistrations();
		await d.registerVmService({ name: "test", vmServiceUri: "ws://localhost/ws" });
		await d.unregisterVmService("ws://localhost/ws");
	});

	it("unsubscribes device event listeners when disposed", async () => {
		const daemon = privateApi.toolingDaemon!;
		const deviceManager = privateApi.deviceManager!;
		await daemon.connected;
		defer("Reload extension", reloadExtension);

		const sendEvent = sb.spy(daemon, "sendEvent");
		sb.stub(deviceManager, "getSupportedPlatformsForWorkspace").resolves(["android"]);

		daemon.dispose();
		await deviceManager.deviceAdded(physicalAndroidMobile);
		// Allow time for any listener that leaked to run.
		await delay(50);
		assert.ok(
			!sendEvent.getCalls().some((call) => call.args[1]?.kind === EventKind.deviceAdded),
			"deviceAdded event was sent after the daemon was disposed",
		);
	});

	it("does not register event listeners if disposed before register() runs", async () => {
		const daemon = privateApi.toolingDaemon!;
		const deviceManager = privateApi.deviceManager!;
		await daemon.connected;
		defer("Reload extension", reloadExtension);

		const sendEvent = sb.spy(daemon, "sendEvent");
		sb.stub(deviceManager, "getSupportedPlatformsForWorkspace").resolves(["android"]);
		const editorServices = (daemon as unknown as { editorServices: { dispose(): void; register(): Promise<void> } }).editorServices;

		// Simulate the race where the daemon is disposed after connecting but before
		// EditorServices.register() runs (for example an extension reload).
		editorServices.dispose();
		await editorServices.register();

		await deviceManager.deviceAdded(physicalAndroidMobile);
		// Allow time for any listener that was registered to run.
		await delay(50);
		assert.ok(
			!sendEvent.getCalls().some((call) => call.args[1]?.kind === EventKind.deviceAdded),
			"deviceAdded event was sent by a listener registered after dispose",
		);
	});

	it("does not send pending active-location events after dispose", async function () {
		if (!privateApi.dartCapabilities.supportsLspOverDtd)
			this.skip();

		const daemon = privateApi.toolingDaemon!;
		await daemon.connected;
		defer("Reload extension", reloadExtension);

		const sendEvent = sb.spy(daemon, "sendEvent");
		const dtdDebounceMs = 50;
		await setConfigForTest("dart", "dtdEditorActiveLocationDelay", dtdDebounceMs);

		const editor = await openFile(flutterHelloWorldMainFile);
		// Allow any debounced send queued while opening the file to complete.
		await delay(dtdDebounceMs + 50);
		sendEvent.resetHistory();

		// Disposing inside a selection listener registered after the daemon's
		// listener guarantees the debounced send is still pending when
		// dispose() runs (the daemon's listener queues it first).
		const marker = vs.window.onDidChangeTextEditorSelection(() => daemon.dispose());
		defer("Dispose marker", () => { marker.dispose(); });
		editor.selection = new vs.Selection(new vs.Position(1, 0), new vs.Position(2, 0));

		await delay(dtdDebounceMs * 2);
		assert.ok(
			!sendEvent.getCalls().some((call) => call.args[1]?.kind === EventKind.activeLocationChanged),
			"debounced active-location event was sent after dispose",
		);
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
		defer("Dispose daemon", () => daemon.dispose());

		assert.throws(() => daemon.sendEvent(Stream.Editor, { kind: EventKind.deviceRemoved, deviceId: "fake" }));
	});
});
