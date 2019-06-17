import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Context } from "vm";
import * as vs from "vscode";
import { doNotAskAgainAction, flutterSurvey2019Q2PromptWithAnalytics, flutterSurvey2019Q2PromptWithoutAnalytics, isWin, longRepeatPromptThreshold, noRepeatPromptThreshold, noThanksAction, openDevToolsAction, takeSurveyAction, wantToTryDevToolsPrompt } from "../constants";
import { Logger } from "../interfaces";
import { openInBrowser } from "./utils";

// Mon May 13 2019 20:00:00 GMT+0100 (BST) = noon PDT on 13th May
export const surveyStart = Date.UTC(2019, 4 /* Month is 0-based!! */, 13, 19, 0);
// Mon May 27 2019 08:00:00 GMT+0100 (BST) = midnight PDT between 26th/27th may.
export const surveyEnd = Date.UTC(2019, 4 /* Month is 0-based!! */, 27, 7, 0);

/// Shows Survey notification if appropriate. Returns whether a notification was shown
/// (not whether it was clicked/opened).
export function showFlutter2019Q2SurveyNotificationIfAppropriate(context: Context, now: number, logger: Logger): boolean {
	if (now <= surveyStart || now >= surveyEnd)
		return false;

	const lastShown = context.flutterSurvey2019Q2NotificationLastShown;
	const doNotShow = context.flutterSurvey2019Q2NotificationDoNotShow;

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
			if (settings.enabled) {
				clientID = settings.clientId;
			}
		}
	} catch {
		logger.warn("Unable to read Flutter settings for preparing survey link");
	}

	const prompt = clientID ? flutterSurvey2019Q2PromptWithAnalytics : flutterSurvey2019Q2PromptWithoutAnalytics;
	const surveyUrl = "https://google.qualtrics.com/jfe/form/SV_3W3aVD2y9CoAe6V?Source=VSCode"
		+ (clientID ? `&ClientID=${encodeURIComponent(clientID)}` : "");

	// Mark the last time we've shown it (now) so we can avoid showing again for
	// 40 hours.
	context.flutterSurvey2019Q2NotificationLastShown = Date.now();

	// Prompt to show and handle response.
	vs.window.showInformationMessage(prompt, takeSurveyAction, doNotAskAgainAction).then((choice) => {
		if (choice === doNotAskAgainAction) {
			context.flutterSurvey2019Q2NotificationDoNotShow = true;
		} else if (choice === takeSurveyAction) {
			// Mark as do-not-show-again if they answer it, since it seems silly
			// to show them again if they already completed it.
			context.flutterSurvey2019Q2NotificationDoNotShow = true;
			openInBrowser(surveyUrl);
		}
	});

	// Return true because we showed the notification and don't want to cause more
	// than one notification per activation.
	return true;
}

export async function showDevToolsNotificationIfAppropriate(context: Context): Promise<boolean> {
	const lastShown = context.devToolsNotificationLastShown;
	const timesShown = context.devToolsNotificationsShown || 0;
	const doNotShow = context.devToolsNotificationDoNotShow;

	// Don't show this notification more than 10 times or if user said not to.
	if (doNotShow || timesShown >= 10)
		return false;

	// Don't show this notification if we've shown it in the last 20 hours.
	if (lastShown && Date.now() - lastShown < noRepeatPromptThreshold)
		return false;

	context.devToolsNotificationsShown = timesShown + 1;
	context.devToolsNotificationLastShown = Date.now();

	const choice = await vs.window.showInformationMessage(wantToTryDevToolsPrompt, openDevToolsAction, noThanksAction, doNotAskAgainAction);
	if (choice === doNotAskAgainAction) {
		context.devToolsNotificationDoNotShow = true;
		return false;
	} else if (choice === openDevToolsAction) {
		vs.commands.executeCommand("dart.openDevTools");
		return true;
	} else {
		// No thanks.
		return false;
	}
}
