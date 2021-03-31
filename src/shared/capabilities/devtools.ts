import { versionIsAtLeast } from "../../shared/utils";

export class DevToolsCapabilities {
	public static get empty() { return new DevToolsCapabilities("0.0.0"); }

	public version: string;

	constructor(dartVersion: string) {
		this.version = dartVersion;
	}

	get usesLegacyPageIds() { return !versionIsAtLeast(this.version, "0.9.6"); }
}
