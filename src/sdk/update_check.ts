import { window } from "vscode";
import { config } from "../config";
import { getLatestSdkVersion, openInBrowser, ProjectType, Sdks, versionIsAtLeast } from "../utils";
import { logError } from "../utils/log";
import { DART_DOWNLOAD_URL } from "./utils";

export async function checkForSdkUpdates(sdks: Sdks, dartSdkVersion: string): Promise<void> {
	if (!config.checkForSdkUpdates || sdks.projectType !== ProjectType.Dart)
		return;

	try {
		const version = await getLatestSdkVersion();
		if (versionIsAtLeast(dartSdkVersion, version))
			return;

		const goToDownloadsAction = "Go to Dart Downloads";
		const dontShowAgainAction = "Disable Update Checks";
		const message = `Version ${version} of the Dart SDK is available (you have ${dartSdkVersion}). Some features of Dart Code may not work correctly with an old SDK.`;
		const action = await window.showWarningMessage(message, goToDownloadsAction, dontShowAgainAction);
		if (action === goToDownloadsAction)
			openInBrowser(DART_DOWNLOAD_URL);
		else if (action === dontShowAgainAction)
			config.setCheckForSdkUpdates(false);

	} catch (e) {
		logError(e);
	}
}
