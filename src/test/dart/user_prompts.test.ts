import { strict as assert } from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { cursorInstallMcpServer, doNotAskAgainAction, flutterSurveyDataUrl, installFlutterExtensionPromptKey, longRepeatPromptThreshold, noRepeatPromptThreshold, openAction, skipThisSurveyAction, takeSurveyAction, twoHoursInMs, wantToTryDevToolsPrompt } from "../../shared/constants";
import { Analytics } from "../../shared/interfaces";
import { nullLogger } from "../../shared/logging";
import { getDartToolDir } from "../../shared/utils/fs";
import { waitFor } from "../../shared/utils/promises";
import { showDevToolsNotificationIfAppropriate, showFlutterSurveyNotificationIfAppropriate, showSdkDeprecationNoticeIfAppropriate } from "../../shared/vscode/user_prompts";
import { GlobalState, ProfileState, WorkspaceState } from "../../shared/vscode/workspace";
import { activateWithoutAnalysis, clearAllContext, defer, flutterTestSurveyID, logger, privateApi, sb, tryDelete } from "../helpers";

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
		assert.equal(context.profileState.devToolsNotificationDoNotShow, false);
		// Marked as shown within the last 10 seconds.
		assert.equal(context.profileState.devToolsNotificationLastShown && context.profileState.devToolsNotificationLastShown > Date.now() - 10000 && context.profileState.devToolsNotificationLastShown <= Date.now(), true);
	});

	it("shows and updates context values when already set", async () => {
		const context = privateApi.context;
		context.profileState.devToolsNotificationLastShown = Date.now() - (noRepeatPromptThreshold + twoHoursInMs);

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
		assert.equal(context.profileState.devToolsNotificationDoNotShow, false);
		// Marked as shown within the last 10 seconds.
		assert.equal(context.profileState.devToolsNotificationLastShown > Date.now() - 10000 && context.profileState.devToolsNotificationLastShown <= Date.now(), true);
	});

	it("does not show if shown in the last 20 hours", async () => {
		const context = privateApi.context;
		const fiveHoursInMs = 1000 * 60 * 60 * 5;
		context.profileState.devToolsNotificationLastShown = Date.now() - fiveHoursInMs;

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
		assert.equal(privateApi.context.profileState.devToolsNotificationDoNotShow, true);
	});

	it("does not prompt if told not to ask again", async () => {
		privateApi.context.profileState.devToolsNotificationDoNotShow = true;

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

		const res = await showFlutterSurveyNotificationIfAppropriate(privateApi.context, privateApi.webClient, mockAnalytics, privateApi.workspaceContext, (url) => privateApi.envUtils.openInBrowser(url), surveyIsOpenDate, logger);

		// Was asked, and launched..
		assert.equal(openSurveyPrompt.calledOnce, true);
		await waitFor(() => openBrowserCommand.called);
		assert.equal(openBrowserCommand.calledOnce, true);
		assert.equal(res, true);
		assert.equal(surveyShown.calledOnce, true);
		assert.equal(surveyClicked.calledOnce, true);

		// Flags were updated.
		const context = privateApi.context;
		assert.equal(context.globalState.getFlutterSurveyNotificationDoNotShow(flutterTestSurveyID), true);
		// Marked as shown within the last 10 seconds.
		const lastShown = context.globalState.getFlutterSurveyNotificationLastShown(flutterTestSurveyID);
		assert.equal(lastShown && lastShown > Date.now() - 10000 && lastShown <= Date.now(), true);
	});

	it("URL-encodes query parameters", async () => {
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(takeSurveyAction);

		sb.stub(vs.env, "appName").value("Danny's Super Editor?/Beta");
		sb.stub(privateApi.workspaceContext.sdks, "dartVersion").get(() => "3.4.0 dev+1");
		sb.stub(privateApi.workspaceContext.sdks, "flutterVersion").get(() => "3.22.0 (custom)");

		const openBrowserCommand = sb.stub(privateApi.envUtils, "openInBrowser").resolves();

		const res = await showFlutterSurveyNotificationIfAppropriate(privateApi.context, privateApi.webClient, mockAnalytics, privateApi.workspaceContext, (url) => privateApi.envUtils.openInBrowser(url), surveyIsOpenDate, logger);

		assert.equal(res, true);
		await waitFor(() => openBrowserCommand.calledOnce);
		assert.equal(openBrowserCommand.firstCall.args[0], "https://example.org/?Source=Danny's%20Super%20Editor%3F%2FBeta&DartVersion=3.4.0%20dev%2B1&FlutterVersion=3.22.0%20(custom)");
	});

	it("shows and updates context values when already seen", async () => {
		const context = privateApi.context;
		context.globalState.setFlutterSurveyNotificationLastShown(flutterTestSurveyID, surveyIsOpenDate - (longRepeatPromptThreshold + twoHoursInMs));

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(takeSurveyAction);

		const openBrowserCommand = sb.stub(privateApi.envUtils, "openInBrowser").resolves();

		const res = await showFlutterSurveyNotificationIfAppropriate(privateApi.context, privateApi.webClient, mockAnalytics, privateApi.workspaceContext, (url) => privateApi.envUtils.openInBrowser(url), surveyIsOpenDate, logger);

		// Was asked, and launched..
		assert.equal(openSurveyPrompt.calledOnce, true);
		await waitFor(() => openBrowserCommand.called);
		assert.equal(openBrowserCommand.calledOnce, true);
		assert.equal(res, true);
		assert.equal(surveyShown.calledOnce, true);

		// Flags were updated.
		assert.equal(context.globalState.getFlutterSurveyNotificationDoNotShow(flutterTestSurveyID), true);
		// Marked as shown within the last 10 seconds.
		const lastShown = context.globalState.getFlutterSurveyNotificationLastShown(flutterTestSurveyID);
		assert.equal(lastShown && lastShown > Date.now() - 10000 && lastShown <= Date.now(), true);
	});

	it("does not show if shown in the last 40 hours", async () => {
		const context = privateApi.context;
		const now = surveyIsOpenDate;
		const fiveHoursInMs = 1000 * 60 * 60 * 5;
		context.globalState.setFlutterSurveyNotificationLastShown(flutterTestSurveyID, now - fiveHoursInMs);

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(takeSurveyAction);

		const openBrowserCommand = sb.stub(privateApi.envUtils, "openInBrowser").resolves();

		const res = await showFlutterSurveyNotificationIfAppropriate(privateApi.context, privateApi.webClient, mockAnalytics, privateApi.workspaceContext, (url) => privateApi.envUtils.openInBrowser(url), now, logger);

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

		const res = await showFlutterSurveyNotificationIfAppropriate(privateApi.context, privateApi.webClient, mockAnalytics, privateApi.workspaceContext, (url) => privateApi.envUtils.openInBrowser(url), surveyIsOpenDate, logger);

		// Was asked, but not launched.
		assert.equal(openSurveyPrompt.called, true);
		assert.equal(openBrowserCommand.called, false);
		assert.equal(res, true);
		assert.equal(surveyShown.calledOnce, true);
		assert.equal(surveyDismissed.calledOnce, true);

		// Flag was written.
		await waitFor(() => privateApi.context.globalState.getFlutterSurveyNotificationDoNotShow(flutterTestSurveyID));
		assert.equal(privateApi.context.globalState.getFlutterSurveyNotificationDoNotShow(flutterTestSurveyID), true);
	});

	it("does not prompt if told not to ask again", async () => {
		privateApi.context.globalState.setFlutterSurveyNotificationDoNotShow(flutterTestSurveyID, true);

		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const openSurveyPrompt = showInformationMessage.withArgs(matchPrompt, sinon.match.any).resolves(skipThisSurveyAction);

		const openBrowserCommand = sb.stub(privateApi.envUtils, "openInBrowser").resolves();

		const res = await showFlutterSurveyNotificationIfAppropriate(privateApi.context, privateApi.webClient, mockAnalytics, privateApi.workspaceContext, (url) => privateApi.envUtils.openInBrowser(url), surveyIsOpenDate, logger);

		// Was not asked, or launched.
		assert.equal(openSurveyPrompt.called, false);
		assert.equal(openBrowserCommand.called, false);
		assert.equal(res, false);
		assert.equal(surveyShown.called, false);
	});

	it("does not show before survey opens", async () => {
		assert.equal(await showFlutterSurveyNotificationIfAppropriate(privateApi.context, privateApi.webClient, mockAnalytics, privateApi.workspaceContext, (url) => privateApi.envUtils.openInBrowser(url), immediatelyBeforeSurveyOpensDate, logger), false);
		assert.equal(surveyShown.called, false);
	});
	it("shows after survey opens", async () => {
		assert.equal(await showFlutterSurveyNotificationIfAppropriate(privateApi.context, privateApi.webClient, mockAnalytics, privateApi.workspaceContext, (url) => privateApi.envUtils.openInBrowser(url), immediatelyAfterSurveyOpensDate, logger), true);
		assert.equal(surveyShown.calledOnce, true);
	});
	it("shows before survey closes", async () => {
		assert.equal(await showFlutterSurveyNotificationIfAppropriate(privateApi.context, privateApi.webClient, mockAnalytics, privateApi.workspaceContext, (url) => privateApi.envUtils.openInBrowser(url), immediatelyBeforeSurveyClosesDate, logger), true);
		assert.equal(surveyShown.calledOnce, true);
	});
	it("does not show after survey closes", async () => {
		assert.equal(await showFlutterSurveyNotificationIfAppropriate(privateApi.context, privateApi.webClient, mockAnalytics, privateApi.workspaceContext, (url) => privateApi.envUtils.openInBrowser(url), immediatelyAfterSurveyClosesDate, logger), false);
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

describe("State storage wrappers", () => {
	function createFakeMemento(initialValues: Record<string, unknown> = {}): vs.Memento {
		const store = new Map<string, unknown>(Object.entries(initialValues));
		return {
			get<T>(key: string, defaultValue?: T): T | undefined {
				return store.has(key) ? store.get(key) as T : defaultValue;
			},
			keys(): readonly string[] {
				return Array.from(store.keys());
			},
			async update(key: string, value: unknown): Promise<void> {
				if (value === undefined)
					store.delete(key);
				else
					store.set(key, value);
			},
		};
	}

	function createTempStorageDir(): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dart-code-state-test-"));
		defer("Delete temp state dir", () => tryDelete(dir));
		return dir;
	}

	it("computes the correct .dart-tool storage path", () => {
		const winPath = getDartToolDir(
			{ APPDATA: "C:\\Users\\Test\\AppData\\Roaming", HOME: "C:\\Users\\Test" },
			true,
		);
		assert.equal(winPath, path.join("C:\\Users\\Test\\AppData\\Roaming", ".dart-tool"));

		const unixPath = getDartToolDir(
			{ APPDATA: "/should/not/be/used", HOME: "/home/testuser" },
			false,
		);
		assert.equal(unixPath, path.join("/home/testuser", ".dart-tool"));

		assert.equal(getDartToolDir({}, true), undefined);
		assert.equal(getDartToolDir({}, false), undefined);
	});

	it("shares GlobalState across multiple profiles, caches reads in memory, and preserves concurrent writes", () => {
		const storageDir = path.join(createTempStorageDir(), "nested", "dart-code");
		const profile1 = new GlobalState(createFakeMemento(), storageDir);
		const profile2 = new GlobalState(createFakeMemento(), storageDir);

		// Writing from profile 1 creates the directory/file and is visible when profile 2 reads it.
		profile1.setFlutterSurveyNotificationDoNotShow("2026Q1", true);
		assert.equal(profile2.getFlutterSurveyNotificationDoNotShow("2026Q1"), true);

		// Writing a different key from profile 2 re-reads from disk before writing,
		// so it does not clobber profile 1's key, and updates profile 2's cache.
		profile2.lastSeenVersion = "3.148.0";
		profile1.hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation = true;
		profile1.setHasPrompted(cursorInstallMcpServer, true);
		profile2.setExperimentRandomNumber("exp1", 42);
		profile2.setExperimentHasActivated("exp1", true);

		// A new instance reading from disk sees all updates from both profiles.
		const profile3 = new GlobalState(createFakeMemento(), storageDir);
		assert.equal(profile3.lastSeenVersion, "3.148.0");
		assert.equal(profile3.hasWarnedAboutPubUpgradeMajorVersionsPubpecMutation, true);
		assert.equal(profile3.getFlutterSurveyNotificationDoNotShow("2026Q1"), true);
		assert.equal(profile3.getHasPrompted(cursorInstallMcpServer), true);
		assert.equal(profile3.getExperimentRandomNumber("exp1"), 42);
		assert.equal(profile3.getExperimentHasActivated("exp1"), true);

		// Profile 1 also saw profile 2's write when profile 1 re-read before its own write.
		assert.equal(profile1.lastSeenVersion, "3.148.0");

		// Subsequent reads use the in-memory cache without re-reading disk.
		fs.unlinkSync(path.join(storageDir, "state.json"));
		assert.equal(profile3.lastSeenVersion, "3.148.0");
	});

	it("falls back to ExtensionContext.globalState when key is not in GlobalState and migrates it", () => {
		const storageDir = createTempStorageDir();
		const profile1Memento = createFakeMemento({
			flutterSurvey2026Q1NotificationDoNotShowAgain: true,
			lastSeenVersion: "3.146.0",
		});
		const profile2Memento = createFakeMemento();

		const profile1 = new GlobalState(profile1Memento, storageDir);
		const profile2 = new GlobalState(profile2Memento, storageDir);

		// Profile 1 falls back to its Memento and migrates the value to state.json.
		assert.equal(profile1.getFlutterSurveyNotificationDoNotShow("2026Q1"), true);
		assert.equal(profile1.lastSeenVersion, "3.146.0");

		// Profile 2 now sees the migrated values too.
		assert.equal(profile2.getFlutterSurveyNotificationDoNotShow("2026Q1"), true);
		assert.equal(profile2.lastSeenVersion, "3.146.0");
	});

	it("does not fall back to ExtensionContext.globalState if a key was set in GlobalState and then reset", () => {
		const storageDir = createTempStorageDir();
		const profile1Memento = createFakeMemento({
			"lastSeenVersion": "3.146.0",
			"packageLastCheckedForUpdates:devtools": 12345,
		});

		const profile1 = new GlobalState(profile1Memento, storageDir);

		// First read migrates from Memento (or we set a new value in GlobalState).
		assert.equal(profile1.lastSeenVersion, "3.146.0");
		profile1.lastSeenVersion = "3.148.0";
		assert.equal(profile1.lastSeenVersion, "3.148.0");

		// Now reset lastSeenVersion to undefined in GlobalState.
		// Even though profile1Memento still has "3.146.0", GlobalState must NOT fall back to it.
		profile1.lastSeenVersion = undefined;
		assert.equal(profile1.lastSeenVersion, undefined);

		// Also test resetting a key directly without reading/migrating it first.
		profile1.setPackageLastCheckedForUpdates("devtools", undefined);
		assert.equal(profile1.getPackageLastCheckedForUpdates("devtools"), undefined);
	});

	it("does not overwrite newer shared values when migrating a legacy key after initial cache load", () => {
		const storageDir = createTempStorageDir();
		// Profile A has a legacy true value in its per-profile Memento.
		const profileAMemento = createFakeMemento({
			"hasPrompted.cursor_install_mcp_server": true,
			"lastSeenVersion": "3.144.0",
		});
		const profileA = new GlobalState(profileAMemento, storageDir);
		const profileB = new GlobalState(createFakeMemento(), storageDir);

		// Profile A performs an unrelated read, populating its in-memory cache (which does not have cursorInstallMcpServer yet).
		assert.equal(profileA.getFlutterSurveyNotificationDoNotShow("2026Q1"), false);

		// Profile B subsequently writes false for cursorInstallMcpServer and clears lastSeenVersion in the shared file.
		profileB.setHasPrompted(cursorInstallMcpServer, false);
		profileB.lastSeenVersion = undefined;

		// When Profile A reads those keys, it must re-read from disk before migrating its legacy Memento values,
		// returning Profile B's newer shared decisions rather than overwriting them with legacy values.
		assert.equal(profileA.getHasPrompted(cursorInstallMcpServer), false);
		assert.equal(profileA.lastSeenVersion, undefined);
		assert.equal(profileB.getHasPrompted(cursorInstallMcpServer), false);
	});

	it("re-reads from disk after the cache duration expires", () => {
		const storageDir = createTempStorageDir();
		// Use a 0ms cache duration so every read refreshes from disk.
		const profile1 = new GlobalState(createFakeMemento(), storageDir, 0);
		const profile2 = new GlobalState(createFakeMemento(), storageDir, 0);

		profile1.lastSeenVersion = "3.146.0";
		assert.equal(profile2.lastSeenVersion, "3.146.0");

		profile1.lastSeenVersion = "3.148.0";
		assert.equal(profile2.lastSeenVersion, "3.148.0");
	});

	it("handles corrupted state.json gracefully and clears state properly", async () => {
		const storageDir = createTempStorageDir();
		fs.writeFileSync(path.join(storageDir, "state.json"), "{ invalid json");

		const memento = createFakeMemento({ lastSeenVersion: "3.146.0" });
		const globalState = new GlobalState(memento, storageDir);

		// Does not throw and falls back cleanly.
		assert.equal(globalState.lastSeenVersion, "3.146.0");

		// Writing overwrites the invalid JSON with valid JSON.
		globalState.lastSeenVersion = "3.148.0";
		assert.equal(globalState.lastSeenVersion, "3.148.0");

		// Clearing wipes both state.json and Memento.
		await globalState.clear();
		assert.equal(globalState.lastSeenVersion, undefined);
	});

	it("keeps ProfileState isolated per profile and WorkspaceState isolated per workspace", () => {
		const profile1 = new ProfileState(createFakeMemento());
		const profile2 = new ProfileState(createFakeMemento());

		profile1.setHasPrompted(installFlutterExtensionPromptKey, true);
		profile1.ignoreExtensionRecommendation("some.extension");
		profile1.lastUsedNewProjectPath = "/path/one";

		assert.equal(profile1.getHasPrompted(installFlutterExtensionPromptKey), true);
		assert.equal(profile2.getHasPrompted(installFlutterExtensionPromptKey), false);
		assert.deepEqual(profile1.getIgnoredExtensionRecommendationIdentifiers(), ["some.extension"]);
		assert.deepEqual(profile2.getIgnoredExtensionRecommendationIdentifiers(), []);
		assert.equal(profile1.lastUsedNewProjectPath, "/path/one");
		assert.equal(profile2.lastUsedNewProjectPath, undefined);

		const ws1 = new WorkspaceState(createFakeMemento());
		const ws2 = new WorkspaceState(createFakeMemento());
		ws1.lastFlutterDeviceId = "macos";
		assert.equal(ws1.lastFlutterDeviceId, "macos");
		assert.equal(ws2.lastFlutterDeviceId, undefined);
	});
});

