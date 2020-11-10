import { versionIsAtLeast } from "../../shared/utils";

export class DartCapabilities {
	public static get empty() { return new DartCapabilities("0.0.0"); }

	public version: string;

	constructor(dartVersion: string) {
		this.version = dartVersion;
	}

	get generatesCodeWithUnimplementedError() { return versionIsAtLeast(this.version, "2.8.0-dev.0.0"); }
	get supportsDevTools() { return versionIsAtLeast(this.version, "2.1.0"); }
	// This is also missing in v2.10, but assume it will be back in v2.11.
	// https://github.com/dart-lang/sdk/issues/43207
	get includesSourceForSdkLibs() { return versionIsAtLeast(this.version, "2.2.1") && !this.version.startsWith("2.10."); }
	get handlesBreakpointsInPartFiles() { return versionIsAtLeast(this.version, "2.2.1-edge"); }
	get hasDocumentationInCompletions() { return !versionIsAtLeast(this.version, "2.5.1"); }
	get supportsDisableServiceTokens() { return versionIsAtLeast(this.version, "2.2.1-dev.4.2"); }
	get supportsWriteServiceInfo() { return versionIsAtLeast(this.version, "2.7.1"); }
	get supportsDebugInternalLibraries() { return versionIsAtLeast(this.version, "2.9.0-a"); }
	get supportsPubOutdated() { return versionIsAtLeast(this.version, "2.8.0-a"); }
	get hasUpdatedCompletionRanking() { return versionIsAtLeast(this.version, "2.10.0-0"); }
	get supportsDartPub() { return versionIsAtLeast(this.version, "2.12.0"); }
	// TODO: Update these (along with Flutter) when supported.
	get webSupportsEvaluation() { return false; }
	get webSupportsDebugging() { return true; }
	get webSupportsHotReload() { return false; }
}
