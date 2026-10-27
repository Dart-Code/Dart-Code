import { strict as assert } from "assert";
import { ChildProcess, SpawnOptions } from "child_process";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { addSdkToPathPrompt, analyzerSnapshotPath, cloningFlutterMessage, DART_DOWNLOAD_URL, dartAotRuntimePath, dartVMPath, executableNames, ExtensionRestartReason, FLUTTER_CREATE_PROJECT_TRIGGER_FILE, FLUTTER_DOWNLOAD_URL, flutterPath, isWin, MISSING_VERSION_FILE_VERSION, noThanksAction, openSettingsAction, showLogAction } from "../../../shared/constants";
import { GetSDKCommandConfig } from "../../../shared/interfaces";
import { fsPath, pubspecContentReferencesFlutter } from "../../../shared/utils/fs";
import { WorkspaceContext } from "../../../shared/workspace";
import { activate, defer, delay, getRandomTempFolder, helloWorldFolder, privateApi, sb, tryDelete } from "../../helpers";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const childProcess = require("child_process") as typeof import("child_process");

describe("pubspecContentReferencesFlutter", () => {
	it("returns false for non-Flutter pubspec.yaml", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: foo
version: 1.2.3

dependencies:
  not_a_flutter_dep:
		`);
		assert.equal(isFlutter, false);
	});

	it("returns true for standard Flutter pubspec.yaml", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dependencies:
  flutter:
    sdk: flutter
		`);
		assert.equal(isFlutter, true);
	});

	it("returns true for Flutter pubspec.yaml with extra whitespace", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dependencies:
  flutter:
    sdk:     flutter      #
		`);
		assert.equal(isFlutter, true);
	});

	it("returns true for Flutter pubspec.yaml with no whitespace", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dependencies:
  flutter:
    sdk:flutter
		`);
		assert.equal(isFlutter, true);
	});

	it("returns true for Flutter pubspec.yaml with double quotes", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dependencies:
  flutter:
    sdk: "flutter"
		`);
		assert.equal(isFlutter, true);
	});

	it("returns true for Flutter pubspec.yaml with single quotes", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dependencies:
  flutter:
    sdk: 'flutter'
		`);
		assert.equal(isFlutter, true);
	});

	it("returns false if the dependency is commented out", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

dev_dependencies:
  # flutter:
  #   sdk: flutter
  lints: ^2.0.0
		`);
		assert.equal(isFlutter, false);
	});

	it("returns true for only sky_engine dev_dependency in pubspec.yaml", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dependencies:
  sky_engine:
    sdk: flutter
		`);
		assert.equal(isFlutter, true);
	});

	it("returns true for only flutter_test dev_dependency in pubspec.yaml", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dev_dependencies:
  flutter_test:
    sdk: flutter
		`);
		assert.equal(isFlutter, true);
	});
});


describe("runCustomGetSDKCommand", () => {
	// The script takes two inputs for testing both args and env vars:
	//
	// 1. The first argument is the exit code to return
	// 2. The "DB_TEST_DART_PATH" env variable is the SDK path to print as output
	const shellExt = isWin ? ".bat" : ".sh";
	const executable = path.join(fsPath(helloWorldFolder), "scripts", `custom_dart_path${shellExt}`);
	before(() => fs.chmodSync(executable, "775"));

	beforeEach("activate", async () => {
		await activate();
	});

	async function runCommand(exitCode: number, outputPath: string | undefined) {
		const command: GetSDKCommandConfig = {
			args: [`${exitCode}`],
			cwd: undefined,
			env: outputPath ? {
				DC_TEST_DART_PATH: outputPath,
			} : undefined,
			executable,
		};
		return privateApi.sdkUtils?.runCustomGetSDKCommand(command, "dart.getDartSdkCommand", false);
	}

	it("handles valid path", async () => {
		const result = await runCommand(0, privateApi.workspaceContext.sdks.dart);
		assert.equal(result?.error, undefined);
		assert.equal(result?.path, privateApi.workspaceContext.sdks.dart);
	});

	it("handles missing SDK path", async () => {
		const result = await runCommand(0, path.join(privateApi.workspaceContext.sdks.dart, "fake"));
		assert.ok(result?.error?.includes("Path does not exist:"));
		assert.equal(result?.path, undefined);
	});

	it("handles no output", async () => {
		const result = await runCommand(0, undefined);
		assert.ok(result?.error?.includes("No output from command"));
		assert.equal(result?.path, undefined);
	});

	it("handles non-zero exit code", async () => {
		// Use a valid SDK path to ensure it's ignored.
		const result = await runCommand(123, privateApi.workspaceContext.sdks.dart);
		assert.ok(result?.error?.includes("Exited with non-zero code (123)"));
		assert.equal(result?.path, undefined);
	});

	it("opens workspace or global settings when Open Settings is clicked on error", async () => {
		sb.stub(vs.window, "showWarningMessage").resolves(openSettingsAction as any);
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openGlobalSettings = executeCommand.withArgs("workbench.action.openSettingsJson", sinon.match.any).resolves();
		const openWorkspaceSettings = executeCommand.withArgs("workbench.action.openWorkspaceSettingsFile", sinon.match.any).resolves();

		const command: GetSDKCommandConfig = {
			args: ["1"],
			executable,
		};
		await privateApi.sdkUtils?.runCustomGetSDKCommand(command, "dart.getDartSdkCommand", false);
		assert.ok(openGlobalSettings.calledOnceWithExactly("workbench.action.openSettingsJson", {
			revealSetting: { key: "dart.getDartSdkCommand" },
		}));

		await privateApi.sdkUtils?.runCustomGetSDKCommand(command, "dart.getFlutterSdkCommand", true);
		assert.ok(openWorkspaceSettings.calledOnceWithExactly("workbench.action.openWorkspaceSettingsFile", {
			revealSetting: { key: "dart.getFlutterSdkCommand" },
		}));
	});

	it("uses workspaceFile directory when in a multi-root workspace", async () => {
		const fakeWorkspaceDir = getRandomTempFolder();
		defer("delete fakeWorkspaceDir", () => tryDelete(fakeWorkspaceDir));
		const fakeWorkspaceFile = vs.Uri.file(path.join(fakeWorkspaceDir, "my.code-workspace"));
		sb.stub(vs.workspace, "workspaceFile").get(() => fakeWorkspaceFile);

		const result = await runCommand(0, privateApi.workspaceContext.sdks.dart);
		assert.equal(result?.path, privateApi.workspaceContext.sdks.dart);
	});

	it("returns undefined path when no workspace is open", async () => {
		sb.stub(vs.workspace, "workspaceFile").get(() => undefined);
		sb.stub(vs.workspace, "workspaceFolders").get(() => undefined);

		const result = await runCommand(0, privateApi.workspaceContext.sdks.dart);
		assert.equal(result?.path, undefined);
		assert.equal(result?.error, undefined);
	});
});

describe("SdkUtils", () => {
	beforeEach("activate", async () => {
		await activate();
	});

	function createTempDir() {
		const dir = getRandomTempFolder();
		defer("delete temp dir", () => tryDelete(dir));
		return dir;
	}

	function touchFile(filePath: string, content = "") {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content);
	}

	function createFakeDartSdk(sdkDir: string, { useAotRuntime = false, version = "3.5.0" } = {}) {
		touchFile(path.join(sdkDir, dartVMPath));
		touchFile(path.join(sdkDir, useAotRuntime ? dartAotRuntimePath : analyzerSnapshotPath));
		touchFile(path.join(sdkDir, "version"), version);
	}

	function createFakeFlutterSdk(sdkDir: string, { marker = "analysis_options.yaml", withDartSdk = false, version = "3.24.0" }: { marker?: "analysis_options.yaml" | "bin/flutter.bat" | "bin/internal/engine.version" | "none", withDartSdk?: boolean, version?: string | null } = {}) {
		touchFile(path.join(sdkDir, flutterPath));
		if (marker !== "none")
			touchFile(path.join(sdkDir, marker));
		if (version !== null)
			touchFile(path.join(sdkDir, "version"), version);
		if (withDartSdk)
			createFakeDartSdk(path.join(sdkDir, "bin", "cache", "dart-sdk"));
	}

	describe("searchPaths, findDartSdk, and findFlutterSdk", () => {
		it("searches without postFilter when omitted", () => {
			const tempDir = createTempDir();
			touchFile(path.join(tempDir, "bin", executableNames.dart));

			const res = privateApi.sdkUtils!.searchPaths([tempDir], executableNames.dart);
			assert.equal(res.sdkPath, tempDir);
		});

		it("resolves symlinks when executable is a symlink to another SDK path", () => {
			const tempDir = createTempDir();
			const realSdkDir = path.join(tempDir, "real-dart-sdk");
			const linkBinDir = path.join(tempDir, "linked-bin");
			createFakeDartSdk(realSdkDir, { useAotRuntime: true });
			fs.mkdirSync(linkBinDir, { recursive: true });

			const symlinkPath = path.join(linkBinDir, executableNames.dart);
			const targetPath = path.join(realSdkDir, dartVMPath);
			try {
				fs.symlinkSync(targetPath, symlinkPath);
			} catch {
				// On Windows without symlink privileges, stub realpathSync instead.
				touchFile(symlinkPath);
				sb.stub(fs, "realpathSync").callsFake((p: fs.PathLike) => p.toString() === symlinkPath ? targetPath : fs.realpathSync.native(p));
			}

			const res = privateApi.sdkUtils!.findDartSdk([linkBinDir]);
			assert.equal(res.sdkPath, realSdkDir);
			assert.equal(res.originalPath, linkBinDir);
			assert.equal(res.sdkInitScript, undefined);
		});

		it("detects package manager init script (snap/hermit) and returns init script path without walking up", () => {
			const tempDir = createTempDir();
			const binDir = path.join(tempDir, "snap", "bin");
			const snapBinary = path.join(tempDir, "usr", "bin", "snap");
			touchFile(snapBinary);
			fs.mkdirSync(binDir, { recursive: true });

			const flutterLink = path.join(binDir, executableNames.flutter);
			try {
				fs.symlinkSync(snapBinary, flutterLink);
			} catch {
				touchFile(flutterLink);
				sb.stub(fs, "realpathSync").callsFake((p: fs.PathLike) => p.toString() === flutterLink ? snapBinary : fs.realpathSync.native(p));
			}

			const res = privateApi.sdkUtils!.findFlutterSdk([binDir]);
			assert.equal(res.sdkInitScript, flutterLink);
			assert.deepStrictEqual(res.candidatePaths, [flutterLink]);
			assert.equal(res.sdkPath, undefined);
		});

		it("does not falsely detect /usr/bin/flutter as a Flutter SDK at /usr unless marker files exist", () => {
			const tempDir = createTempDir();
			const usrDir = path.join(tempDir, "usr");
			createFakeFlutterSdk(usrDir, { marker: "none" });

			// Only bin/flutter exists -> should not match postFilter.
			const resInvalid = privateApi.sdkUtils!.findFlutterSdk([path.join(usrDir, "bin")]);
			assert.equal(resInvalid.sdkPath, undefined);
			assert.deepStrictEqual(resInvalid.candidatePaths, [usrDir]);

			// With analysis_options.yaml -> valid.
			const sdkWithAnalysis = path.join(tempDir, "flutter-analysis");
			createFakeFlutterSdk(sdkWithAnalysis, { marker: "analysis_options.yaml" });
			assert.equal(privateApi.sdkUtils!.findFlutterSdk([sdkWithAnalysis]).sdkPath, sdkWithAnalysis);

			// With bin/flutter.bat -> valid.
			const sdkWithBat = path.join(tempDir, "flutter-bat");
			createFakeFlutterSdk(sdkWithBat, { marker: "bin/flutter.bat" });
			assert.equal(privateApi.sdkUtils!.findFlutterSdk([sdkWithBat]).sdkPath, sdkWithBat);

			// With bin/internal/engine.version -> valid.
			const sdkWithEngine = path.join(tempDir, "flutter-engine");
			createFakeFlutterSdk(sdkWithEngine, { marker: "bin/internal/engine.version" });
			assert.equal(privateApi.sdkUtils!.findFlutterSdk([sdkWithEngine]).sdkPath, sdkWithEngine);
		});
	});

	describe("warnIfBadConfigSdk & openSettingsFile", () => {
		it("warns when configured dart.sdkPath does not match found SDK and opens settings when clicked", async () => {
			const badSdkPath = path.join(createTempDir(), "not-an-sdk");
			const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves(openSettingsAction as any);
			const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
			executeCommand.withArgs("_dart.reloadExtension", sinon.match.any).resolves();
			const openGlobalSettings = executeCommand.withArgs("workbench.action.openSettingsJson", sinon.match.any).resolves();
			const openWorkspaceSettings = executeCommand.withArgs("workbench.action.openWorkspaceSettingsFile", sinon.match.any).resolves();

			// Stub workspace.getConfiguration("dart") so we don't trigger real configuration change events.
			let isWorkspace = false;
			const realGetConfig = vs.workspace.getConfiguration.bind(vs.workspace);
			const realDartConf = realGetConfig("dart");
			sb.stub(vs.workspace, "getConfiguration").callsFake(((section?: string, scope?: vs.ConfigurationScope | null): vs.WorkspaceConfiguration => {
				if (section !== "dart")
					return realGetConfig(section, scope);
				return {
					get: (key: string, defaultValue?: unknown) => key === "sdkPath" ? badSdkPath : realDartConf.get(key, defaultValue),
					has: (key: string) => realDartConf.has(key),
					inspect: (key: string) => key === "sdkPath"
						? { key, workspaceValue: isWorkspace ? badSdkPath : undefined, globalValue: !isWorkspace ? badSdkPath : undefined }
						: realDartConf.inspect(key),
					update: async () => undefined,
				} as unknown as vs.WorkspaceConfiguration;
			}) as typeof vs.workspace.getConfiguration);

			// Reload internal config wrapper so it picks up the stubbed WorkspaceConfiguration.
			await realDartConf.update("checkForSdkUpdates", false, vs.ConfigurationTarget.Global);
			await realDartConf.update("checkForSdkUpdates", undefined, vs.ConfigurationTarget.Global);

			// 1. Global setting
			await privateApi.sdkUtils!.scanWorkspace();
			await delay(50);

			assert.ok(showWarningMessage.calledWith(
				`The SDK configured in dart.sdkPath is not a valid SDK folder: ${badSdkPath}`,
				openSettingsAction,
			));
			assert.ok(openGlobalSettings.calledOnceWithExactly("workbench.action.openSettingsJson", {
				revealSetting: { key: "dart.sdkPath" },
			}));

			// 2. Workspace setting
			isWorkspace = true;
			await privateApi.sdkUtils!.scanWorkspace();
			await delay(50);

			assert.ok(openWorkspaceSettings.calledOnceWithExactly("workbench.action.openWorkspaceSettingsFile", {
				revealSetting: { key: "dart.sdkPath" },
			}));

			(vs.workspace.getConfiguration as sinon.SinonStub).restore();
			await realDartConf.update("checkForSdkUpdates", false, vs.ConfigurationTarget.Global);
			await realDartConf.update("checkForSdkUpdates", undefined, vs.ConfigurationTarget.Global);
			await delay(100);
		});
	});

	describe("handleMissingSdks & showSdkActivationFailure", () => {
		it("showFluttersDartSdkActivationFailure prompts to reload extension", () => {
			const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves("Reload" as any);
			const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
			const reloadStub = executeCommand.withArgs("_dart.reloadExtension", sinon.match.any).resolves();

			privateApi.sdkUtils!.showFluttersDartSdkActivationFailure();

			assert.ok(showInformationMessage.calledOnceWith(
				"Could not find Dart in your Flutter SDK. Please run 'flutter doctor' in the terminal then reload the project once all issues are resolved.",
				"Reload",
				showLogAction,
			));
			return delay(20).then(() => {
				assert.ok(reloadStub.calledOnceWith("_dart.reloadExtension", ExtensionRestartReason.FlutterSdkActivationFailure));
			});
		});

		it("showDartActivationFailure and showFlutterActivationFailure invoke showSdkActivationFailure", async () => {
			const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves(undefined);
			const openInBrowser = sb.stub(privateApi.envUtils, "openInBrowser").resolves(true);
			const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
			executeCommand.withArgs("_dart.reloadExtension", sinon.match.any).resolves();

			const updatedSettings: Array<{ key: string; value: unknown }> = [];
			const realGetConfig = vs.workspace.getConfiguration.bind(vs.workspace);
			const realDartConf = realGetConfig("dart");
			sb.stub(vs.workspace, "getConfiguration").callsFake(((section?: string, scope?: vs.ConfigurationScope | null): vs.WorkspaceConfiguration => {
				if (section !== "dart")
					return realGetConfig(section, scope);
				return {
					get: (key: string, defaultValue?: unknown) => realDartConf.get(key, defaultValue),
					has: (key: string) => realDartConf.has(key),
					inspect: (key: string) => realDartConf.inspect(key),
					update: async (key: string, value: unknown) => {
						updatedSettings.push({ key, value });
					},
				} as unknown as vs.WorkspaceConfiguration;
			}) as typeof vs.workspace.getConfiguration);
			await realDartConf.update("checkForSdkUpdates", false, vs.ConfigurationTarget.Global);
			await realDartConf.update("checkForSdkUpdates", undefined, vs.ConfigurationTarget.Global);

			// Test showDartActivationFailure with Locate SDK -> valid Dart SDK.
			const tempDir = createTempDir();
			const dartSdkDir = path.join(tempDir, "dart-sdk");
			createFakeDartSdk(dartSdkDir);
			showErrorMessage.onFirstCall().resolves("Locate SDK" as any);
			sb.stub(vs.window, "showOpenDialog").resolves([vs.Uri.file(dartSdkDir)]);

			privateApi.sdkUtils!.showDartActivationFailure();
			await delay(50);

			// Test showFlutterActivationFailure with Locate SDK -> valid Flutter SDK.
			const flutterSdkDir = path.join(tempDir, "flutter-sdk");
			createFakeFlutterSdk(flutterSdkDir);
			showErrorMessage.onSecondCall().resolves("Locate SDK" as any);
			(vs.window.showOpenDialog as sinon.SinonStub).resolves([vs.Uri.file(flutterSdkDir)]);

			privateApi.sdkUtils!.showFlutterActivationFailure();
			await delay(50);

			assert.deepStrictEqual(updatedSettings, [
				{ key: "sdkPath", value: dartSdkDir },
				{ key: "flutterSdkPath", value: flutterSdkDir },
			]);
			assert.equal(openInBrowser.called, false);

			(vs.workspace.getConfiguration as sinon.SinonStub).restore();
			await realDartConf.update("checkForSdkUpdates", false, vs.ConfigurationTarget.Global);
			await realDartConf.update("checkForSdkUpdates", undefined, vs.ConfigurationTarget.Global);
			await delay(100);
		});

		it("Locate SDK validates via search, loops on invalid folder, saves valid SDK, reloads, and re-runs command", async () => {
			const invalidFolder = vs.Uri.file("/invalid/sdk");
			const validFolder = vs.Uri.file("/valid/sdk");

			const showErrorMessage = sb.stub(vs.window, "showErrorMessage");
			showErrorMessage.onFirstCall().resolves("Locate SDK" as any);
			showErrorMessage.onSecondCall().resolves("Locate SDK" as any);

			const showOpenDialog = sb.stub(vs.window, "showOpenDialog");
			showOpenDialog.onFirstCall().resolves([invalidFolder]);
			showOpenDialog.onSecondCall().resolves([validFolder]);

			const search = sb.stub();
			search.onFirstCall().returns({ candidatePaths: [], sdkInitScript: undefined });
			search.onSecondCall().returns({ sdkPath: fsPath(validFolder), candidatePaths: [fsPath(validFolder)], sdkInitScript: undefined });

			const saveSdkPath = sb.stub().resolves();
			const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
			const reloadStub = executeCommand.withArgs("_dart.reloadExtension", sinon.match.any).resolves();
			const rerunStub = executeCommand.withArgs("dart.createProject").resolves();

			await privateApi.sdkUtils!.showSdkActivationFailure(
				"Dart",
				search,
				DART_DOWNLOAD_URL,
				saveSdkPath,
				"dart.createProject",
			);

			assert.equal(showErrorMessage.callCount, 2);
			assert.ok(showErrorMessage.firstCall.args[0].startsWith("Could not find a Dart SDK."));
			assert.equal(showErrorMessage.secondCall.args[0], "That folder does not appear to be a Dart SDK.");
			assert.ok(saveSdkPath.calledOnceWithExactly(fsPath(validFolder)));
			assert.ok(reloadStub.calledOnceWith("_dart.reloadExtension", ExtensionRestartReason.LocatedSdk));
			assert.ok(rerunStub.calledOnceWithExactly("dart.createProject"));
		});

		it("Download SDK opens DART_DOWNLOAD_URL in browser for Dart", async () => {
			sb.stub(vs.window, "showErrorMessage").resolves("Download SDK" as any);
			const openInBrowser = sb.stub(privateApi.envUtils, "openInBrowser").resolves(true);

			await privateApi.sdkUtils!.showSdkActivationFailure(
				"Dart",
				() => ({ candidatePaths: [], sdkInitScript: undefined }),
				DART_DOWNLOAD_URL,
				() => Promise.resolve(),
			);

			assert.ok(openInBrowser.calledOnceWithExactly(DART_DOWNLOAD_URL));
		});

		it("Show Log opens ring log contents", async () => {
			sb.stub(vs.window, "showErrorMessage").resolves(showLogAction as any);
			const showTextDocument = sb.stub(vs.window, "showTextDocument").resolves();

			await privateApi.sdkUtils!.showSdkActivationFailure(
				"Dart",
				() => ({ candidatePaths: [], sdkInitScript: undefined }),
				DART_DOWNLOAD_URL,
				() => Promise.resolve(),
			);

			await delay(50);
			assert.ok(showTextDocument.calledOnce);
		});

		it("handleMissingSdks registers fallback commands and shows startup message on timeout", async () => {
			const registeredCommands = new Map<string, (...args: any[]) => any>();
			sb.stub(vs.commands, "registerCommand").callsFake((cmd: string, cb: (...args: any[]) => any) => {
				registeredCommands.set(cmd, cb);
				return { dispose: () => undefined };
			});
			const timeoutCallbacks: Array<() => void> = [];
			const origSetTimeout = global.setTimeout;
			sb.stub(global, "setTimeout").callsFake(((fn: () => void, ms?: number) => {
				if (ms === 500) {
					timeoutCallbacks.push(fn);
					return 0 as unknown as NodeJS.Timeout;
				}
				return origSetTimeout(fn, ms);
			}) as typeof global.setTimeout);

			const showFluttersDartStub = sb.stub(privateApi.sdkUtils!, "showFluttersDartSdkActivationFailure");
			const showFlutterStub = sb.stub(privateApi.sdkUtils!, "showFlutterActivationFailure");
			const showDartStub = sb.stub(privateApi.sdkUtils!, "showDartActivationFailure");

			// Case 1: Flutter project with Flutter SDK but missing Dart SDK.
			const wcFlutterNoDart = new WorkspaceContext(
				{ dart: undefined, flutter: "/flutter/sdk", dartSdkIsFromFlutter: false, isPreReleaseSdk: false },
				{},
				true,
				false,
				false,
				false,
				undefined,
				undefined,
			);
			(privateApi.sdkUtils as any).hasShownActivationFailure = false;
			privateApi.sdkUtils!.handleMissingSdks(wcFlutterNoDart);

			assert.equal(registeredCommands.size, 5);
			// Trigger timeout before any command runs -> calls showFluttersDartSdkActivationFailure.
			timeoutCallbacks.pop()!();
			assert.ok(showFluttersDartStub.calledOnce);

			// Also invoke each registered command to cover their callbacks.
			registeredCommands.get("flutter.createProject")!();
			registeredCommands.get("dart.createProject")!();
			assert.ok(showDartStub.calledOnceWithExactly("dart.createProject"));
			registeredCommands.get("_dart.flutter.createSampleProject")!();
			registeredCommands.get("flutter.doctor")!();
			registeredCommands.get("flutter.upgrade")!();

			// Case 2: Standard Dart project missing Dart SDK.
			const wcDartOnly = new WorkspaceContext(
				{ dart: undefined, flutter: undefined, dartSdkIsFromFlutter: false, isPreReleaseSdk: false },
				{},
				false,
				false,
				true,
				false,
				undefined,
				undefined,
			);
			(privateApi.sdkUtils as any).hasShownActivationFailure = false;
			privateApi.sdkUtils!.handleMissingSdks(wcDartOnly);
			timeoutCallbacks.pop()!();
			assert.ok(showDartStub.calledWithExactly(undefined));

			// Case 3: Flutter project missing Flutter SDK.
			const wcFlutterMissing = new WorkspaceContext(
				{ dart: undefined, flutter: undefined, dartSdkIsFromFlutter: false, isPreReleaseSdk: false },
				{},
				true,
				false,
				false,
				false,
				undefined,
				undefined,
			);
			(privateApi.sdkUtils as any).hasShownActivationFailure = false;
			privateApi.sdkUtils!.handleMissingSdks(wcFlutterMissing);
			timeoutCallbacks.pop()!();
			assert.ok(showFlutterStub.calledOnceWithExactly(undefined));

			// Case 4: No Dart or Flutter projects open -> logs error and suppresses prompt.
			const wcEmpty = new WorkspaceContext(
				{ dart: undefined, flutter: undefined, dartSdkIsFromFlutter: false, isPreReleaseSdk: false },
				{},
				false,
				false,
				false,
				false,
				undefined,
				undefined,
			);
			(privateApi.sdkUtils as any).hasShownActivationFailure = false;
			privateApi.sdkUtils!.handleMissingSdks(wcEmpty);
			timeoutCallbacks.pop()!();
		});
	});

	describe("tryFlutterCloneIfGitAvailable, promptForFlutterClone, and cloneFlutterWithProgress", () => {
		function stubSpawnForGit(handler: (bin: string, args: string[], cwd: string | undefined) => { exitCode?: number; stdout?: string; stderr?: string; error?: Error; delayMs?: number } | undefined) {
			const realSpawn = childProcess.spawn as (command: string, args?: readonly string[], options?: SpawnOptions) => ChildProcess;
			return sb.stub(childProcess, "spawn").callsFake((bin: string, args?: string[], opts?: SpawnOptions): unknown => {
				const res = handler(bin, args ?? [], opts?.cwd?.toString());
				if (!res)
					return realSpawn(bin, args, opts);

				const proc = new EventEmitter() as any;
				proc.pid = 12345;
				proc.stdout = new EventEmitter();
				proc.stdout.setEncoding = () => undefined;
				proc.stderr = new EventEmitter();
				proc.stderr.setEncoding = () => undefined;
				proc.kill = () => {
					setImmediate(() => {
						proc.exitCode = 1;
						proc.emit("exit", 1, null);
						proc.emit("close", 1, null);
					});
					return true;
				};

				setTimeout(() => {
					if (res.error) {
						proc.emit("error", res.error);
						return;
					}
					if (res.stdout)
						proc.stdout.emit("data", Buffer.from(res.stdout));
					if (res.stderr)
						proc.stderr.emit("data", Buffer.from(res.stderr));
					const code = res.exitCode ?? 0;
					proc.exitCode = code;
					proc.emit("exit", code, null);
					proc.emit("close", code, null);
				}, res.delayMs ?? 1);

				return proc as ChildProcess;
			});
		}

		it("handles non-zero exit code and spawn error when checking git --version (CloneSdkResult.noGit)", async () => {
			// Also cover active vscode.git extension path lookup.
			sb.stub(vs.extensions, "getExtension").withArgs("vscode.git").returns({
				exports: { getAPI: () => ({ git: { path: "/custom/git" } }) },
				isActive: true,
			} as any);

			let throwError = false;
			stubSpawnForGit((_bin, args) => {
				if (args.includes("--version")) {
					if (throwError)
						return { error: new Error("ENOENT") };
					return { exitCode: 1, stderr: "git not found" };
				}
				return undefined;
			});

			const showErrorMessage = sb.stub(vs.window, "showErrorMessage");
			// 1st loop: Download SDK -> git exitCode 1 -> shows "Unable to clone Flutter because Git was not found." -> click "Setup Instructions"
			showErrorMessage.onCall(0).resolves("Download SDK" as any);
			showErrorMessage.onCall(1).resolves("Setup Instructions" as any);
			// 2nd loop: Download SDK -> git spawn error -> shows "Unable to clone..." -> dismiss
			showErrorMessage.onCall(2).resolves("Download SDK" as any);
			showErrorMessage.onCall(3).resolves(undefined);
			// 3rd loop: dismiss outer prompt
			showErrorMessage.onCall(4).resolves(undefined);

			const openInBrowser = sb.stub(privateApi.envUtils, "openInBrowser").callsFake(async () => {
				throwError = true;
				return true;
			});

			await privateApi.sdkUtils!.showSdkActivationFailure(
				"Flutter",
				() => ({ candidatePaths: [], sdkInitScript: undefined }),
				FLUTTER_DOWNLOAD_URL,
				() => Promise.resolve(),
			);

			assert.ok(openInBrowser.calledOnceWithExactly(FLUTTER_DOWNLOAD_URL));
			assert.ok(showErrorMessage.calledWith(
				"Unable to clone Flutter because Git was not found. Please clone or download the Flutter SDK manually.",
				"Setup Instructions",
			));
		});

		it("handles cancellation during git --version check and folder selection", async () => {
			let cancelGitCheck = true;
			let throwOnGitCancel = false;
			const origWithProgress = vs.window.withProgress.bind(vs.window);
			sb.stub(vs.window, "withProgress").callsFake(async <R>(options: vs.ProgressOptions, task: (progress: vs.Progress<{ message?: string; increment?: number }>, token: vs.CancellationToken) => Thenable<R>): Promise<R> => {
				if (options.title === "Checking for git" && cancelGitCheck) {
					const tokenSource = new vs.CancellationTokenSource();
					tokenSource.cancel();
					return task({ report: () => undefined }, tokenSource.token);
				}
				return origWithProgress(options, task);
			});

			stubSpawnForGit((_bin, args) => {
				if (args.includes("--version")) {
					if (throwOnGitCancel)
						return { error: new Error("cancelled error") };
					return { exitCode: 0, stdout: "git version 2.40.0" };
				}
				return undefined;
			});

			const showErrorMessage = sb.stub(vs.window, "showErrorMessage");
			sb.stub(vs.window, "showOpenDialog").callsFake(async () => undefined);

			let callIdx = 0;
			showErrorMessage.callsFake(async () => {
				callIdx++;
				if (callIdx === 1)
					return "Download SDK";
				if (callIdx === 2) {
					throwOnGitCancel = true;
					return "Download SDK";
				}
				if (callIdx === 3) {
					cancelGitCheck = false;
					throwOnGitCancel = false;
					return "Download SDK";
				}
				return undefined;
			});

			await privateApi.sdkUtils!.showSdkActivationFailure(
				"Flutter",
				() => ({ candidatePaths: [], sdkInitScript: undefined }),
				FLUTTER_DOWNLOAD_URL,
				() => Promise.resolve(),
			);

			assert.equal(callIdx, 4);
		});

		it("handles git clone failure, spawn error, and cancellation in cloneFlutterWithProgress", async () => {
			let mode: "exitCode" | "error" | "cancel" | "cancelError" = "exitCode";
			const origWithProgress = vs.window.withProgress.bind(vs.window);
			sb.stub(vs.window, "withProgress").callsFake(async <R>(options: vs.ProgressOptions, task: (progress: vs.Progress<{ message?: string; increment?: number }>, token: vs.CancellationToken) => Thenable<R>): Promise<R> => {
				if (options.title === cloningFlutterMessage && (mode === "cancel" || mode === "cancelError")) {
					const tokenSource = new vs.CancellationTokenSource();
					tokenSource.cancel();
					return task({ report: () => undefined }, tokenSource.token);
				}
				return origWithProgress(options, task);
			});

			stubSpawnForGit((_bin, args) => {
				if (args.includes("--version"))
					return { exitCode: 0, stdout: "git version 2.40.0" };
				if (args.includes("clone")) {
					if (mode === "error" || mode === "cancelError")
						return { error: new Error("clone spawn error") };
					return { exitCode: 128, stderr: "fatal: repository not found" };
				}
				return undefined;
			});

			const cloneDir = createTempDir();
			sb.stub(vs.window, "showOpenDialog").resolves([vs.Uri.file(cloneDir)]);
			const openInBrowser = sb.stub(privateApi.envUtils, "openInBrowser").resolves(true);

			const errorMessages: string[] = [];
			sb.stub(vs.window, "showErrorMessage").callsFake(async (msg: string) => {
				errorMessages.push(msg);
				if (msg.startsWith("Could not find a Flutter SDK.")) {
					const count = errorMessages.filter((m) => m.startsWith("Could not find")).length;
					if (count === 1) {
						mode = "exitCode";
						return "Download SDK";
					}
					if (count === 2) {
						mode = "error";
						return "Download SDK";
					}
					if (count === 3) {
						mode = "cancel";
						return "Download SDK";
					}
					if (count === 4) {
						mode = "cancelError";
						return "Download SDK";
					}
					return undefined;
				}
				if (msg.startsWith("Failed to clone Flutter using Git.")) {
					return "Setup Instructions";
				}
				return undefined;
			});

			await privateApi.sdkUtils!.showSdkActivationFailure(
				"Flutter",
				() => ({ candidatePaths: [], sdkInitScript: undefined }),
				FLUTTER_DOWNLOAD_URL,
				() => Promise.resolve(),
			);

			assert.ok(errorMessages.some((m) => m.includes("Failed to clone Flutter: fatal: repository not found")));
			assert.ok(errorMessages.some((m) => m.startsWith("Failed to clone Flutter using Git.")));
			assert.ok(openInBrowser.calledWithExactly(FLUTTER_DOWNLOAD_URL));
		});

		it("clones Flutter into selected folder, sets global Flutter SDK path, initializes Flutter, and reloads extension", async () => {
			const cloneDir = createTempDir();
			const expectedFlutterFolder = path.join(cloneDir, "flutter");

			const updatedSettings: Array<{ key: string; value: unknown }> = [];
			const realGetConfig = vs.workspace.getConfiguration.bind(vs.workspace);
			const realDartConf = realGetConfig("dart");
			sb.stub(vs.workspace, "getConfiguration").callsFake(((section?: string, scope?: vs.ConfigurationScope | null): vs.WorkspaceConfiguration => {
				if (section !== "dart")
					return realGetConfig(section, scope);
				return {
					get: (key: string, defaultValue?: unknown) => realDartConf.get(key, defaultValue),
					has: (key: string) => realDartConf.has(key),
					inspect: (key: string) => realDartConf.inspect(key),
					update: async (key: string, value: unknown) => {
						updatedSettings.push({ key, value });
					},
				} as unknown as vs.WorkspaceConfiguration;
			}) as typeof vs.workspace.getConfiguration);
			await realDartConf.update("checkForSdkUpdates", false, vs.ConfigurationTarget.Global);
			await realDartConf.update("checkForSdkUpdates", undefined, vs.ConfigurationTarget.Global);

			const spawnedCalls: Array<{ bin: string; args: string[]; cwd?: string }> = [];
			stubSpawnForGit((bin, args, cwd) => {
				if (args.includes("--version")) {
					spawnedCalls.push({ bin, args, cwd });
					return { exitCode: 0, stdout: "git version 2.40.0" };
				}
				if (args.includes("clone")) {
					spawnedCalls.push({ bin, args, cwd });
					return { exitCode: 0 };
				}
				if (args.includes("--help")) {
					spawnedCalls.push({ bin, args, cwd });
					return { exitCode: 0 };
				}
				return undefined;
			});

			sb.stub(vs.window, "showErrorMessage").resolves("Download SDK" as any);
			sb.stub(vs.window, "showOpenDialog").resolves([vs.Uri.file(cloneDir)]);
			// Dismiss the "Add SDK to PATH" prompt with "No Thanks".
			const showInfo = sb.stub(vs.window, "showInformationMessage").callsFake(async (msg: string) => {
				if (msg === addSdkToPathPrompt("Flutter"))
					return noThanksAction;
				return undefined;
			});

			const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
			const reloadStub = executeCommand.withArgs("_dart.reloadExtension", sinon.match.any).resolves();
			const rerunStub = executeCommand.withArgs("flutter.createProject").resolves();

			await privateApi.sdkUtils!.showSdkActivationFailure(
				"Flutter",
				() => ({ candidatePaths: [], sdkInitScript: undefined }),
				FLUTTER_DOWNLOAD_URL,
				() => Promise.resolve(),
				"flutter.createProject",
			);

			assert.ok(spawnedCalls.some((c) => c.args.includes("--version")));
			assert.ok(spawnedCalls.some((c) => c.cwd === cloneDir && c.args.join(" ") === "clone -b stable https://github.com/flutter/flutter.git"));
			assert.ok(spawnedCalls.some((c) => c.bin.endsWith(executableNames.flutter) && c.args.includes("--help")));
			assert.deepStrictEqual(updatedSettings, [{ key: "flutterSdkPath", value: expectedFlutterFolder }]);
			assert.ok(showInfo.called);
			assert.ok(reloadStub.calledOnceWithExactly("_dart.reloadExtension", ExtensionRestartReason.AfterFlutterClone));
			assert.ok(rerunStub.calledOnceWithExactly("flutter.createProject"));

			(vs.workspace.getConfiguration as sinon.SinonStub).restore();
			await realDartConf.update("checkForSdkUpdates", false, vs.ConfigurationTarget.Global);
			await realDartConf.update("checkForSdkUpdates", undefined, vs.ConfigurationTarget.Global);
			await delay(100);
		});
	});

	describe("scanWorkspace", () => {
		function stubDartConfig(overrides: Record<string, unknown>, workspaceKeys: string[] = []) {
			const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
			executeCommand.withArgs("_dart.reloadExtension", sinon.match.any).resolves();
			const realGetConfig = vs.workspace.getConfiguration.bind(vs.workspace);
			const realDartConf = realGetConfig("dart");
			sb.stub(vs.workspace, "getConfiguration").callsFake(((section?: string, scope?: vs.ConfigurationScope | null): vs.WorkspaceConfiguration => {
				if (section !== "dart")
					return realGetConfig(section, scope);
				return {
					get: (key: string, defaultValue?: unknown) => key in overrides ? overrides[key] : realDartConf.get(key, defaultValue),
					has: (key: string) => realDartConf.has(key),
					inspect: (key: string) => key in overrides
						? { key, workspaceValue: workspaceKeys.includes(key) ? overrides[key] : undefined, globalValue: !workspaceKeys.includes(key) ? overrides[key] : undefined }
						: realDartConf.inspect(key),
					update: async () => undefined,
				} as unknown as vs.WorkspaceConfiguration;
			}) as typeof vs.workspace.getConfiguration);
			return realDartConf;
		}

		it("returns early when analyzerSshHost is configured", async () => {
			const realDartConf = stubDartConfig({ analyzerSshHost: "my-ssh-host", sdkPath: "/remote/dart-sdk" });
			await realDartConf.update("checkForSdkUpdates", false, vs.ConfigurationTarget.Global);
			await realDartConf.update("checkForSdkUpdates", undefined, vs.ConfigurationTarget.Global);

			const wc = await privateApi.sdkUtils!.scanWorkspace();
			assert.equal(wc.sdks.dart, "/remote/dart-sdk");
			assert.equal(wc.sdks.flutter, undefined);

			(vs.workspace.getConfiguration as sinon.SinonStub).restore();
			await realDartConf.update("checkForSdkUpdates", false, vs.ConfigurationTarget.Global);
			await realDartConf.update("checkForSdkUpdates", undefined, vs.ConfigurationTarget.Global);
			await delay(100);
		});

		it("handles Flutter projects, snap initialization, missing version file, and Fuchsia/Dart SDK roots", async () => {
			const tempDir = createTempDir();
			fs.mkdirSync(path.join(tempDir, ".git"), { recursive: true });
			touchFile(path.join(tempDir, "README.dart-sdk"));
			touchFile(path.join(tempDir, "DEPS"));
			fs.mkdirSync(path.join(tempDir, ".jiri_root"), { recursive: true });
			touchFile(path.join(tempDir, "WORKSPACE"));
			touchFile(path.join(tempDir, "pubspec.yaml"), "name: dart_proj\n");

			const flutterProj = path.join(tempDir, "flutter_proj");
			touchFile(path.join(flutterProj, FLUTTER_CREATE_PROJECT_TRIGGER_FILE));

			const snapBinDir = path.join(tempDir, "snap", "bin");
			const snapBinary = path.join(tempDir, "usr", "bin", "snap");
			const realFlutterSdk = path.join(tempDir, "real-flutter-sdk");
			touchFile(snapBinary);
			fs.mkdirSync(snapBinDir, { recursive: true });
			const snapFlutterLink = path.join(snapBinDir, executableNames.flutter);
			try {
				fs.symlinkSync(snapBinary, snapFlutterLink);
			} catch {
				touchFile(snapFlutterLink);
			}

			const realSpawn = childProcess.spawn as (command: string, args?: readonly string[], options?: SpawnOptions) => ChildProcess;
			sb.stub(childProcess, "spawn").callsFake((bin: string, args?: string[], opts?: SpawnOptions): unknown => {
				if (args?.includes("--help")) {
					createFakeFlutterSdk(realFlutterSdk, { version: null, withDartSdk: true });
					const proc = new EventEmitter() as any;
					proc.pid = 12345;
					proc.stdout = new EventEmitter();
					proc.stderr = new EventEmitter();
					proc.kill = () => true;
					setImmediate(() => {
						proc.exitCode = 0;
						proc.emit("exit", 0, null);
						proc.emit("close", 0, null);
					});
					return proc as ChildProcess;
				}
				return realSpawn(bin, args, opts);
			});

			sb.stub(vs.workspace, "workspaceFolders").get(() => [
				{ uri: vs.Uri.file(tempDir), name: "root", index: 0 },
				{ uri: vs.Uri.file(flutterProj), name: "flutter_proj", index: 1 },
			]);
			privateApi.clearCaches();

			const origPath = process.env.PATH;
			process.env.PATH = `${snapBinDir}${path.delimiter}${path.join(realFlutterSdk, "bin")}`;
			defer("restore PATH", () => process.env.PATH = origPath);

			const badFlutterPath = path.join(tempDir, "bad-flutter-sdk");
			const realDartConf = stubDartConfig({ flutterSdkPath: badFlutterPath }, ["flutterSdkPath"]);
			await realDartConf.update("checkForSdkUpdates", false, vs.ConfigurationTarget.Global);
			await realDartConf.update("checkForSdkUpdates", undefined, vs.ConfigurationTarget.Global);
			sb.stub(vs.window, "showWarningMessage").resolves(undefined);

			const wc = await privateApi.sdkUtils!.scanWorkspace();
			assert.equal(wc.hasAnyFlutterProjects, true);
			assert.equal(wc.hasAnyStandardDartProjects, true);
			assert.equal(wc.hasProjectsInFuchsiaTree, true);
			assert.equal(wc.sdks.flutter, realFlutterSdk);
			assert.equal(wc.sdks.flutterVersion, MISSING_VERSION_FILE_VERSION);

			(vs.workspace.getConfiguration as sinon.SinonStub).restore();
			privateApi.clearCaches();
			await realDartConf.update("checkForSdkUpdates", false, vs.ConfigurationTarget.Global);
			await realDartConf.update("checkForSdkUpdates", undefined, vs.ConfigurationTarget.Global);
			await delay(100);
		});

		it("handles non-Dart workspace, forceFlutterWorkspace, and fallback Flutter initialization for Dart SDK", async () => {
			const tempDir = createTempDir();
			const flutterSdk = path.join(tempDir, "flutter-sdk");
			createFakeFlutterSdk(flutterSdk, { withDartSdk: false });

			const realSpawn = childProcess.spawn as (command: string, args?: readonly string[], options?: SpawnOptions) => ChildProcess;
			sb.stub(childProcess, "spawn").callsFake((bin: string, args?: string[], opts?: SpawnOptions): unknown => {
				if (args?.includes("--help")) {
					createFakeDartSdk(path.join(flutterSdk, "bin", "cache", "dart-sdk"));
					const proc = new EventEmitter() as any;
					proc.pid = 12345;
					proc.stdout = new EventEmitter();
					proc.stderr = new EventEmitter();
					proc.kill = () => true;
					setImmediate(() => {
						proc.exitCode = 0;
						proc.emit("exit", 0, null);
						proc.emit("close", 0, null);
					});
					return proc as ChildProcess;
				}
				return realSpawn(bin, args, opts);
			});

			sb.stub(vs.workspace, "workspaceFolders").get(() => [
				{ uri: vs.Uri.file(tempDir), name: "empty", index: 0 },
			]);
			sb.stub(vs.workspace, "findFiles").resolves([]);
			privateApi.clearCaches();

			const origPath = process.env.PATH;
			process.env.PATH = "";
			defer("restore PATH", () => process.env.PATH = origPath);

			const realDartConf = stubDartConfig({ flutterSdkPath: flutterSdk, sdkPath: undefined });
			await realDartConf.update("checkForSdkUpdates", false, vs.ConfigurationTarget.Global);
			await realDartConf.update("checkForSdkUpdates", undefined, vs.ConfigurationTarget.Global);

			const wc = await privateApi.sdkUtils!.scanWorkspace();
			assert.equal(wc.hasAnyFlutterProjects, false);
			assert.equal(wc.hasAnyStandardDartProjects, false);
			assert.equal(wc.config.disableAnalytics, true);
			assert.equal(wc.config.disableStartupPrompts, true);
			assert.equal(wc.config.disableSdkUpdateChecks, true);
			assert.equal(wc.sdks.dart, path.join(flutterSdk, "bin", "cache", "dart-sdk"));

			if (!isWin) {
				touchFile(path.join(tempDir, "WORKSPACE"));
				touchFile(path.join(tempDir, "dart/config/ide/flutter.json"), JSON.stringify({
					sdkHome: flutterSdk,
				}));
				privateApi.clearCaches();
				const wcBazel = await privateApi.sdkUtils!.scanWorkspace();
				assert.equal(wcBazel.hasAnyFlutterProjects, true);
				assert.equal(wcBazel.sdks.flutter, flutterSdk);
			}

			(vs.workspace.getConfiguration as sinon.SinonStub).restore();
			privateApi.clearCaches();
			await realDartConf.update("checkForSdkUpdates", false, vs.ConfigurationTarget.Global);
			await realDartConf.update("checkForSdkUpdates", undefined, vs.ConfigurationTarget.Global);
			await delay(100);
		});
	});
});
