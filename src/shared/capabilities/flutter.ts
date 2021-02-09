import { versionIsAtLeast } from "../utils";

export class FlutterCapabilities {
	public static get empty() { return new FlutterCapabilities("0.0.0"); }

	public version: string;

	constructor(flutterVersion: string) {
		this.version = flutterVersion;
	}

	get supportsCreatingSamples() { return versionIsAtLeast(this.version, "1.0.0"); }
	get hasLatestStructuredErrorsWork() { return versionIsAtLeast(this.version, "1.21.0-5.0"); }
	get supportsFlutterCreateListSamples() { return versionIsAtLeast(this.version, "1.3.10"); }
	get supportsWsVmService() { return versionIsAtLeast(this.version, "1.18.0-5"); }
	get supportsWsDebugBackend() { return versionIsAtLeast(this.version, "1.21.0-0"); }
	get supportsExposeUrl() { return versionIsAtLeast(this.version, "1.18.0-5"); }
	get supportsDartDefine() { return versionIsAtLeast(this.version, "1.17.0"); }
	get supportsRestartDebounce() { return versionIsAtLeast(this.version, "1.21.0-0"); }
	get supportsShowWebServerDevice() { return versionIsAtLeast(this.version, "1.26.0-0"); }
	get supportsWebRendererOption() { return versionIsAtLeast(this.version, "1.25.0-0"); }
	get supportsDevToolsServerAddress() { return versionIsAtLeast(this.version, "1.26.0-12"); }
	// TODO: Set this correctly.
	get supportsRunningIntegrationTests() { return versionIsAtLeast(this.version, "9.9.9"); }
	// TODO: Update these (along with Dart) when supported.
	get webSupportsEvaluation() { return false; }
	get webSupportsDebugging() { return true; }
	get webSupportsHotReload() { return false; }
}

export class DaemonCapabilities {
	public static get empty() { return new DaemonCapabilities("0.0.0"); }

	public version: string;

	constructor(daemonProtocolVersion: string) {
		this.version = daemonProtocolVersion;
	}

	get canCreateEmulators() { return versionIsAtLeast(this.version, "0.4.0"); }
	get canFlutterAttach() { return versionIsAtLeast(this.version, "0.4.1"); }
	get providesPlatformTypes() { return versionIsAtLeast(this.version, "0.5.2"); }
}
