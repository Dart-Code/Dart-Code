import { window } from "vscode";
import { DART_DOWNLOAD_URL } from "../constants";
import { WebClient } from "../fetch";
import { Logger } from "../interfaces";
import { versionIsAtLeast } from "../utils";
import { WorkspaceContext } from "../workspace";
import { envUtils } from "./utils";

export interface UpdateCheckConfig {
	readonly checkForSdkUpdates: boolean;
	setCheckForSdkUpdates(value: boolean): Promise<void>;
}

export async function getLatestSdkVersion(webClient: WebClient): Promise<string> {
	const resp = await webClient.fetch("https://storage.googleapis.com/dart-archive/channels/stable/release/latest/VERSION");
	try {
		return (JSON.parse(resp) as { version: string }).version;
	} catch {
		throw new Error(`Failed to parse latest Dart SDK Version from JSON: ${resp}`);
	}
}

export async function checkForStandardDartSdkUpdates(logger: Logger, config: UpdateCheckConfig, workspaceContext: WorkspaceContext, webClient: WebClient): Promise<void> {
	if (!config.checkForSdkUpdates || workspaceContext.config.disableSdkUpdateChecks)
		return;

	// Sometimes people use the Dart SDK inside Flutter for non-Flutter projects. Since that SDK is
	// versioned with Flutter, it never makes sense to prompt the user to update the Dart SDK.
	if (workspaceContext.sdks.dartSdkIsFromFlutter)
		return;

	const dartSdkVersion = workspaceContext.sdks.dartVersion;
	try {
		const version = await getLatestSdkVersion(webClient);
		if (!dartSdkVersion || versionIsAtLeast(dartSdkVersion, version))
			return;

		const goToDownloadsAction = "Go to Dart Downloads";
		const dontShowAgainAction = "Disable Update Checks";
		const message = `Version ${version} of the Dart SDK is available (you have ${dartSdkVersion}). Some features of Dart Code may not work correctly with an old SDK.`;
		const action = await window.showWarningMessage(message, goToDownloadsAction, dontShowAgainAction);
		if (action === goToDownloadsAction)
			await envUtils.openInBrowser(DART_DOWNLOAD_URL);
		else if (action === dontShowAgainAction)
			void config.setCheckForSdkUpdates(false);

	} catch (e) {
		logger.error(e);
	}
}
