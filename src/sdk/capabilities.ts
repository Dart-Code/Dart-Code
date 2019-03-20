import { versionIsAtLeast } from "../utils";

export class DartCapabilities {
	public static get empty() { return new DartCapabilities("0.0.0"); }

	public version: string;

	constructor(dartVersion: string) {
		this.version = dartVersion;
	}

	get supportsDevTools() { return versionIsAtLeast(this.version, "2.1.0"); }
	get includesSourceForSdkLibs() { return versionIsAtLeast(this.version, "2.2.1"); }
}
