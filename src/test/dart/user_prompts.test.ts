import { strict as assert } from "assert";
import * as sinon from "sinon";
import * as vs from "vscode";
import { doNotAskAgainAction, flutterSurveyDataUrl, longRepeatPromptThreshold, noRepeatPromptThreshold, openAction, skipThisSurveyAction, takeSurveyAction, twoHoursInMs, wantToTryDevToolsPrompt } from "../../shared/constants";
import { Analytics } from "../../shared/interfaces";
import { nullLogger } from "../../shared/logging";
import { waitFor } from "../../shared/utils/promises";
import { showDevToolsNotificationIfAppropriate, showFlutterSurveyNotificationIfAppropriate, showSdkDeprecationNoticeIfAppropriate } from "../../shared/vscode/user_prompts";
import { activateWithoutAnalysis, clearAllContext, flutterTestSurveyID, logger, privateApi, sb } from "../helpers";

describe("DevTools notification", async () => {
	beforeEach("activate", () => activateWithoutAnalysis());
	beforeEach("clearExtensionContext", () => clearAllContext(privateApi.context));
	afterEach("clearExtensionContext", () => clearAllContext(privateApi.context));

	it("is shown from a blank slate and updates context values", async () => {
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const wantToTryPrompt = showInformationMessage.withArgs(wantToTryDevToolsPrompt, sinon.match.any).resolves(openAction);

		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openDevToolsCommand = executeCommand.withArgs("dart.openDevTools").resolves();

		const res = await showDevToolsNotificationIfAppropriate(privateApi.context);

		// Was asked, and launched..
		assert.equal(wantToTryPrompt.calledOnce, true);
		assert.equal(openDevToolsCommand.calledOnce, true);
		assert.equal(res.didOpen, true);

		// Flags were updated.
		const context = privateApi.context;
		assert.equal(context.devToolsNotificationDoNotShow, false);
		// Marked as shown within the last 10 seconds.
		assert.equal(context.devToolsNotificationLastShown && context.devToolsNotificationLastShown > Date.now() - 10000 && context.devToolsNotificationLastShown <= Date.now(), true);
	});

	it("shows and updates context values when already set", async () => {
		const context = privateApi.context;
		context.devToolsNotificationLastShown = Date.now() - (noRepeatPromptThreshold + twoHoursInMs);

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const wantToTryPrompt = showInformationMessage.withArgs(wantToTryDevToolsPrompt, sinon.match.any).resolves(openAction);

		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openDevToolsCommand = executeCommand.withArgs("dart.openDevTools").resolves();

		const res = await showDevToolsNotificationIfAppropriate(privateApi.context);

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
		const context = privateApi.context;
		const fiveHoursInMs = 1000 * 60 * 60 * 5;
		context.devToolsNotificationLastShown = Date.now() - fiveHoursInMs;

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const wantToTryPrompt = showInformationMessage.withArgs(wantToTryDevToolsPrompt, sinon.match.any).resolves(openAction);

		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openDevToolsCommand = executeCommand.withArgs("dart.openDevTools").resolves();

		const res = await showDevToolsNotificationIfAppropriate(privateApi.context);

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

		const res = await showDevToolsNotificationIfAppropriate(privateApi.context);

		// Was asked, but not launched.
		assert.equal(wantToTryPrompt.called, true);
		assert.equal(openDevToolsCommand.called, false);
		assert.equal(res.didOpen, false);

		// Flag was written.
		assert.equal(privateApi.context.devToolsNotificationDoNotShow, true);
	});

	it("does not prompt if told not to ask again", async () => {
		privateApi.context.devToolsNotificationDoNotShow = true;

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const wantToTryPrompt = showInformationMessage.withArgs(wantToTryDevToolsPrompt, sinon.match.any).resolves(doNotAskAgainAction);

		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openDevToolsCommand = executeCommand.withArgs("dart.openDevTools", sinon.match.any).resolves();

		const res = await showDevToolsNotificationIfAppropriate(privateApi.context);

		// Was not asked, or launched.
		assert.equal(wantToTryPrompt.called, false);
		assert.equal(openDevToolsCommand.called, false);
		assert.equal(res.didOpen, false);
	});
});

describe("Survey notification", async () => {
	beforeEach("activate", () => activateWithoutAnalysis());
	beforeEach("clearExtensionContext", () => clearAllContext(privateApi.context));
	afterEach("clearExtensionContext", () => clearAllContext(privateApi.context));

	beforeEach("setUpSurveyJsonMock", () => {
		const fetch = sb.stub(privateApi.webClient, "fetch").callThrough();
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

	const mockAnalytics: Analytics = {
		logFlutterSurveyClicked: () => { },
		logFlutterSurveyDismissed: () => { },
		logFlutterSurveyShown: () => { },
	};
	let surveyClicked: sinon.SinonStub;
	let surveyDismissed: sinon.SinonStub;
	let surveyShown: sinon.SinonStub;
	beforeEach("set up analytics mock", () => {
		surveyClicked = sb.stub(mockAnalytics, "logFlutterSurveyClicked").callThrough();
		surveyDismissed = sb.stub(mockAnalytics, "logFlutterSurveyDismissed").callThrough();
		surveyShown = sb.stub(mockAnalytics, "logFlutterSurveyShown").callThrough();
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

		const openBrowserCommand = sb.stub(privateApi.envUtils, "openInBrowser").resolves();

		const res = await showFlutterSurveyNotificationIfAppropriate(privateApi.context, privateApi.webClient, mockAnalytics, privateApi.workspaceContext, privateApi.envUtils.openInBrowser, surveyIsOpenDate, logger);

		// Was asked, and launched..
		assert.equal(openSurveyPrompt.calledOnce, true);
		await waitFor(() => openBrowserCommand.called);
		assert.equal(openBrowserCommand.calledOnce, true);
		assert.equal(res, true);
		assert.equal(surveyShown.calledOnce, true);
		assert.equal(surveyClicked.calledOnce, true);

		// Flags were updated.
		const context = privateApi.context;
		assert.equal(context.getFlutterSurveyNotificationDoNotShow(flutterTestSurveyID), true);
		// Marked as shown within the last 10 seconds.
		const lastShown = context.getFlutterSurveyNotificationLastShown(flutterTestSurveyID);
		assert.equal(lastShown && lastShown > Date.now() - 10000 && lastShown <= Date.now(), true);
	});

	it("shows and updates context values when already seen", async () => {
		const context = privateApi.context;
		context.setFlutterSurveyNotificationLastShown(flutterTestSurveyID, surveyIsOpenDate - (longRepeatPromptThreshold + twoHoursInMs));

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(takeSurveyAction);

		const openBrowserCommand = sb.stub(privateApi.envUtils, "openInBrowser").resolves();

		const res = await showFlutterSurveyNotificationIfAppropriate(privateApi.context, privateApi.webClient, mockAnalytics, privateApi.workspaceContext, privateApi.envUtils.openInBrowser, surveyIsOpenDate, logger);

		// Was asked, and launched..
		assert.equal(openSurveyPrompt.calledOnce, true);
		await waitFor(() => openBrowserCommand.called);
		assert.equal(openBrowserCommand.calledOnce, true);
		assert.equal(res, true);
		assert.equal(surveyShown.calledOnce, true);

		// Flags were updated.
		assert.equal(context.getFlutterSurveyNotificationDoNotShow(flutterTestSurveyID), true);
		// Marked as shown within the last 10 seconds.
		const lastShown = context.getFlutterSurveyNotificationLastShown(flutterTestSurveyID);
		assert.equal(lastShown && lastShown > Date.now() - 10000 && lastShown <= Date.now(), true);
	});

	it("does not show if shown in the last 40 hours", async () => {
		const context = privateApi.context;
		const now = surveyIsOpenDate;
		const fiveHoursInMs = 1000 * 60 * 60 * 5;
		context.setFlutterSurveyNotificationLastShown(flutterTestSurveyID, now - fiveHoursInMs);

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(takeSurveyAction);

		const openBrowserCommand = sb.stub(privateApi.envUtils, "openInBrowser").resolves();

		const res = await showFlutterSurveyNotificationIfAppropriate(privateApi.context, privateApi.webClient, mockAnalytics, privateApi.workspaceContext, privateApi.envUtils.openInBrowser, now, logger);

		// Was not asked, or launched.
		assert.equal(openSurveyPrompt.called, false);
		assert.equal(openBrowserCommand.called, false);
		assert.equal(res, false);
		assert.equal(surveyShown.called, false);
	});

	it("writes do-not-show-again flag if clicked", async () => {
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(skipThisSurveyAction);

		const openBrowserCommand = sb.stub(privateApi.envUtils, "openInBrowser").resolves();

		const res = await showFlutterSurveyNotificationIfAppropriate(privateApi.context, privateApi.webClient, mockAnalytics, privateApi.workspaceContext, privateApi.envUtils.openInBrowser, surveyIsOpenDate, logger);

		// Was asked, but not launched.
		assert.equal(openSurveyPrompt.called, true);
		assert.equal(openBrowserCommand.called, false);
		assert.equal(res, true);
		assert.equal(surveyShown.calledOnce, true);
		assert.equal(surveyDismissed.calledOnce, true);

		// Flag was written.
		await waitFor(() => privateApi.context.getFlutterSurveyNotificationDoNotShow(flutterTestSurveyID));
		assert.equal(privateApi.context.getFlutterSurveyNotificationDoNotShow(flutterTestSurveyID), true);
	});

	it("does not prompt if told not to ask again", async () => {
		privateApi.context.setFlutterSurveyNotificationDoNotShow(flutterTestSurveyID, true);

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(skipThisSurveyAction);

		const openBrowserCommand = sb.stub(privateApi.envUtils, "openInBrowser").resolves();

		const res = await showFlutterSurveyNotificationIfAppropriate(privateApi.context, privateApi.webClient, mockAnalytics, privateApi.workspaceContext, privateApi.envUtils.openInBrowser, surveyIsOpenDate, logger);

		// Was not asked, or launched.
		assert.equal(openSurveyPrompt.called, false);
		assert.equal(openBrowserCommand.called, false);
		assert.equal(res, false);
		assert.equal(surveyShown.called, false);
	});

	it("does not show before survey opens", async () => {
		assert.equal(await showFlutterSurveyNotificationIfAppropriate(privateApi.context, privateApi.webClient, mockAnalytics, privateApi.workspaceContext, privateApi.envUtils.openInBrowser, immediatelyBeforeSurveyOpensDate, logger), false);
		assert.equal(surveyShown.called, false);
	});
	it("shows after survey opens", async () => {
		assert.equal(await showFlutterSurveyNotificationIfAppropriate(privateApi.context, privateApi.webClient, mockAnalytics, privateApi.workspaceContext, privateApi.envUtils.openInBrowser, immediatelyAfterSurveyOpensDate, logger), true);
		assert.equal(surveyShown.calledOnce, true);
	});
	it("shows before survey closes", async () => {
		assert.equal(await showFlutterSurveyNotificationIfAppropriate(privateApi.context, privateApi.webClient, mockAnalytics, privateApi.workspaceContext, privateApi.envUtils.openInBrowser, immediatelyBeforeSurveyClosesDate, logger), true);
		assert.equal(surveyShown.calledOnce, true);
	});
	it("does not show after survey closes", async () => {
		assert.equal(await showFlutterSurveyNotificationIfAppropriate(privateApi.context, privateApi.webClient, mockAnalytics, privateApi.workspaceContext, privateApi.envUtils.openInBrowser, immediatelyAfterSurveyClosesDate, logger), false);
		assert.equal(surveyShown.called, false);
	});
});

describe("SDK deprecation notice", async () => {
	let showWarningMessage: sinon.SinonStub;

	beforeEach("activate", () => activateWithoutAnalysis());
	beforeEach("set showWarningMessage stub", () => {
		showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves();
	});
	beforeEach("clearExtensionContext", () => clearAllContext(privateApi.context));
	afterEach("clearExtensionContext", () => clearAllContext(privateApi.context));


	function configure(options: {
		dartVersion?: string,
		flutterVersion?: string,
		dartIsFromFlutter?: boolean,
		isUnsupported: boolean,
		isUnsupportedSoon: boolean,
	}) {
		sb.stub(privateApi.workspaceContext.sdks, "dartVersion").get(() => options.dartVersion ?? "1.1.1");
		sb.stub(privateApi.workspaceContext.sdks, "flutterVersion").get(() => options.flutterVersion ?? "2.2.2");
		sb.stub(privateApi.workspaceContext.sdks, "dartSdkIsFromFlutter").get(() => options.dartIsFromFlutter ?? false);
		sb.stub(privateApi.dartCapabilities, "isUnsupportedNow").get(() => options.isUnsupported);
		sb.stub(privateApi.dartCapabilities, "isUnsupportedSoon").get(() => options.isUnsupportedSoon);
	}

	async function testNotification() {
		await showSdkDeprecationNoticeIfAppropriate(nullLogger, privateApi.context, privateApi.workspaceContext, privateApi.dartCapabilities);
	}

	it("is not shown if the current SDK is supported", async () => {
		configure({
			isUnsupported: false,
			isUnsupportedSoon: false,
		});
		await testNotification();

		assert.equal(showWarningMessage.called, false);
	});

	it("is shown if the current SDK is unsupported now (Dart)", async () => {
		configure({
			isUnsupported: true,
			isUnsupportedSoon: true, // isUnsupported is always checked first.
		});
		await testNotification();

		assert.equal(showWarningMessage.calledOnce, true);
		assert.equal(showWarningMessage.firstCall.args[0], "v1.1 of the Dart SDK is not supported by this version of the Dart extension. Update to a more recent Dart SDK or switch to an older version of the extension.");
	});

	it("is shown if the current SDK is unsupported now (Flutter)", async () => {
		configure({
			dartIsFromFlutter: true,
			isUnsupported: true, // isUnsupported is always checked first.
			isUnsupportedSoon: true,
		});
		await testNotification();

		assert.equal(showWarningMessage.calledOnce, true);
		assert.equal(showWarningMessage.firstCall.args[0], "v2.2 of the Flutter SDK is not supported by this version of the Dart extension. Update to a more recent Flutter SDK or switch to an older version of the extension.");
	});

	it("is shown if the current SDK is unsupported soon (Dart)", async () => {
		configure({
			isUnsupported: false,
			isUnsupportedSoon: true,
		});
		await testNotification();


		assert.equal(showWarningMessage.calledOnce, true);
		assert.equal(showWarningMessage.firstCall.args[0], "Support for v1.1 of the Dart SDK will be removed in an upcoming release of the Dart extension. Consider updating to a more recent Dart SDK.");
	});

	it("is shown if the current SDK is unsupported soon (Flutter)", async () => {
		configure({
			dartIsFromFlutter: true,
			isUnsupported: false,
			isUnsupportedSoon: true,
		});
		await testNotification();

		assert.equal(showWarningMessage.calledOnce, true);
		assert.equal(showWarningMessage.firstCall.args[0], "Support for v2.2 of the Flutter SDK will be removed in an upcoming release of the Dart extension. Consider updating to a more recent Flutter SDK.");
	});

	it("is shown every time if the current SDK is unsupported now", async () => {
		configure({
			isUnsupported: true,
			isUnsupportedSoon: true,
		});
		await testNotification();
		await testNotification();

		assert.equal(showWarningMessage.calledTwice, true);
	});

	it("is only once if the current SDK is unsupported soon", async () => {
		configure({
			isUnsupported: false,
			isUnsupportedSoon: true,
		});
		await testNotification();
		await testNotification();

		assert.equal(showWarningMessage.calledOnce, true);
	});

	it("is shown for different major/minor SDK versions that are unsupported soon", async () => {
		configure({
			dartVersion: "1.1.1",
			isUnsupported: false,
			isUnsupportedSoon: true,
		});
		await testNotification();
		configure({
			dartVersion: "1.1.2",
			isUnsupported: false,
			isUnsupportedSoon: true,
		});
		await testNotification();
		configure({
			dartVersion: "1.2.3",
			isUnsupported: false,
			isUnsupportedSoon: true,
		});
		await testNotification();

		// Expect only two, because the first two are same major+minor
		assert.equal(showWarningMessage.calledTwice, true);
	});
});
