import { PubGlobal } from "./global";

const packageName = "webdev";
const packageID = "webdev";

export class WebDev {
	constructor(private pubGlobal: PubGlobal) { }

	public promptToInstallIfRequired() {
		return this.pubGlobal.promptToInstallIfRequired(packageName, packageID, undefined, "1.0.1"); // TODO: Confirm version.
	}
}
