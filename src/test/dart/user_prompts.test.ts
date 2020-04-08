import * as assert from "assert";
import * as sinon from "sinon";
import * as vs from "vscode";
import { doNotAskAgainAction, flutterSurveyDataUrl, longRepeatPromptThreshold, noRepeatPromptThreshold, openDevToolsAction, skipThisSurveyAction, takeSurveyAction, twoHoursInMs, wantToTryDevToolsPrompt } from "../../shared/constants";
import { waitFor } from "../../shared/utils/promises";
import { showDevToolsNotificationIfAppropriate, showFlutterSurveyNotificationIfAppropriate } from "../../shared/vscode/user_prompts";
import { activateWithoutAnalysis, clearAllContext, extApi, flutterTestSurveyID, logger, sb } from "../helpers";

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
		// Marked as shown within the last 10 seconds.
		assert.equal(context.devToolsNotificationLastShown && context.devToolsNotificationLastShown > Date.now() - 10000 && context.devToolsNotificationLastShown <= Date.now(), true);
	});

	it("shows and updates context values when already set", async () => {
		const context = extApi.context;
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
		// Marked as shown within the last 10 seconds.
		assert.equal(context.devToolsNotificationLastShown > Date.now() - 10000 && context.devToolsNotificationLastShown <= Date.now(), true);
	});

	it("does not show if shown in the last 20 hours", async () => {
		const context = extApi.context;
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

	beforeEach("setUpSurveyJsonMock", () => {
		const fetch = sb.stub(extApi.webClient, "fetch").callThrough();
		fetch.withArgs(flutterSurveyDataUrl).resolves(`
			{
				"_comments": [
					"uniqueId must be updated with each new survey so IDEs know to re-prompt users.",
					"title should not exceed 45 characters.",
					"startDate and endDate should follow ISO 8601 standard with a timezone offset."
				],
				"uniqueId": "${flutterTestSurveyID}",
				"title": "Help improve Flutter! Take our test survey.",
				"url": "https://example.org/",
				"startDate": "2001-01-01T09:00:00-08:00",
				"endDate": "2001-01-20T09:00:00-08:00"
			}
		`);
	});

	const surveyIsOpenDate = new Date("2001-01-10T15:00:00Z").getTime();
	const immediatelyBeforeSurveyOpensDate = new Date("2001-01-01T08:00:00-08:00").getTime();
	const immediatelyAfterSurveyOpensDate = new Date("2001-01-01T10:00:00-08:00").getTime();
	const immediatelyBeforeSurveyClosesDate = new Date("2001-01-20T08:00:00-08:00").getTime();
	const immediatelyAfterSurveyClosesDate = new Date("2001-01-20T10:00:00-08:00").getTime();

	const matchPrompt = sinon.match((v) => v.indexOf("Help improve Flutter! Take our test survey.") === 0);

	it("is shown from a blank slate and updates context values", async () => {
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(takeSurveyAction);

		const openBrowserCommand = sb.stub(extApi.envUtils, "openInBrowser").resolves();

		const res = await showFlutterSurveyNotificationIfAppropriate(extApi.context, extApi.webClient, extApi.envUtils.openInBrowser, surveyIsOpenDate, logger);

		// Was asked, and launched..
		assert.equal(openSurveyPrompt.calledOnce, true);
		await waitFor(() => openBrowserCommand.called);
		assert.equal(openBrowserCommand.calledOnce, true);
		assert.equal(res, true);

		// Flags were updated.
		const context = extApi.context;
		assert.equal(context.getFlutterSurveyNotificationDoNotShow(flutterTestSurveyID), true);
		// Marked as shown within the last 10 seconds.
		const lastShown = context.getFlutterSurveyNotificationLastShown(flutterTestSurveyID);
		assert.equal(lastShown && lastShown! > Date.now() - 10000 && lastShown! <= Date.now(), true);
	});

	it("shows and updates context values when already seen", async () => {
		const context = extApi.context;
		context.setFlutterSurveyNotificationLastShown(flutterTestSurveyID, surveyIsOpenDate - (longRepeatPromptThreshold + twoHoursInMs));

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(takeSurveyAction);

		const openBrowserCommand = sb.stub(extApi.envUtils, "openInBrowser").resolves();

		const res = await showFlutterSurveyNotificationIfAppropriate(extApi.context, extApi.webClient, extApi.envUtils.openInBrowser, surveyIsOpenDate, logger);

		// Was asked, and launched..
		assert.equal(openSurveyPrompt.calledOnce, true);
		await waitFor(() => openBrowserCommand.called);
		assert.equal(openBrowserCommand.calledOnce, true);
		assert.equal(res, true);

		// Flags were updated.
		assert.equal(context.getFlutterSurveyNotificationDoNotShow(flutterTestSurveyID), true);
		// Marked as shown within the last 10 seconds.
		const lastShown = context.getFlutterSurveyNotificationLastShown(flutterTestSurveyID);
		assert.equal(lastShown && lastShown! > Date.now() - 10000 && lastShown! <= Date.now(), true);
	});

	it("does not show if shown in the last 40 hours", async () => {
		const context = extApi.context;
		const now = surveyIsOpenDate;
		const fiveHoursInMs = 1000 * 60 * 60 * 5;
		context.setFlutterSurveyNotificationLastShown(flutterTestSurveyID, now - fiveHoursInMs);

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(takeSurveyAction);

		const openBrowserCommand = sb.stub(extApi.envUtils, "openInBrowser").resolves();

		const res = await showFlutterSurveyNotificationIfAppropriate(extApi.context, extApi.webClient, extApi.envUtils.openInBrowser, now, logger);

		// Was not asked, or launched.
		assert.equal(openSurveyPrompt.called, false);
		assert.equal(openBrowserCommand.called, false);
		assert.equal(res, false);
	});

	it("writes do-not-show-again flag if clicked", async () => {
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(skipThisSurveyAction);

		const openBrowserCommand = sb.stub(extApi.envUtils, "openInBrowser").resolves();

		const res = await showFlutterSurveyNotificationIfAppropriate(extApi.context, extApi.webClient, extApi.envUtils.openInBrowser, surveyIsOpenDate, logger);

		// Was asked, but not launched.
		assert.equal(openSurveyPrompt.called, true);
		assert.equal(openBrowserCommand.called, false);
		assert.equal(res, true);

		// Flag was written.
		await waitFor(() => extApi.context.getFlutterSurveyNotificationDoNotShow(flutterTestSurveyID));
		assert.equal(extApi.context.getFlutterSurveyNotificationDoNotShow(flutterTestSurveyID), true);
	});

	it("does not prompt if told not to ask again", async () => {
		extApi.context.setFlutterSurveyNotificationDoNotShow(flutterTestSurveyID, true);

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(skipThisSurveyAction);

		const openBrowserCommand = sb.stub(extApi.envUtils, "openInBrowser").resolves();

		const res = await showFlutterSurveyNotificationIfAppropriate(extApi.context, extApi.webClient, extApi.envUtils.openInBrowser, surveyIsOpenDate, logger);

		// Was not asked, or launched.
		assert.equal(openSurveyPrompt.called, false);
		assert.equal(openBrowserCommand.called, false);
		assert.equal(res, false);
	});

	it("does not show before survey opens", async () => {
		assert.equal(await showFlutterSurveyNotificationIfAppropriate(extApi.context, extApi.webClient, extApi.envUtils.openInBrowser, immediatelyBeforeSurveyOpensDate, logger), false);
	});
	it("shows after survey opens", async () => {
		assert.equal(await showFlutterSurveyNotificationIfAppropriate(extApi.context, extApi.webClient, extApi.envUtils.openInBrowser, immediatelyAfterSurveyOpensDate, logger), true);
	});
	it("shows before survey closes", async () => {
		assert.equal(await showFlutterSurveyNotificationIfAppropriate(extApi.context, extApi.webClient, extApi.envUtils.openInBrowser, immediatelyBeforeSurveyClosesDate, logger), true);
	});
	it("does not show after survey closes", async () => {
		assert.equal(await showFlutterSurveyNotificationIfAppropriate(extApi.context, extApi.webClient, extApi.envUtils.openInBrowser, immediatelyAfterSurveyClosesDate, logger), false);
	});
});
