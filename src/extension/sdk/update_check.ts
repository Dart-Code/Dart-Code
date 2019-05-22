import { window } from "vscode";
import { DART_DOWNLOAD_URL } from "../../shared/constants";
import { WorkspaceContext } from "../../shared/workspace";
import { config } from "../config";
import { getLatestSdkVersion, openInBrowser, versionIsAtLeast } from "../utils";
import { logError } from "../utils/log";

export async function checkForStandardDartSdkUpdates(workspaceContext: WorkspaceContext): Promise<void> {
	if (!config.checkForSdkUpdates || !workspaceContext.hasOnlyDartProjects)
		return;

	// Someties people use the Dart SDK inside Flutter for non-Flutter projects. Since we'll never want
	// to do SDK update checks in that situation (esp. as it's VERSION file is bad!) we should skip in
	// that case.
	if (workspaceContext.sdks.dartSdkIsFromFlutter)
		return;

	const dartSdkVersion = workspaceContext.sdks.dartVersion;
	try {
		const version = await getLatestSdkVersion();
		if (!dartSdkVersion || versionIsAtLeast(dartSdkVersion, version))
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
