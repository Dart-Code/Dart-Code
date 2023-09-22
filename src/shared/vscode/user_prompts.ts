import * as vs from "vscode";
import { vsCodeVersion } from "../capabilities/vscode";
import { CommandSource, alwaysOpenAction, doNotAskAgainAction, flutterSurveyDataUrl, longRepeatPromptThreshold, noRepeatPromptThreshold, notTodayAction, openAction, skipThisSurveyAction, takeSurveyAction, wantToTryDevToolsPrompt } from "../constants";
import { WebClient } from "../fetch";
import { Analytics, FlutterRawSurveyData, FlutterSurveyData, Logger } from "../interfaces";
import { isRunningLocally } from "./utils";
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

	const firstQsSep = surveyData.url.indexOf("?") !== -1 ? "&" : "?";
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
