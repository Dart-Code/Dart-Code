import * as semver from "semver";

export class VmServiceCapabilities {
	public static get empty() { return new VmServiceCapabilities("0.0.0"); }

	constructor(public version: string) { }

	get hasInvoke() { return versionIsAtLeast(this.version, "3.10.0"); }
	get hasLoggingStream() { return versionIsAtLeast(this.version, "3.17.0"); }
	get serviceStreamIsPublic() { return versionIsAtLeast(this.version, "3.22.0"); }
	get supportsGetStackLimit() { return versionIsAtLeast(this.version, "3.42.0"); }
	get supportsSetIsolatePauseMode() { return versionIsAtLeast(this.version, "3.53.0"); }
}

export function versionIsAtLeast(inputVersion: string, requiredVersion: string): boolean {
	return semver.gte(inputVersion, requiredVersion);
}
