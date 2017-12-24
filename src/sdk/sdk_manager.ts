"use strict";

import * as vs from "vscode";
import * as fs from "fs";
import * as path from "path";
import { hasDartExecutable, getDartSdkVersion, Sdks } from "../utils";
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

		const sdkItems = sdkFolders.map((f) => ({
			description: f,
			detail: fs.realpathSync(f) === currentSdk && config.userDefinedSdkPath ? "Current setting" : "",
			folder: f,
			label: "Dart SDK v" + getDartSdkVersion(f),
		}));

		if (sdkItems.length === 0)
			return;

		const items = [{
			description: config.userDefinedSdkPath ? undefined : `Found at ${this.sdks.dart}`,
			detail: !config.userDefinedSdkPath ? "Current setting" : "",
			folder: undefined,
			label: "Auto-detect Dart SDK location",
		}].concat(sdkItems);

		vs.window.showQuickPick(items, { placeHolder: "Select an SDK to use" })
			.then((sdk) => { if (sdk) config.setUserDefinedSdkPath(sdk.folder); });
	}
}
