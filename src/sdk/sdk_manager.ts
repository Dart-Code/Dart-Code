import * as vs from "vscode";
import * as fs from "fs";
import * as path from "path";
import { hasDartExecutable, getSdkVersion, Sdks, versionIsAtLeast } from "../utils";
import { config } from "../config";

export class SdkManager {
	private sdks: Sdks;

	constructor(sdks: Sdks) {
		this.sdks = sdks;
	}

	public changeSdk() {
		if (config.sdkPaths)
			this.searchForSdks(config.sdkPaths);
		else
			vs.window.showWarningMessage("Set `dart.sdkPaths` to enable fast SDK switching.");
	}

	public searchForSdks(sdkPaths: string[]) {
		const currentSdk = this.sdks.dart;

		let allPaths: string[] = [];
		sdkPaths.filter(fs.existsSync).forEach((sdkPath) => {
			allPaths.push(sdkPath);
			allPaths = allPaths.concat(fs.readdirSync(sdkPath).map((p) => path.join(sdkPath, p)));
		});

		const sdkFolders = allPaths
			.filter((f) => fs.statSync(f).isDirectory()) // Only directories.
			.filter((f) => hasDartExecutable(path.join(f, "bin"))); // Only those that look like Dart SDKs.

		const sdkItems = sdkFolders.map((f) => {
			const version = getSdkVersion(f);
			return {
				description: f,
				detail: fs.realpathSync(f) === currentSdk && config.sdkPath ? "Current setting" : "",
				folder: f,
				label: "Dart SDK v" + version,
				version,
			};
		})
			.sort((a, b) => versionIsAtLeast(a.version, b.version) ? 1 : -1);

		if (sdkItems.length === 0)
			return;

		const items = [{
			description: config.sdkPath ? undefined : `Found at ${this.sdks.dart}`,
			detail: !config.sdkPath ? "Current setting" : "",
			folder: undefined,
			label: "Auto-detect Dart SDK location",
		}].concat(sdkItems);

		vs.window.showQuickPick(items, { placeHolder: "Select an SDK to use" })
			.then((sdk) => { if (sdk) config.setSdkPath(sdk.folder); });
	}
}
