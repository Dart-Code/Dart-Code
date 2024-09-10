import * as vs from "vscode";
import { DartCapabilities } from "../capabilities/dart";
import { vsCodeVersion } from "../capabilities/vscode";
import { CommandSource, alwaysOpenAction, doNotAskAgainAction, flutterSurveyDataUrl, iUnderstandAction, longRepeatPromptThreshold, moreInfoAction, noRepeatPromptThreshold, notTodayAction, openAction, sdkDeprecationInformationUrl, skipThisSurveyAction, takeSurveyAction, wantToTryDevToolsPrompt } from "../constants";
import { WebClient } from "../fetch";
import { Analytics, FlutterRawSurveyData, FlutterSurveyData, Logger } from "../interfaces";
import { WorkspaceContext } from "../workspace";
import { envUtils, isRunningLocally } from "./utils";
import { Context } from "./workspace";

/// Shows Survey notification if appropriate. Returns whether a notification was shown
/// (not whether it was clicked/opened).
export async function showFlutterSurveyNotificationIfAppropriate(context: Context, webClient: WebClient, analytics: Analytics, openInBrowser: (url: string) => Promise<boolean>, now: number, logger: Logger): Promise<boolean> {
	let surveyData: FlutterSurveyData;
	try {
		const rawSurveyJson = await webClient.fetch(flutterSurveyDataUrl);
		const rawSurveyData = JSON.parse(rawSurveyJson) as FlutterRawSurveyData;

		surveyData = {
			...rawSurveyData,
			endDate: new Date(rawSurveyData.endDate).getTime(),
			startDate: new Date(rawSurveyData.startDate).getTime(),
		};

		if (!surveyData.uniqueId || !surveyData.title || !surveyData.url)
			throw new Error(`Survey data did not include ID, Title or URL:\n${rawSurveyJson}`);
	} catch (e) {
		logger.error(e);
		return false;
	}

	if (now <= surveyData.startDate || now >= surveyData.endDate)
		return false;

	const lastShown = context.getFlutterSurveyNotificationLastShown(surveyData.uniqueId);
	const doNotShow = context.getFlutterSurveyNotificationDoNotShow(surveyData.uniqueId);

	// Don't show this notification if user previously said not to.
	if (doNotShow)
		return false;

	// Don't show this notification if we've shown it in the last 40 hours.
	if (lastShown && now - lastShown < longRepeatPromptThreshold)
		return false;

	const firstQsSep = surveyData.url.includes("?") ? "&" : "?";
	const surveyUrl = `${surveyData.url}${firstQsSep}Source=VSCode`;

	// Mark the last time we've shown it (now) so we can avoid showing again for
	// 40 hours.
	context.setFlutterSurveyNotificationLastShown(surveyData.uniqueId, Date.now());

	// Prompt to show and handle response.
	analytics.logFlutterSurveyShown();
	void vs.window.showInformationMessage(surveyData.title, takeSurveyAction, skipThisSurveyAction).then(async (choice) => {
		if (choice === skipThisSurveyAction) {
			context.setFlutterSurveyNotificationDoNotShow(surveyData.uniqueId, true);
			analytics.logFlutterSurveyDismissed();
		} else if (choice === takeSurveyAction) {
			// Mark as do-not-show-again if they answer it, since it seems silly
			// to show them again if they already completed it.
			context.setFlutterSurveyNotificationDoNotShow(surveyData.uniqueId, true);
			await openInBrowser(surveyUrl);
			analytics.logFlutterSurveyClicked();
		}
	});

	// Return true because we showed the notification and don't want to cause more
	// than one notification per activation.
	return true;
}

export async function showDevToolsNotificationIfAppropriate(context: Context): Promise<{ didOpen: boolean, shouldAlwaysOpen?: boolean }> {
	if (!vsCodeVersion.supportsDevTools)
		return { didOpen: false };

	// Don't show in remote workspaces because currently DevTools fails to load if SSE doesn't work (which
	// is the case for some cloud IDE proxies).
	if (!isRunningLocally)
		return { didOpen: false };

	const lastShown = context.devToolsNotificationLastShown;
	const doNotShow = context.devToolsNotificationDoNotShow;

	// Don't show this notification more than 10 times or if user said not to.
	if (doNotShow)
		return { didOpen: false };

	// Don't show this notification if we've shown it in the last 20 hours.
	if (lastShown && Date.now() - lastShown < noRepeatPromptThreshold)
		return { didOpen: false };

	context.devToolsNotificationLastShown = Date.now();

	const choice = await vs.window.showInformationMessage(wantToTryDevToolsPrompt, openAction, alwaysOpenAction, notTodayAction, doNotAskAgainAction);
	if (choice === doNotAskAgainAction) {
		context.devToolsNotificationDoNotShow = true;
		return { didOpen: false };
	} else if (choice === alwaysOpenAction) {
		void vs.commands.executeCommand("dart.openDevTools", { commandSource: CommandSource.onDebugPrompt });
		return { didOpen: true, shouldAlwaysOpen: true };
	} else if (choice === openAction) {
		void vs.commands.executeCommand("dart.openDevTools", { commandSource: CommandSource.onDebugPrompt });
		return { didOpen: true };
	} else {
		// No thanks.
		return { didOpen: false };
	}
}

export async function showSdkDeprecationNoticeIfAppropriate(logger: Logger, context: Context, workspaceContext: WorkspaceContext, dartCapabilities: DartCapabilities): Promise<boolean> {
	if (dartCapabilities.version === DartCapabilities.empty.version)
		return false;

	if (!dartCapabilities.isUnsupportedNow && !dartCapabilities.isUnsupportedSoon)
		return false;

	const sdkKind = workspaceContext.sdks.dartSdkIsFromFlutter ? "Flutter" : "Dart";
	let userShownSdkVersion = workspaceContext.sdks.dartSdkIsFromFlutter ? workspaceContext.sdks.flutterVersion : workspaceContext.sdks.dartVersion;
	let dartSdkVersion = workspaceContext.sdks.dartVersion;

	if (!userShownSdkVersion || !dartSdkVersion)
		return false;

	try {
		// Trim to major+minor.
		userShownSdkVersion = userShownSdkVersion.split(".").slice(0, 2).join(".");
		dartSdkVersion = dartSdkVersion.split(".").slice(0, 2).join(".");

		const message = dartCapabilities.isUnsupportedNow
			? `v${userShownSdkVersion} of the ${sdkKind} SDK is not supported by this version of the Dart extension. Update to a more recent ${sdkKind} SDK or switch to an older version of the extension.`
			: `Support for v${userShownSdkVersion} of the ${sdkKind} SDK will be removed in an upcoming release of the Dart extension. Consider updating to a more recent ${sdkKind} SDK.`;

		const actions: Array<typeof moreInfoAction | typeof iUnderstandAction> = dartCapabilities.isUnsupportedNow
			? [moreInfoAction]
			: [moreInfoAction, iUnderstandAction];

		if (dartCapabilities.isUnsupportedNow || !context.getSdkDeprecationNoticeDoNotShow(dartSdkVersion)) {
			const action = await vs.window.showWarningMessage(message, ...actions);
			if (action === moreInfoAction) {
				await envUtils.openInBrowser(sdkDeprecationInformationUrl);
			}

			context.setSdkDeprecationNoticeDoNotShow(dartSdkVersion, true);

			return true;
		}
	} catch (e) {
		logger.error(e);
	}

	return false;
}
