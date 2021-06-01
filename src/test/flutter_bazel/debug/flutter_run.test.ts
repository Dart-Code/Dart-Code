import * as path from "path";
import { isWin } from "../../../shared/constants";
import { DebuggerType } from "../../../shared/enums";
import { DartDebugClient } from "../../dart_debug_client";
import { createDebugClient, flutterTestDeviceIsWeb, killFlutterTester, startDebugger, waitAllThrowIfTerminates } from "../../debug_helpers";
import { activate, ensureHasRunRecently, flutterBazelHelloWorldMainFile, getPackages, prepareHasRunFile, watchPromise } from "../../helpers";

const deviceName = flutterTestDeviceIsWeb ? "Chrome" : "Flutter test device";

describe(`flutter run debugger`, () => {
	beforeEach(function () {
		if (isWin)
			this.skip();
	});

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
			dc.assertOutputContains("console", `Launching lib${path.sep}main.dart on ${deviceName} in debug mode...\n`),
			dc.configurationSequence(),
			dc.launch(config),
		);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);

		ensureHasRunRecently(hasRunFile);
	});
});
