import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { isWin } from "../../../shared/constants";
import { DebuggerType } from "../../../shared/enums";
import { fsPath } from "../../../shared/utils/fs";
import { DartDebugClient } from "../../dart_debug_client";
import { createDebugClient, flutterTestDeviceIsWeb, killFlutterTester, startDebugger, waitAllThrowIfTerminates } from "../../debug_helpers";
import { activate, defer, ensureHasRunRecently, extApi, flutterBazelHelloWorldFolder, flutterBazelHelloWorldMainFile, getPackages, prepareHasRunFile, sb, setConfigForTest, watchPromise } from "../../helpers";

const deviceName = flutterTestDeviceIsWeb ? "Chrome" : "Flutter test device";

describe(`flutter run debugger`, () => {
	beforeEach(function () {
		if (isWin)
			this.skip();
	});

	// We don't commit all the iOS/Android stuff to this repo to save space, but we can bring it back with
	// `flutter create .`!
	before("run 'flutter create'", () => vs.commands.executeCommand("_flutter.create", fsPath(flutterBazelHelloWorldFolder)));
	before("run 'flutter clean'", () => vs.commands.executeCommand("_flutter.clean", fsPath(flutterBazelHelloWorldFolder)));
	// We have tests that require external packages.
	before("get packages", () => getPackages());
	beforeEach("activate flutterHelloWorldMainFile", () => activate(flutterBazelHelloWorldMainFile));

	let dc: DartDebugClient;
	beforeEach("create debug client", () => {
		dc = createDebugClient(DebuggerType.Flutter);
	});

	afterEach(() => watchPromise("Killing flutter_tester processes", killFlutterTester()));

	it("runs using custom script", async () => {
		const hasRunFile = prepareHasRunFile("flutter_run");

		const config = await startDebugger(dc, flutterBazelHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.assertOutputContains("stdout", `Launching lib${path.sep}main.dart on ${deviceName} in debug mode...\n`),
			dc.configurationSequence(),
			dc.launch(config),
		);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);

		ensureHasRunRecently(hasRunFile);
	});

	it("does automatically activate devtools", () => {
		// Because the custom DevTools activate script runs at extension activation, we
		// can't easily wrap a test around it, and instead just ensure that it's run
		// in the last 10 minutes.
		// TODO: Make this better.
		ensureHasRunRecently("devtools_activate", 60 * 10);
	});

	it("can launch DevTools externally using custom script", async () => {
		const hasRunFile = prepareHasRunFile("devtools_run");

		await setConfigForTest("dart", "embedDevTools", false);

		const openBrowserCommand = sb.stub(extApi.envUtils, "openInBrowser").resolves();

		const config = await startDebugger(dc, flutterBazelHelloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.assertOutputContains("stdout", `Launching lib${path.sep}main.dart on ${deviceName} in debug mode...\n`),
			dc.configurationSequence(),
			dc.launch(config),
		);

		const devTools = await vs.commands.executeCommand("dart.openDevTools") as { url: string, dispose: () => void };
		assert.ok(openBrowserCommand.calledOnce);
		assert.ok(devTools);
		defer(devTools.dispose);
		assert.ok(devTools.url);

		const serverResponse = await extApi.webClient.fetch(devTools.url);
		assert.notEqual(serverResponse.indexOf("Dart DevTools"), -1);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);

		ensureHasRunRecently(hasRunFile);
	});
});
