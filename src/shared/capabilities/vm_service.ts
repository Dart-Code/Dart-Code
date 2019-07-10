import { versionIsAtLeast } from "../utils";

export class VmServiceCapabilities {
	public static get empty() { return new VmServiceCapabilities("0.0.0"); }

	constructor(public version: string) { }

	get hasLoggingStream() { return versionIsAtLeast(this.version, "3.17.0"); }
	get serviceStreamIsPublic() { return versionIsAtLeast(this.version, "3.22.0"); }
}
