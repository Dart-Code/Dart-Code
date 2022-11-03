import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import { isWin, MAX_VERSION } from "../../shared/constants";
import { Sdks } from "../../shared/interfaces";
import { fsPath } from "../../shared/utils/fs";
import { activateWithoutAnalysis, ext, extApi, flutterBazelRoot, logger } from "../helpers";

describe("test environment", () => {
	it("has opened the correct folders", () => {
		const wfs = vs.workspace.workspaceFolders || [];
		assert.equal(wfs.length, 2);
		assert.ok(
			fsPath(wfs[0].uri).endsWith(path.sep + "flutter_hello_world_bazel"),
			`${fsPath(wfs[0].uri)} doesn't end with ${path.sep}flutter_hello_world_bazel`,
		);
		assert.ok(
			fsPath(wfs[1].uri).endsWith(path.sep + "flutter_hello_world_bazel_2"),
			`${fsPath(wfs[1].uri)} doesn't end with ${path.sep}flutter_hello_world_bazel_2`,
		);
	});
});

describe("extension", () => {
	beforeEach(function () {
		if (isWin)
			this.skip();
	});

	it("activated", async () => {
		await activateWithoutAnalysis();
		assert.equal(ext.isActive, true);
	});
	it("loaded the Flutter config file", async () => {
		await activateWithoutAnalysis();
		assert.ok(extApi);

		const workspaceContext = extApi.workspaceContext;

		assert.ok(workspaceContext.sdks);
		assert.ok(workspaceContext.sdks.dart);
		assert.ok(workspaceContext.sdks.flutter);
		assert.ok(workspaceContext.config);
		assert.equal(workspaceContext.config?.disableAutomaticPackageGet, true);
		assert.equal(workspaceContext.config?.flutterVersion, MAX_VERSION);
		assert.equal(workspaceContext.config?.forceFlutterWorkspace, true);
		assert.equal(workspaceContext.config?.forceFlutterDebug, true);
		assert.equal(workspaceContext.config?.skipFlutterInitialization, true);
		assert.equal(workspaceContext.config?.omitTargetFlag, true);
		assert.equal(workspaceContext.config?.startDevToolsServerEagerly, true);
		assert.equal(workspaceContext.config?.defaultDartSdk, "/default/dart");
		assert.deepStrictEqual(workspaceContext.config?.flutterDaemonScript, { script: path.join(fsPath(flutterBazelRoot), "scripts/custom_daemon.sh"), replacesArgs: 1 });
		assert.deepStrictEqual(workspaceContext.config?.flutterDevToolsScript, { script: path.join(fsPath(flutterBazelRoot), "scripts/custom_devtools.sh"), replacesArgs: 1 });
		assert.deepStrictEqual(workspaceContext.config?.flutterDoctorScript, { script: path.join(fsPath(flutterBazelRoot), "scripts/custom_doctor.sh"), replacesArgs: 1 });
		assert.deepStrictEqual(workspaceContext.config?.flutterRunScript, { script: path.join(fsPath(flutterBazelRoot), "scripts/custom_run.sh"), replacesArgs: 1 });
		assert.deepStrictEqual(workspaceContext.config?.flutterTestScript, { script: path.join(fsPath(flutterBazelRoot), "scripts/custom_test.sh"), replacesArgs: 1 });
		assert.deepStrictEqual(workspaceContext.config?.flutterToolsScript, { script: path.join(fsPath(flutterBazelRoot), "scripts/custom_tools.sh"), replacesArgs: 0 });
		assert.equal(workspaceContext.config?.flutterSdkHome, path.join(fsPath(flutterBazelRoot), "my-flutter-sdk"));
		logger.info("        " + JSON.stringify(workspaceContext, undefined, 8).trim().slice(1, -1).trim());
	});
	// This test requires another clone of the SDK to verify the path (symlinks
	// are resolved during SDK detection so a symlink is not sufficient) and
	// is currently run manually after cloning.
	//
	// To run these tests, first run
	//     git clone git@github.com:flutter/flutter.git my-flutter-sdk
	// inside the READONLY folder and then
	//     ./my-flutter-sdk/bin/flutter doctor
	// to force the Dart SDK download.
	it.skip("used Bazel's Flutter version", async () => {
		await activateWithoutAnalysis();
		assert.ok(extApi);

		const sdks: Sdks = extApi.workspaceContext.sdks;

		assert.ok(sdks);
		assert.ok(sdks.dart);
		assert.equal(sdks.dartSdkIsFromFlutter, true);
		assert.equal(sdks.flutterVersion, "1.2.3");
		assert.equal(sdks.flutter, path.join(fsPath(flutterBazelRoot), "my-flutter-sdk"));
	});
	it.skip("used Bazel's Flutter's Dart version", async () => {
		await activateWithoutAnalysis();
		assert.ok(extApi);

		const sdks: Sdks = extApi.workspaceContext.sdks;

		assert.ok(sdks);
		assert.ok(sdks.dart);
		assert.equal(sdks.dartSdkIsFromFlutter, true);
		assert.equal(sdks.dart, path.join(fsPath(flutterBazelRoot), "my-flutter-sdk/bin/cache/dart-sdk"));
	});
});
