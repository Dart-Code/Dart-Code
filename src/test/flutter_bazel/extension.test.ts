import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { Sdks } from "../../shared/interfaces";
import { fsPath } from "../../shared/utils/fs";
import { activateWithoutAnalysis, ext, extApi, logger } from "../helpers";

describe("test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders || [];
		assert.equal(wfs.length, 1);
		assert.ok(
			fsPath(wfs[0].uri).endsWith(path.sep + "flutter_hello_world_bazel"),
			`${fsPath(wfs[0].uri)} doesn't end with ${path.sep}flutter_hello_world_bazel`,
		);
	});
});

describe("extension", () => {
	it("activated", async () => {
		await activateWithoutAnalysis();
		assert.equal(ext.isActive, true);
	});
	it("loaded the Flutter config file", async () => {
		await activateWithoutAnalysis();
		assert.ok(extApi);

		const workspaceRoot = fsPath(vs.workspace.workspaceFolders![0].uri);
		const readonlyPath = path.normalize(path.join(workspaceRoot, "../READONLY/flutter_hello_world_bazel"));
		const workspaceContext = extApi.workspaceContext;

		assert.ok(workspaceContext.sdks);
		assert.ok(workspaceContext.sdks.dart);
		assert.ok(workspaceContext.sdks.flutter);
		assert.ok(workspaceContext.workspaceConfig);
		assert.equal(workspaceContext.workspaceConfig?.configFile, path.join(readonlyPath, "dart/config/intellij-plugins/flutter.json"));
		assert.equal(workspaceContext.workspaceConfig?.devtoolsScript, path.join(readonlyPath, "scripts/custom_devtools.sh"));
		assert.equal(workspaceContext.workspaceConfig?.flutterDaemonScript, path.join(readonlyPath, "scripts/custom_daemon.sh"));
		assert.equal(workspaceContext.workspaceConfig?.flutterDoctorScript, path.join(readonlyPath, "scripts/custom_doctor.sh"));
		assert.equal(workspaceContext.workspaceConfig?.flutterLaunchScript, path.join(readonlyPath, "scripts/custom_run.sh"));
		assert.equal(workspaceContext.workspaceConfig?.flutterSdkHome, path.normalize(path.join(readonlyPath, "../my-flutter-sdk")));
		assert.equal(workspaceContext.workspaceConfig?.flutterTestScript, path.join(readonlyPath, "scripts/custom_test.sh"));
		assert.equal(workspaceContext.workspaceConfig?.flutterVersionFile, path.normalize(path.join(readonlyPath, "../my-flutter-version")));
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
		const workspaceRoot = fsPath(vs.workspace.workspaceFolders![0].uri);

		assert.ok(sdks);
		assert.ok(sdks.dart);
		assert.equal(sdks.dartSdkIsFromFlutter, true);
		assert.equal(sdks.flutterVersion, "9.8.7");
		assert.equal(sdks.flutter, path.join(workspaceRoot, "../READONLY/my-flutter-sdk"));
	});
	it.skip("used Bazel's Flutter's Dart version", async () => {
		await activateWithoutAnalysis();
		assert.ok(extApi);

		const sdks: Sdks = extApi.workspaceContext.sdks;
		const workspaceRoot = fsPath(vs.workspace.workspaceFolders![0].uri);

		assert.ok(sdks);
		assert.ok(sdks.dart);
		assert.equal(sdks.dartSdkIsFromFlutter, true);
		assert.equal(sdks.dart, path.join(workspaceRoot, "../READONLY/my-flutter-sdk/bin/cache/dart-sdk"));
	});
});
