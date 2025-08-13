import { versionIsAtLeast } from "../utils";

export class FlutterCapabilities {
	public static get empty() { return new FlutterCapabilities("0.0.0"); }

	public version: string;

	constructor(flutterVersion: string) {
		this.version = flutterVersion;
	}

	/// Used to keep the percentage of DAP users on < 3.13 lower and increase only for newer.
	get useLegacyDapExperiment() { return !versionIsAtLeast(this.version, "3.13.0"); }
	get hasSdkDapWithStructuredErrors() { return versionIsAtLeast(this.version, "3.16.0-0"); }
	get supportsIOSLanguage() { return !versionIsAtLeast(this.version, "3.23.0"); } // https://github.com/flutter/flutter/issues/148586#issuecomment-2137140743
	get supportsAddPubRootDirectories() { return versionIsAtLeast(this.version, "3.19.0"); }
	get requiresForcedDebugModeForNoDebug() { return versionIsAtLeast(this.version, "3.13.0-0"); } // TODO(dantup): Add upper bound when we don't need this.
	get supportsSkeleton() { return !versionIsAtLeast(this.version, "3.29.0"); }
	// TODO(dantup): Update this to a version that includes --machine and any other flags we rely on.
	get supportsWidgetPreview() { return versionIsAtLeast(this.version, "3.33.0-1"); }
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
