import { window } from "vscode";
import { config } from "../config";
import { ProjectType, Sdks, getLatestSdkVersion, openInBrowser, versionIsAtLeast } from "../utils";
import { logError } from "../utils/log";
import { DART_DOWNLOAD_URL } from "./utils";

export async function checkForSdkUpdates(sdks: Sdks, dartSdkVersion: string): Promise<void> {
	if (!config.checkForSdkUpdates || sdks.projectType !== ProjectType.Dart)
		return;

	try {
		const version = await getLatestSdkVersion();
		if (versionIsAtLeast(dartSdkVersion, version))
			return;

		const message = `Version ${version} of the Dart SDK is available (you have ${dartSdkVersion}). Some features of Dart Code may not work correctly with an old SDK.`;
		if (await window.showWarningMessage(message, "Go to Dart Downloads"))
			openInBrowser(DART_DOWNLOAD_URL);

	} catch (e) {
		logError(e);
	}
}
