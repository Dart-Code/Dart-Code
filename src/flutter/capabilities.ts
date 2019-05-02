import { versionIsAtLeast } from "../utils";

export class FlutterCapabilities {
	public static get empty() { return new FlutterCapabilities("0.0.0"); }

	public version: string;

	constructor(flutterVersion: string) {
		this.version = flutterVersion;
	}

	get supportsPidFileForMachine() { return versionIsAtLeast(this.version, "0.10.0"); }
	get supportsCreatingSamples() { return versionIsAtLeast(this.version, "1.0.0"); }
	get supportsMultipleSamplesPerElement() { return versionIsAtLeast(this.version, "1.2.2"); }
	get supportsDevTools() { return versionIsAtLeast(this.version, "1.1.0"); }
	get hasTestGroupFix() { return versionIsAtLeast(this.version, "1.3.4"); }
	get hasEvictBug() { return !versionIsAtLeast(this.version, "1.2.2"); }
	get supportsFlutterCreateListSamples() { return versionIsAtLeast(this.version, "1.3.10"); }
	get supportsUrisForFlutterAttach() { return versionIsAtLeast(this.version, "1.5.3"); }
	// TODO: Figure this out.
	get webSupportsDebugging() { return false; }
}
