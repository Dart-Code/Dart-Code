import { versionIsAtLeast } from "../utils";

export class FlutterCapabilities {
	public static get empty() { return new FlutterCapabilities("0.0.0"); }

	public version: string;

	constructor(flutterVersion: string) {
		this.version = flutterVersion;
	}

	get supportsPidFileForMachine() { return versionIsAtLeast(this.version, "0.10.0"); }
	get trackWidgetCreationDefault() { return versionIsAtLeast(this.version, "0.10.2-pre"); }
	get supportsCreatingSamples() { return versionIsAtLeast(this.version, "1.0.0"); }
	get supportsMultipleSamplesPerElement() { return versionIsAtLeast(this.version, "1.2.2"); }
	get supportsDevTools() { return versionIsAtLeast(this.version, "1.1.0"); }
}
