"use strict";

import * as vs from "vscode";
import * as fs from "fs";
import * as path from "path";
import { hasDartExecutable, getDartSdkVersion } from "../utils";
import { config } from "../config";

export class SdkManager {
	changeSdk(currentSdk: string) {
		this.searchForSdks(currentSdk, config.sdkPaths);
	}

	searchForSdks(currentSdk: string, sdkContainerFolder: string) {
		const paths = fs.readdir(sdkContainerFolder, (err: any, files: string[]) => {
			if (err)
				return;

			const sdkFolders = files
				.map(f => path.join(sdkContainerFolder, f))
				.filter(f => fs.statSync(f).isDirectory()) // Only directories.
				.filter(f => hasDartExecutable(path.join(f, "bin"))); // Only those that look like Dart SDKs.

			const sdkItems = sdkFolders.map(f => ({
				folder: f,
				label: "Dart SDK v" + getDartSdkVersion(f),
				description: f,
				detail: fs.realpathSync(f) == currentSdk && config.userDefinedSdkPath ? "Current setting" : ""
			}));

			if (sdkItems.length == 0)
				return;

			const items = [{
				folder: undefined,
				label: "Use the Dart SDK found in PATH",
				description: undefined,
				detail: !config.userDefinedSdkPath ? "Current setting" : ""
			}].concat(sdkItems);

			vs.window.showQuickPick(items, { placeHolder: "Select an SDK to use" })
				.then(sdk => { if (sdk) config.setUserDefinedSdkPath(sdk.folder); });
		});
	}
}