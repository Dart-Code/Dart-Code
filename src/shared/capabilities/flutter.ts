import { versionIsAtLeast } from "../utils";

export class FlutterCapabilities {
	public static get empty() { return new FlutterCapabilities("0.0.0"); }

	public version: string;

	constructor(flutterVersion: string) {
		this.version = flutterVersion;
	}

	get supportsPidFileForMachine() { return versionIsAtLeast(this.version, "0.10.0"); }
	get supportsCreatingSamples() { return versionIsAtLeast(this.version, "1.0.0"); }
	get supportsMultipleSamplesPerElement() { return versionIsAtLeast(this.version, "1.2.2"); }
	get supportsDevTools() { return versionIsAtLeast(this.version, "1.1.0"); }
	get hasTestGroupFix() { return versionIsAtLeast(this.version, "1.3.4"); }
	get hasEvictBug() { return !versionIsAtLeast(this.version, "1.2.2"); }
	get hasUpdatedStructuredErrorsFormat() { return versionIsAtLeast(this.version, "1.18.0"); }
	get supportsFlutterCreateListSamples() { return versionIsAtLeast(this.version, "1.3.10"); }
	get supportsWsVmService() { return versionIsAtLeast(this.version, "1.18.0-5"); }
	get supportsWsDebugBackend() { return versionIsAtLeast(this.version, "1.20.0-8.0.pre"); }
	get supportsExposeUrl() { return versionIsAtLeast(this.version, "1.18.0-5"); }
	get supportsDartDefine() { return versionIsAtLeast(this.version, "1.17.0"); }
	get supportsRestartDebounce() { return versionIsAtLeast(this.version, "1.21.0-0"); }
	// TODO: Figure this out.
	get webSupportsDebugging() { return false; }
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
