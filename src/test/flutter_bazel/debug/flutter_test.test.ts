import * as vs from "vscode";
import { isWin } from "../../../shared/constants";
import { DebuggerType } from "../../../shared/enums";
import { fsPath } from "../../../shared/utils/fs";
import { DartDebugClient } from "../../dart_debug_client";
import { createDebugClient, killFlutterTester, waitAllThrowIfTerminates } from "../../debug_helpers";
import { activate, ensureHasRunRecently, flutterBazelHelloWorldFolder, flutterBazelTestMainFile, getLaunchConfiguration, getPackages, prepareHasRunFile } from "../../helpers";

describe("flutter test debugger", () => {
	beforeEach(function () {
		if (isWin)
			this.skip();
	});

	// We have tests that require external packages.
	before("get packages", () => getPackages());
	beforeEach("activate flutterTestMainFile", async () => {
		await activate(flutterBazelTestMainFile);
	});

	// We don't commit all the iOS/Android stuff to this repo to save space, but we can bring it back with
	// `flutter create .`!
	before("run 'flutter create'", () => vs.commands.executeCommand("_flutter.create", fsPath(flutterBazelHelloWorldFolder)));
	before("run 'flutter clean'", () => vs.commands.executeCommand("_flutter.clean", fsPath(flutterBazelHelloWorldFolder)));

	let dc: DartDebugClient;
	beforeEach("create debug client", () => {
		dc = createDebugClient(DebuggerType.FlutterTest);
	});

	afterEach(killFlutterTester);

	async function startDebugger(script?: vs.Uri | string): Promise<vs.DebugConfiguration> {
		const config = await getLaunchConfiguration(script);
		if (!config)
			throw new Error(`Could not get launch configuration (got ${config})`);
		await dc.start(config.debugServer);
		return config;
	}

	it("runs a Flutter test script to completion using custom script", async () => {
		const hasRunFile = prepareHasRunFile("flutter_test");

		const config = await startDebugger(flutterBazelTestMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		);

		ensureHasRunRecently(hasRunFile);
	});
});
