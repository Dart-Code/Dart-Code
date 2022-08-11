import * as path from "path";
import { isWin } from "../../../shared/constants";
import { DebuggerType } from "../../../shared/enums";
import { fsPath } from "../../../shared/utils/fs";
import { DartDebugClient } from "../../dart_debug_client";
import { createDebugClient, flutterTestDeviceIsWeb, killFlutterTester, startDebugger, waitAllThrowIfTerminates } from "../../debug_helpers";
import { activate, ensureHasRunRecently, extApi, flutterBazelHelloWorldMainFile, flutterBazelRoot, prepareHasRunFile, watchPromise } from "../../helpers";

const deviceName = flutterTestDeviceIsWeb ? "Chrome" : "Flutter test device";

describe(`flutter run debugger`, () => {
	beforeEach(function () {
		if (isWin)
			this.skip();
	});

	// We have tests that require external packages.
	// TODO(helin24): This requires a full flutter SDK but we need to handle this differently for bazel workspaces without an SDK.
	// before("get packages", () => getPackages());
	beforeEach("activate flutterHelloWorldMainFile", () => activate(flutterBazelHelloWorldMainFile));

	let dc: DartDebugClient;
	beforeEach("create debug client", function () {
		// When in Bazel, the Flutter version is set to MAX_VERSION which enables everything, so use
		// the Dart SDK version instead as an approx indicator of whether the SDK supports the dap.
		if (process.env.DART_CODE_FORCE_SDK_DAP === "true" && !extApi.dartCapabilities.supportsSdkDap)
			this.skip();

		dc = createDebugClient(DebuggerType.Flutter);
	});

	afterEach(() => watchPromise("Killing flutter_tester processes", killFlutterTester()));

	it("runs using custom script", async () => {
		const root = fsPath(flutterBazelRoot);
		const hasRunFile = prepareHasRunFile(root, "flutter_run");

		const config = await startDebugger(dc, flutterBazelHelloWorldMainFile, { suppressPrompts: true });
		await waitAllThrowIfTerminates(dc,
			dc.debuggerReady(),
			dc.assertOutputContains("console", `Launching lib${path.sep}main.dart on ${deviceName} in debug mode...\n`),
			dc.configurationSequence(),
			dc.launch(config),
		);

		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.terminateRequest(),
		);

		ensureHasRunRecently(root, hasRunFile);
	});
});
