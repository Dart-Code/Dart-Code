import * as vs from "vscode";
import { isWin } from "../../../shared/constants";
import { DartLaunchArgs } from "../../../shared/debug/interfaces";
import { DebuggerType } from "../../../shared/enums";
import { fsPath } from "../../../shared/utils/fs";
import { DartDebugClient } from "../../dart_debug_client";
import { createDebugClient, killFlutterTester, waitAllThrowIfTerminates } from "../../debug_helpers";
import { activate, ensureHasRunRecently, flutterBazelRoot, flutterBazelTestMainFile, getLaunchConfiguration, prepareHasRunFile } from "../../helpers";

describe("flutter test debugger", () => {
	beforeEach(function () {
		if (isWin)
			this.skip();
	});

	beforeEach("activate flutterTestMainFile", () => activate(flutterBazelTestMainFile));

	let dc: DartDebugClient;
	beforeEach("create debug client", () => {
		dc = createDebugClient(DebuggerType.FlutterTest);
	});

	afterEach(killFlutterTester);

	async function startDebugger(script?: vs.Uri | string): Promise<vs.DebugConfiguration & DartLaunchArgs> {
		const config = await getLaunchConfiguration(script);
		if (!config)
			throw new Error(`Could not get launch configuration (got ${config})`);
		await dc.start();
		return config;
	}

	it("runs a Flutter test script to completion using custom script", async () => {
		const root = fsPath(flutterBazelRoot);
		const hasRunFile = prepareHasRunFile(root, "flutter_test");

		const config = await startDebugger(flutterBazelTestMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		);

		ensureHasRunRecently(root, hasRunFile);
	});
});
