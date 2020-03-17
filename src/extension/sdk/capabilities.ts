import { versionIsAtLeast } from "../../shared/utils";

export class DartCapabilities {
	public static get empty() { return new DartCapabilities("0.0.0"); }

	public version: string;

	constructor(dartVersion: string) {
		this.version = dartVersion;
	}

	get generatesCodeWithUnimplementedError() { return versionIsAtLeast(this.version, "2.8.0-dev.0.0"); }
	get supportsDevTools() { return versionIsAtLeast(this.version, "2.1.0"); }
	get includesSourceForSdkLibs() { return versionIsAtLeast(this.version, "2.2.1"); }
	get handlesBreakpointsInPartFiles() { return versionIsAtLeast(this.version, "2.2.1-edge"); }
	get hasDocumentationInCompletions() { return !versionIsAtLeast(this.version, "2.5.1"); }
	get handlesPathsEverywhereForBreakpoints() { return versionIsAtLeast(this.version, "2.2.1-edge"); }
	get supportsDisableServiceTokens() { return versionIsAtLeast(this.version, "2.2.1-dev.4.2"); }
	get supportsWriteServiceInfo() { return versionIsAtLeast(this.version, "2.7.1"); }
	// TODO: Update this (along with Flutter) when supported.
	get webSupportsEvaluation() { return false; }
	get webSupportsDebugging() { return false; }
}
