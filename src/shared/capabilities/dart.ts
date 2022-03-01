import { versionIsAtLeast } from "../../shared/utils";

export class DartCapabilities {
	public static get empty() { return new DartCapabilities("0.0.0"); }

	public version: string;

	constructor(dartVersion: string) {
		this.version = dartVersion;
	}

	get canDefaultLsp() { return versionIsAtLeast(this.version, "2.12.0-0"); }
	// This is also missing in v2.10, but assume it will be back in v2.11.
	// https://github.com/dart-lang/sdk/issues/43207
	get includesSourceForSdkLibs() { return versionIsAtLeast(this.version, "2.2.1") && !this.version.startsWith("2.10."); }
	get hasLspInsertTextModeSupport() { return versionIsAtLeast(this.version, "2.13.0-0"); }
	get supportsSnippetTextEdits() { return versionIsAtLeast(this.version, "2.13.0-150"); }
	get supportsWriteServiceInfo() { return versionIsAtLeast(this.version, "2.7.1"); }
	get supportsDartCreate() { return versionIsAtLeast(this.version, "2.10.0"); }
	get supportsDebugInternalLibraries() { return versionIsAtLeast(this.version, "2.9.0-a"); }
	get supportsDisableDartDev() { return versionIsAtLeast(this.version, "2.12.0-0"); }
	get hasDdsTimingFix() { return versionIsAtLeast(this.version, "2.13.0-117"); }
	get supportsLanguageServerCommand() { return versionIsAtLeast(this.version, "2.14.4"); }
	get supportsNoServeDevTools() { return versionIsAtLeast(this.version, "2.14.0-172.0"); }
	get supportsPubUpgradeMajorVersions() { return versionIsAtLeast(this.version, "2.12.0"); }
	get supportsPubOutdated() { return versionIsAtLeast(this.version, "2.8.0-a"); }
	get supportsPubDepsJson() { return versionIsAtLeast(this.version, "2.14.0-0"); }
	get supportsDartPub() { return versionIsAtLeast(this.version, "2.12.0-0"); }
	get supportsDartRunForPub() { return versionIsAtLeast(this.version, "2.16.0-0"); }
	get supportsDartDoc() { return versionIsAtLeast(this.version, "2.16.0"); }
	get supportsDartDevTools() { return versionIsAtLeast(this.version, "2.15.0"); }
	get supportsDartRunTest() { return versionIsAtLeast(this.version, "2.12.0-0"); }
	get supportsNonFileSchemeWorkspaces() { return versionIsAtLeast(this.version, "2.13.0-28"); }
	get supportsSdkDap() { return versionIsAtLeast(this.version, "2.16.0"); }
	// TODO: Update these (along with Flutter) when supported.
	get webSupportsEvaluation() { return false; }
	get webSupportsDebugging() { return true; }
	get webSupportsHotReload() { return false; }
}
