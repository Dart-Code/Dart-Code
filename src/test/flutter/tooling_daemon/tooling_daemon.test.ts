import { strict as assert } from "assert";
import * as vs from "vscode";
import { ExtensionRestartReason } from "../../../shared/constants";
import * as f from "../../../shared/flutter/daemon_interfaces";
import { EventKind, Stream } from "../../../shared/services/tooling_daemon_services";
import { PromiseCompleter } from "../../../shared/utils";
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

	it("does not send in-flight or subsequent device events when the daemon is disposed", async () => {
		defer("Reload extension", () => vs.commands.executeCommand("_dart.reloadExtension", ExtensionRestartReason.Test));

		const daemon = privateApi.toolingDaemon!;
		const deviceManager = privateApi.deviceManager!;
		await daemon.connected;

		const onDeviceAdded = new vs.EventEmitter<f.Device>();
		const onDeviceChanged = new vs.EventEmitter<f.Device>();
		defer("Dispose emitters", () => {
			onDeviceAdded.dispose();
			onDeviceChanged.dispose();
		});
		sb.stub(deviceManager, "onDeviceAdded").value(onDeviceAdded.event);
		sb.stub(deviceManager, "onDeviceChanged").value(onDeviceChanged.event);
		sb.stub(daemon, "registerService").resolves();

		const editorServices = (daemon as unknown as { editorServices: { register(): Promise<void> } }).editorServices;
		await editorServices.register();

		const sendEvent = sb.spy(daemon, "sendEvent");
		const listenerGate = new PromiseCompleter<f.PlatformType[]>();
		const getSupportedPlatforms = sb.stub(deviceManager, "getSupportedPlatformsForWorkspace").returns(listenerGate.promise);

		// Fire both deviceAdded and deviceChanged while getSupportedPlatformsForWorkspace is pending.
		onDeviceAdded.fire(physicalAndroidMobile);
		onDeviceChanged.fire(physicalAndroidMobile);
		await waitForResult(() => getSupportedPlatforms.callCount >= 2, "device event listeners did not start");

		// Disposing the daemon must dispose its EditorServices, causing the in-flight
		// listeners to exit without calling sendEvent when they resume.
		daemon.dispose();
		listenerGate.resolve(["android"]);
		await delay(1);

		assert.equal(sendEvent.called, false);

		// Firing events after disposal should not invoke listeners on the disposed EditorServices.
		getSupportedPlatforms.resetHistory();
		onDeviceAdded.fire(physicalAndroidMobile);
		onDeviceChanged.fire(physicalAndroidMobile);
		await delay(1);

		assert.equal(getSupportedPlatforms.called, false);
		assert.equal(sendEvent.called, false);

		// Calling register() after EditorServices has been disposed should not register new listeners.
		await editorServices.register();
		onDeviceAdded.fire(physicalAndroidMobile);
		await delay(1);

		assert.equal(getSupportedPlatforms.called, false);
		assert.equal(sendEvent.called, false);
	});
});
