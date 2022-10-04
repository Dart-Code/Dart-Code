import { strict as assert } from "assert";
import * as path from "path";
import { isWin } from "../../../shared/constants";
import { DebuggerType } from "../../../shared/enums";
import { fsPath } from "../../../shared/utils/fs";
import { DartDebugClient } from "../../dart_debug_client";
import { createDebugClient, flutterTestDeviceId, flutterTestDeviceIsWeb, killFlutterTester, startDebugger, waitAllThrowIfTerminates } from "../../debug_helpers";
import { activate, ensureHasRunRecently, extApi, flutterBazelHelloWorldFolder, flutterBazelHelloWorldMainFile, flutterBazelRoot, getResolvedDebugConfiguration, prepareHasRunFile, watchPromise } from "../../helpers";

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

	describe("resolves the correct debug config", () => {
		it("for a simple script", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				deviceId: flutterTestDeviceId,
				program: "//foo/bar",
				suppressPrompts: true, // Don't prompt if there are errors because we can't resolve package:flutter.
			})!;

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.program, "//foo/bar");
			// TODO(dantup): This is no longer our expectation, but it is what we get.
			// When fixed, remove this condition and expect flutterBazelRoot, which is the
			// common ancestor from our open workspace folders.
			if (true) {
				assert.equal(resolvedConfig.cwd, fsPath(flutterBazelHelloWorldFolder));
			} else {
				// Expect the bazel root, not the project folder, because this is the common ancestor of
				// the two workspace folders we have open.
				assert.equal(resolvedConfig.cwd, fsPath(flutterBazelRoot));
			}
		});
	});

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
