import { versionIsAtLeast } from "../utils";

export class FlutterCapabilities {
	public static get empty() { return new FlutterCapabilities("0.0.0"); }

	public version: string;

	constructor(flutterVersion: string) {
		this.version = flutterVersion;
	}

	get canDefaultSdkDaps() { return versionIsAtLeast(this.version, "3.9.0-14"); }
	/// Used to keep the percentage of DAP users on < 3.13 lower and increase only for newer.
	get useLegacyDapExperiment() { return !versionIsAtLeast(this.version, "3.13.0"); }
	get supportsCreateSkeleton() { return versionIsAtLeast(this.version, "2.5.0"); }
	get supportsCreateEmpty() { return versionIsAtLeast(this.version, "3.6.0-3"); }
	get supportsCreatingSamples() { return versionIsAtLeast(this.version, "1.0.0"); }
	get hasLatestStructuredErrorsWork() { return versionIsAtLeast(this.version, "1.21.0-5.0"); }
	get hasSdkDapWithStructuredErrors() { return versionIsAtLeast(this.version, "3.16.0-0"); }
	get supportsFlutterCreateListSamples() { return versionIsAtLeast(this.version, "1.3.10"); }
	get supportsFlutterHostVmServicePort() { return versionIsAtLeast(this.version, "3.0.0"); }
	get supportsWsVmService() { return versionIsAtLeast(this.version, "1.18.0-5"); }
	get supportsWsDebugBackend() { return versionIsAtLeast(this.version, "1.21.0-0"); }
	get supportsWsInjectedClient() { return versionIsAtLeast(this.version, "2.1.0-13.0"); }
	get supportsExposeUrl() { return versionIsAtLeast(this.version, "1.18.0-5"); }
	get supportsDartDefine() { return versionIsAtLeast(this.version, "1.17.0"); }
	get supportsRestartDebounce() { return versionIsAtLeast(this.version, "1.21.0-0"); }
	get supportsRunSkippedTests() { return versionIsAtLeast(this.version, "2.1.0-11"); }
	get supportsShowWebServerDevice() { return versionIsAtLeast(this.version, "1.26.0-0"); }
	get supportsAddPubRootDirectories() { return versionIsAtLeast(this.version, "3.10.0"); }
	get supportsWebRendererOption() { return versionIsAtLeast(this.version, "1.25.0-0"); }
	get supportsDevToolsServerAddress() { return versionIsAtLeast(this.version, "1.26.0-12"); }
	get supportsRunningIntegrationTests() { return versionIsAtLeast(this.version, "2.2.0-10"); }
	get supportsRunTestsByLine() { return versionIsAtLeast(this.version, "3.10.0-0"); }
	get supportsSdkDap() { return versionIsAtLeast(this.version, "2.13.0-0"); }
	get requiresDdsDisabledForSdkDapTestRuns() { return !versionIsAtLeast(this.version, "3.1.0"); }
	get requiresForcedDebugModeForNoDebug() { return versionIsAtLeast(this.version, "3.13.0-0"); } // TODO(dantup): Add upper bound when we don't need this.
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
	get supportsAvdColdBootLaunch() { return versionIsAtLeast(this.version, "0.6.1"); }
}
