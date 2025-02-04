import { isWin } from "../../../shared/constants";
import { DebuggerType } from "../../../shared/enums";
import { fsPath } from "../../../shared/utils/fs";
import { DartDebugClient } from "../../dart_debug_client";
import { createDebugClient, killFlutterTester, startDebugger, waitAllThrowIfTerminates } from "../../debug_helpers";
import { activate, ensureHasRunRecently, flutterBazelRoot, flutterBazelTestMainFile, prepareHasRunFile } from "../../helpers";

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

	it("runs a Flutter test script to completion using custom script", async () => {
		const root = fsPath(flutterBazelRoot);
		const hasRunFile = prepareHasRunFile(root, "flutter_test");

		const config = await startDebugger(dc, flutterBazelTestMainFile, { suppressPrompts: true });
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		);

		ensureHasRunRecently(root, hasRunFile);
	});
});
