import * as assert from "assert";
import * as sinon from "sinon";
import * as vs from "vscode";
import { doNotAskAgainAction, flutterSurveyPromptWithoutAnalytics, longRepeatPromptThreshold, noRepeatPromptThreshold, openDevToolsAction, takeSurveyAction, twoHoursInMs, wantToTryDevToolsPrompt } from "../../shared/constants";
import { waitFor } from "../../shared/utils/promises";
import { showDevToolsNotificationIfAppropriate, showFlutterSurveyNotificationIfAppropriate, surveyEnd, surveyStart } from "../../shared/vscode/user_prompts";
import { activateWithoutAnalysis, clearAllContext, extApi, logger, sb } from "../helpers";

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
		assert.equal(res.didOpen, true);

		// Flags were updated.
		const context = extApi.context;
		assert.equal(context.devToolsNotificationDoNotShow, false);
		assert.equal(context.devToolsNotificationsShown, 1);
		// Marked as shown within the last 10 seconds.
		assert.equal(context.devToolsNotificationLastShown && context.devToolsNotificationLastShown > Date.now() - 10000 && context.devToolsNotificationLastShown <= Date.now(), true);
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
		assert.equal(res.didOpen, true);

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
		assert.equal(res.didOpen, false);
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
		assert.equal(res.didOpen, false);

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
		assert.equal(res.didOpen, false);
	});
});

describe("Survey notification", async () => {
	beforeEach("activate", () => activateWithoutAnalysis());
	beforeEach("clearExtensionContext", () => clearAllContext(extApi.context));
	afterEach("clearExtensionContext", () => clearAllContext(extApi.context));

	const surveyIsOpenDate = Date.UTC(2019, 7 /* Month is 0-based!! */, 14);
	const immediatelyBeforeSurveyOpensDate = surveyStart - 100;
	const immediatelyAfterSurveyOpensDate = surveyStart + 100;
	const immediatelyBeforeSurveyClosesDate = surveyEnd - 100;
	const immediatelyAfterSurveyClosesDate = surveyEnd + 100;

	const matchPrompt = sinon.match((v) => v.indexOf(flutterSurveyPromptWithoutAnalytics) === 0);

	it("is shown from a blank slate and updates context values", async () => {
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(takeSurveyAction);

		const openBrowserCommand = sb.stub(extApi.envUtils, "openInBrowser").resolves();

		const res = showFlutterSurveyNotificationIfAppropriate(extApi.context, extApi.envUtils.openInBrowser, surveyIsOpenDate, logger);

		// Was asked, and launched..
		assert.equal(openSurveyPrompt.calledOnce, true);
		await waitFor(() => openBrowserCommand.called);
		assert.equal(openBrowserCommand.calledOnce, true);
		assert.equal(res, true);

		// Flags were updated.
		const context = extApi.context;
		assert.equal(context.flutterSurvey2019Q3NotificationDoNotShow, true);
		// Marked as shown within the last 10 seconds.
		assert.equal(context.flutterSurvey2019Q3NotificationLastShown && context.flutterSurvey2019Q3NotificationLastShown > Date.now() - 10000 && context.flutterSurvey2019Q3NotificationLastShown <= Date.now(), true);
	});

	it("shows and updates context values when already seen", async () => {
		const context = extApi.context;
		context.flutterSurvey2019Q3NotificationLastShown = surveyIsOpenDate - (longRepeatPromptThreshold + twoHoursInMs);

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(takeSurveyAction);

		const openBrowserCommand = sb.stub(extApi.envUtils, "openInBrowser").resolves();

		const res = showFlutterSurveyNotificationIfAppropriate(extApi.context, extApi.envUtils.openInBrowser, surveyIsOpenDate, logger);

		// Was asked, and launched..
		assert.equal(openSurveyPrompt.calledOnce, true);
		await waitFor(() => openBrowserCommand.called);
		assert.equal(openBrowserCommand.calledOnce, true);
		assert.equal(res, true);

		// Flags were updated.
		assert.equal(context.flutterSurvey2019Q3NotificationDoNotShow, true);
		// Marked as shown within the last 10 seconds.
		assert.equal(context.flutterSurvey2019Q3NotificationLastShown > Date.now() - 10000 && context.flutterSurvey2019Q3NotificationLastShown <= Date.now(), true);
	});

	it("does not show if shown in the last 40 hours", async () => {
		const context = extApi.context;
		const now = surveyIsOpenDate;
		const fiveHoursInMs = 1000 * 60 * 60 * 5;
		context.flutterSurvey2019Q3NotificationLastShown = now - fiveHoursInMs;

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(takeSurveyAction);

		const openBrowserCommand = sb.stub(extApi.envUtils, "openInBrowser").resolves();

		const res = showFlutterSurveyNotificationIfAppropriate(extApi.context, extApi.envUtils.openInBrowser, now, logger);

		// Was not asked, or launched.
		assert.equal(openSurveyPrompt.called, false);
		assert.equal(openBrowserCommand.called, false);
		assert.equal(res, false);
	});

	it("writes do-not-show-again flag if clicked", async () => {
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(doNotAskAgainAction);

		const openBrowserCommand = sb.stub(extApi.envUtils, "openInBrowser").resolves();

		const res = showFlutterSurveyNotificationIfAppropriate(extApi.context, extApi.envUtils.openInBrowser, surveyIsOpenDate, logger);

		// Was asked, but not launched.
		assert.equal(openSurveyPrompt.called, true);
		assert.equal(openBrowserCommand.called, false);
		assert.equal(res, true);

		// Flag was written.
		await waitFor(() => extApi.context.flutterSurvey2019Q3NotificationDoNotShow);
		assert.equal(extApi.context.flutterSurvey2019Q3NotificationDoNotShow, true);
	});

	it("does not prompt if told not to ask again", async () => {
		extApi.context.flutterSurvey2019Q3NotificationDoNotShow = true;

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(doNotAskAgainAction);

		const openBrowserCommand = sb.stub(extApi.envUtils, "openInBrowser").resolves();

		const res = showFlutterSurveyNotificationIfAppropriate(extApi.context, extApi.envUtils.openInBrowser, surveyIsOpenDate, logger);

		// Was not asked, or launched.
		assert.equal(openSurveyPrompt.called, false);
		assert.equal(openBrowserCommand.called, false);
		assert.equal(res, false);
	});

	it("does not show before survey opens", async () => {
		assert.equal(showFlutterSurveyNotificationIfAppropriate(extApi.context, extApi.envUtils.openInBrowser, immediatelyBeforeSurveyOpensDate, logger), false);
	});
	it("shows after survey opens", async () => {
		assert.equal(showFlutterSurveyNotificationIfAppropriate(extApi.context, extApi.envUtils.openInBrowser, immediatelyAfterSurveyOpensDate, logger), true);
	});
	it("shows before survey closes", async () => {
		assert.equal(showFlutterSurveyNotificationIfAppropriate(extApi.context, extApi.envUtils.openInBrowser, immediatelyBeforeSurveyClosesDate, logger), true);
	});
	it("does not show after survey closes", async () => {
		assert.equal(showFlutterSurveyNotificationIfAppropriate(extApi.context, extApi.envUtils.openInBrowser, immediatelyAfterSurveyClosesDate, logger), false);
	});
});
