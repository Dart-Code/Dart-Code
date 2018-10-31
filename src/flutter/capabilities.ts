import { versionIsAtLeast } from "../utils";

export class FlutterCapabilities {
	public static get empty() { return new FlutterCapabilities("0.0.0"); }

	public version: string;

	constructor(flutterVersion: string) {
		this.version = flutterVersion;
	}

	get supportsPidFileForMachine() { return versionIsAtLeast(this.version, "0.10.0"); }
	get trackWidgetCreationDefault() { return versionIsAtLeast(this.version, "0.10.2"); }
}
