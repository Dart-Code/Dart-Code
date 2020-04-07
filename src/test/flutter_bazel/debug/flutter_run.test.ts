import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { isWin } from "../../../shared/constants";
import { fetch } from "../../../shared/fetch";
import { fsPath } from "../../../shared/utils/fs";
import { DartDebugClient } from "../../dart_debug_client";
import { flutterTestDeviceIsWeb, killFlutterTester, startDebugger } from "../../debug_helpers";
import { activate, defer, ext, extApi, flutterBazelHelloWorldFolder, flutterBazelHelloWorldMainFile, getPackages, prepareHasRunFile, sb, watchPromise } from "../../helpers";

const deviceName = flutterTestDeviceIsWeb ? "Chrome" : "Flutter test device";

describe(`flutter run debugger`, () => {
	beforeEach(function () {
		if (isWin)
			this.skip();
	});

	// We have tests that require external packages.
	before("get packages", () => getPackages());
	beforeEach("activate flutterHelloWorldMainFile", () => activate(flutterBazelHelloWorldMainFile));

	// We don't commit all the iOS/Android stuff to this repo to save space, but we can bring it back with
	// `flutter create .`!
	before("run 'flutter create'", () => vs.commands.executeCommand("_flutter.create", fsPath(flutterBazelHelloWorldFolder)));
	before("run 'flutter clean'", () => vs.commands.executeCommand("_flutter.clean", fsPath(flutterBazelHelloWorldFolder)));

	let dc: DartDebugClient;
	beforeEach("create debug client", () => {
		dc = new DartDebugClient(process.execPath, path.join(ext.extensionPath, "out/extension/debug/flutter_debug_entry.js"), "dart", undefined, extApi.debugCommands, undefined);
		dc.defaultTimeout = 60000;
		const thisDc = dc;
		defer(() => thisDc.stop());
	});

	afterEach(() => watchPromise("Killing flutter_tester processes", killFlutterTester()));

	it("runs using custom script", async () => {
		const hasRunFile = prepareHasRunFile("flutter_run");

		const config = await startDebugger(dc, flutterBazelHelloWorldMainFile);
		await Promise.all([
			dc.assertOutputContains("stdout", `Launching lib${path.sep}main.dart on ${deviceName} in debug mode...\n`),
			dc.configurationSequence(),
			dc.launch(config),
		]);

		await Promise.all([
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		]);

		assert.ok(fs.existsSync(hasRunFile));
	});

	it("can launch DevTools using custom script", async function () {
		const hasRunFile = prepareHasRunFile("devtools_run");

		if (!extApi.flutterCapabilities.supportsDevTools)
			return this.skip();

		const openBrowserCommand = sb.stub(extApi.envUtils, "openInBrowser").resolves();

		const config = await startDebugger(dc, flutterBazelHelloWorldMainFile);
		await Promise.all([
			dc.assertOutputContains("stdout", `Launching lib${path.sep}main.dart on ${deviceName} in debug mode...\n`),
			dc.configurationSequence(),
			dc.launch(config),
		]);

		const devTools = await vs.commands.executeCommand("dart.openDevTools") as { url: string, dispose: () => void };
		assert.ok(openBrowserCommand.calledOnce);
		assert.ok(devTools);
		defer(devTools.dispose);
		assert.ok(devTools.url);

		const serverResponse = await fetch(devTools.url);
		assert.notEqual(serverResponse.indexOf("Dart DevTools"), -1);

		await Promise.all([
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		]);

		assert.ok(fs.existsSync(hasRunFile));
	});
});
