import { versionIsAtLeast } from "../../shared/utils";

export class DevToolsServerCapabilities {
	public static get empty() { return new DevToolsServerCapabilities("0.0.0"); }

	public version: string;

	constructor(devToolsServerVersion: string) {
		this.version = devToolsServerVersion;
	}

	get supportsVsCodeExtensions() { return versionIsAtLeast(this.version, "1.2.0"); }
}
