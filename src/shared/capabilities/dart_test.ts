import { versionIsAtLeast } from "../../shared/utils";

export class DartTestCapabilities {
	public static get empty() { return new DartTestCapabilities("0.0.0"); }

	public version: string;

	constructor(testVersion: string) {
		this.version = testVersion;
	}

	get supportsIgnoreTimeouts() { return versionIsAtLeast(this.version, "1.20.1"); }
	get supportsRunTestsByLine() { return versionIsAtLeast(this.version, "1.23.1"); }
}

