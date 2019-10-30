import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { alwaysOpenAction, doNotAskAgainAction, flutterSurveyPromptWithAnalytics, flutterSurveyPromptWithoutAnalytics, isWin, longRepeatPromptThreshold, noRepeatPromptThreshold, notTodayAction, openDevToolsAction, surveyBaseUrl, surveyEnd, surveyStart, takeSurveyAction, wantToTryDevToolsPrompt } from "../constants";
import { Logger } from "../interfaces";
import { Context } from "./workspace";

/// Shows Survey notification if appropriate. Returns whether a notification was shown
/// (not whether it was clicked/opened).
export function showFlutterSurveyNotificationIfAppropriate(context: Context, openInBrowser: (url: string) => Promise<boolean>, now: number, logger: Logger): boolean {
	if (now <= surveyStart || now >= surveyEnd)
		return false;

	const lastShown = context.flutterSurvey2019Q4NotificationLastShown;
	const doNotShow = context.flutterSurvey2019Q4NotificationDoNotShow;

	// Don't show this notification if user previously said not to.
	if (doNotShow)
		return false;

	// Don't show this notification if we've shown it in the last 40 hours.
	if (lastShown && now - lastShown < longRepeatPromptThreshold)
		return false;

	// Work out the URL and prompt to show.
	let clientID: string | undefined;
	try {
		const flutterSettingsFolder =
			isWin ?
				process.env.APPDATA || os.homedir()
				: os.homedir();
		const flutterSettingsPath = path.join(flutterSettingsFolder, ".flutter");
		if (fs.existsSync(flutterSettingsPath)) {
			const json = fs.readFileSync(flutterSettingsPath).toString();
			const settings = JSON.parse(json);
			if (settings.enabled !== false) {
				clientID = settings.clientId;
			}
		}
	} catch {
		logger.warn("Unable to read Flutter settings for preparing survey link");
	}

	const prompt = clientID ? flutterSurveyPromptWithAnalytics : flutterSurveyPromptWithoutAnalytics;
	const surveyUrl = surveyBaseUrl
		+ (clientID ? `&ClientID=${encodeURIComponent(clientID)}` : "");

	// Mark the last time we've shown it (now) so we can avoid showing again for
	// 40 hours.
	context.flutterSurvey2019Q4NotificationLastShown = Date.now();

	// Prompt to show and handle response.
	vs.window.showInformationMessage(prompt, takeSurveyAction, doNotAskAgainAction).then(async (choice) => {
		if (choice === doNotAskAgainAction) {
			context.flutterSurvey2019Q4NotificationDoNotShow = true;
		} else if (choice === takeSurveyAction) {
			// Mark as do-not-show-again if they answer it, since it seems silly
			// to show them again if they already completed it.
			context.flutterSurvey2019Q4NotificationDoNotShow = true;
			await openInBrowser(surveyUrl);
		}
	});

	// Return true because we showed the notification and don't want to cause more
	// than one notification per activation.
	return true;
}

export async function showDevToolsNotificationIfAppropriate(context: Context): Promise<{ didOpen: boolean, shouldAlwaysOpen?: boolean }> {
	const lastShown = context.devToolsNotificationLastShown;
	const doNotShow = context.devToolsNotificationDoNotShow;

	// Don't show this notification more than 10 times or if user said not to.
	if (doNotShow)
		return { didOpen: false };

	// Don't show this notification if we've shown it in the last 20 hours.
	if (lastShown && Date.now() - lastShown < noRepeatPromptThreshold)
		return { didOpen: false };

	context.devToolsNotificationLastShown = Date.now();

	const choice = await vs.window.showInformationMessage(wantToTryDevToolsPrompt, openDevToolsAction, alwaysOpenAction, notTodayAction, doNotAskAgainAction);
	if (choice === doNotAskAgainAction) {
		context.devToolsNotificationDoNotShow = true;
		return { didOpen: false };
	} else if (choice === alwaysOpenAction) {
		vs.commands.executeCommand("dart.openDevTools");
		return { didOpen: true, shouldAlwaysOpen: true };
	} else if (choice === openDevToolsAction) {
		vs.commands.executeCommand("dart.openDevTools");
		return { didOpen: true };
	} else {
		// No thanks.
		return { didOpen: false };
	}
}
