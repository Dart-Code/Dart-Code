import * as assert from "assert";
import * as sinon from "sinon";
import * as vs from "vscode";
import { doNotAskAgainAction, flutterSurvey2019Q2PromptWithoutAnalytics, longRepeatPromptThreshold, noRepeatPromptThreshold, openDevToolsAction, takeSurveyAction, twoHoursInMs, wantToTryDevToolsPrompt } from "../../extension/constants";
import { showDevToolsNotificationIfAppropriate, showFlutter2019Q2SurveyNotificationIfAppropriate, surveyEnd, surveyStart } from "../../extension/user_prompts";
import { waitFor } from "../../extension/utils/promises";
import { activateWithoutAnalysis, clearAllContext, extApi, sb } from "../helpers";

describe("DevTools notification", async () => {
	beforeEach("activate", () => activateWithoutAnalysis());
	beforeEach("clearExtensionContext", () => clearAllContext(extApi.context));
	afterEach("clearExtensionContext", () => clearAllContext(extApi.context));

	it("is shown from a blank slate and updates context values", async () => {
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const wantToTryPrompt = showInformationMessage.withArgs(wantToTryDevToolsPrompt, sinon.match.any).resolves(openDevToolsAction);

		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openDevToolsCommand = executeCommand.withArgs("dart.openDevTools").resolves();

		const res = await showDevToolsNotificationIfAppropriate(extApi.context);

		// Was asked, and launched..
		assert.equal(wantToTryPrompt.calledOnce, true);
		assert.equal(openDevToolsCommand.calledOnce, true);
		assert.equal(res, true);

		// Flags were updated.
		const context = extApi.context;
		assert.equal(context.devToolsNotificationDoNotShow, false);
		assert.equal(context.devToolsNotificationsShown, 1);
		// Marked as shown within the last 10 seconds.
		assert.equal(context.devToolsNotificationLastShown > Date.now() - 10000 && context.devToolsNotificationLastShown <= Date.now(), true);
	});

	it("shows and updates context values when already set", async () => {
		const context = extApi.context;
		context.devToolsNotificationsShown = 3;
		context.devToolsNotificationLastShown = Date.now() - (noRepeatPromptThreshold + twoHoursInMs);

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const wantToTryPrompt = showInformationMessage.withArgs(wantToTryDevToolsPrompt, sinon.match.any).resolves(openDevToolsAction);

		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openDevToolsCommand = executeCommand.withArgs("dart.openDevTools").resolves();

		const res = await showDevToolsNotificationIfAppropriate(extApi.context);

		// Was asked, and launched..
		assert.equal(wantToTryPrompt.calledOnce, true);
		assert.equal(openDevToolsCommand.calledOnce, true);
		assert.equal(res, true);

		// Flags were updated.
		assert.equal(context.devToolsNotificationDoNotShow, false);
		assert.equal(context.devToolsNotificationsShown, 4);
		// Marked as shown within the last 10 seconds.
		assert.equal(context.devToolsNotificationLastShown > Date.now() - 10000 && context.devToolsNotificationLastShown <= Date.now(), true);
	});

	it("does not show if shown in the last 20 hours", async () => {
		const context = extApi.context;
		context.devToolsNotificationsShown = 3;
		const fiveHoursInMs = 1000 * 60 * 60 * 5;
		context.devToolsNotificationLastShown = Date.now() - fiveHoursInMs;

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const wantToTryPrompt = showInformationMessage.withArgs(wantToTryDevToolsPrompt, sinon.match.any).resolves(openDevToolsAction);

		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openDevToolsCommand = executeCommand.withArgs("dart.openDevTools").resolves();

		const res = await showDevToolsNotificationIfAppropriate(extApi.context);

		// Was not asked, or launched.
		assert.equal(wantToTryPrompt.called, false);
		assert.equal(openDevToolsCommand.called, false);
		assert.equal(res, false);
	});

	it("writes do-not-show-again flag", async () => {
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const wantToTryPrompt = showInformationMessage.withArgs(wantToTryDevToolsPrompt, sinon.match.any).resolves(doNotAskAgainAction);

		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openDevToolsCommand = executeCommand.withArgs("dart.openDevTools", sinon.match.any).resolves();

		const res = await showDevToolsNotificationIfAppropriate(extApi.context);

		// Was asked, but not launched.
		assert.equal(wantToTryPrompt.called, true);
		assert.equal(openDevToolsCommand.called, false);
		assert.equal(res, false);

		// Flag was written.
		assert.equal(extApi.context.devToolsNotificationDoNotShow, true);
	});

	it("does not prompt if told not to ask again", async () => {
		extApi.context.devToolsNotificationDoNotShow = true;

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const wantToTryPrompt = showInformationMessage.withArgs(wantToTryDevToolsPrompt, sinon.match.any).resolves(doNotAskAgainAction);

		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openDevToolsCommand = executeCommand.withArgs("dart.openDevTools", sinon.match.any).resolves();

		const res = await showDevToolsNotificationIfAppropriate(extApi.context);

		// Was not asked, or launched.
		assert.equal(wantToTryPrompt.called, false);
		assert.equal(openDevToolsCommand.called, false);
		assert.equal(res, false);
	});
});

describe("Survey notification", async () => {
	beforeEach("activate", () => activateWithoutAnalysis());
	beforeEach("clearExtensionContext", () => clearAllContext(extApi.context));
	afterEach("clearExtensionContext", () => clearAllContext(extApi.context));

	const surveyIsOpenDate = Date.UTC(2019, 4 /* Month is 0-based!! */, 18);
	const immediatelyBeforeSurveyOpensDate = surveyStart - 100;
	const immediatelyAfterSurveyOpensDate = surveyStart + 100;
	const immediatelyBeforeSurveyClosesDate = surveyEnd - 100;
	const immediatelyAfterSurveyClosesDate = surveyEnd + 100;

	const matchPrompt = sinon.match((v) => v.indexOf(flutterSurvey2019Q2PromptWithoutAnalytics) === 0);

	it("is shown from a blank slate and updates context values", async () => {
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(takeSurveyAction);

		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openBrowserCommand = executeCommand.withArgs("vscode.open", sinon.match.any).resolves();

		const res = showFlutter2019Q2SurveyNotificationIfAppropriate(extApi.context, surveyIsOpenDate);

		// Was asked, and launched..
		assert.equal(openSurveyPrompt.calledOnce, true);
		await waitFor(() => openBrowserCommand.called);
		assert.equal(openBrowserCommand.calledOnce, true);
		assert.equal(res, true);

		// Flags were updated.
		const context = extApi.context;
		assert.equal(context.flutterSurvey2019Q2NotificationDoNotShow, true);
		// Marked as shown within the last 10 seconds.
		assert.equal(context.flutterSurvey2019Q2NotificationLastShown > Date.now() - 10000 && context.flutterSurvey2019Q2NotificationLastShown <= Date.now(), true);
	});

	it("shows and updates context values when already seen", async () => {
		const context = extApi.context;
		context.flutterSurvey2019Q2NotificationLastShown = surveyIsOpenDate - (longRepeatPromptThreshold + twoHoursInMs);

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(takeSurveyAction);

		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openBrowserCommand = executeCommand.withArgs("vscode.open", sinon.match.any).resolves();

		const res = showFlutter2019Q2SurveyNotificationIfAppropriate(extApi.context, surveyIsOpenDate);

		// Was asked, and launched..
		assert.equal(openSurveyPrompt.calledOnce, true);
		await waitFor(() => openBrowserCommand.called);
		assert.equal(openBrowserCommand.calledOnce, true);
		assert.equal(res, true);

		// Flags were updated.
		assert.equal(context.flutterSurvey2019Q2NotificationDoNotShow, true);
		// Marked as shown within the last 10 seconds.
		assert.equal(context.flutterSurvey2019Q2NotificationLastShown > Date.now() - 10000 && context.flutterSurvey2019Q2NotificationLastShown <= Date.now(), true);
	});

	it("does not show if shown in the last 40 hours", async () => {
		const context = extApi.context;
		const now = surveyIsOpenDate;
		const fiveHoursInMs = 1000 * 60 * 60 * 5;
		context.flutterSurvey2019Q2NotificationLastShown = now - fiveHoursInMs;

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(takeSurveyAction);

		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openBrowserCommand = executeCommand.withArgs("vscode.open", sinon.match.any).resolves();

		const res = showFlutter2019Q2SurveyNotificationIfAppropriate(extApi.context, now);

		// Was not asked, or launched.
		assert.equal(openSurveyPrompt.called, false);
		assert.equal(openBrowserCommand.called, false);
		assert.equal(res, false);
	});

	it("writes do-not-show-again flag if clicked", async () => {
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(doNotAskAgainAction);

		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openBrowserCommand = executeCommand.withArgs("vscode.open", sinon.match.any).resolves();

		const res = showFlutter2019Q2SurveyNotificationIfAppropriate(extApi.context, surveyIsOpenDate);

		// Was asked, but not launched.
		assert.equal(openSurveyPrompt.called, true);
		assert.equal(openBrowserCommand.called, false);
		assert.equal(res, true);

		// Flag was written.
		await waitFor(() => extApi.context.flutterSurvey2019Q2NotificationDoNotShow);
		assert.equal(extApi.context.flutterSurvey2019Q2NotificationDoNotShow, true);
	});

	it("does not prompt if told not to ask again", async () => {
		extApi.context.flutterSurvey2019Q2NotificationDoNotShow = true;

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(doNotAskAgainAction);

		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openBrowserCommand = executeCommand.withArgs("vscode.open", sinon.match.any).resolves();

		const res = showFlutter2019Q2SurveyNotificationIfAppropriate(extApi.context, surveyIsOpenDate);

		// Was not asked, or launched.
		assert.equal(openSurveyPrompt.called, false);
		assert.equal(openBrowserCommand.called, false);
		assert.equal(res, false);
	});

	it("does not show before survey opens", async () => {
		assert.equal(showFlutter2019Q2SurveyNotificationIfAppropriate(extApi.context, immediatelyBeforeSurveyOpensDate), false);
	});
	it("shows after survey opens", async () => {
		assert.equal(showFlutter2019Q2SurveyNotificationIfAppropriate(extApi.context, immediatelyAfterSurveyOpensDate), true);
	});
	it("shows before survey closes", async () => {
		assert.equal(showFlutter2019Q2SurveyNotificationIfAppropriate(extApi.context, immediatelyBeforeSurveyClosesDate), true);
	});
	it("does not show after survey closes", async () => {
		assert.equal(showFlutter2019Q2SurveyNotificationIfAppropriate(extApi.context, immediatelyAfterSurveyClosesDate), false);
	});
});
