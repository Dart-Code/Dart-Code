import { PubGlobal } from "./global";

const packageName = "webdev";
const packageID = "webdev";

export class WebDev {
	constructor(private pubGlobal: PubGlobal) { }

	public installIfRequired() {
		return this.pubGlobal.installIfRequired({ packageName, packageID, moreInfoLink: undefined, requiredVersion: "2.5.4" });
	}
}
