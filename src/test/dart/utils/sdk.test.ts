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
import { activate, defer, deferUntilLast, getRandomTempFolder, helloWorldFolder, privateApi, sb, setConfigForTest, tryDelete } from "../../helpers";

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
		const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves(openSettingsAction as any);
		const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
		const openGlobalSettings = executeCommand.withArgs("workbench.action.openSettingsJson", sinon.match.any);
		const openWorkspaceSettings = executeCommand.withArgs("workbench.action.openWorkspaceSettingsFile", sinon.match.any);

		// Exit code 1 causes runCustomGetSDKCommand to fail and show a warning notification with an "Open Settings" button.
		const command: GetSDKCommandConfig = {
			args: ["1"],
			executable,
		};

		// When isWorkspaceSetting is false, clicking "Open Settings" should open global settings.json and reveal dart.getDartSdkCommand.
		const openedGlobal = new Promise<void>((resolve) => openGlobalSettings.callsFake(async () => resolve()));
		await privateApi.sdkUtils?.runCustomGetSDKCommand(command, "dart.getDartSdkCommand", false);
		await openedGlobal;
		assert.ok(showWarningMessage.calledOnce);
		assert.ok(openGlobalSettings.calledOnceWithExactly("workbench.action.openSettingsJson", {
			revealSetting: { key: "dart.getDartSdkCommand" },
		}));

		// When isWorkspaceSetting is true, clicking "Open Settings" should open the workspace settings file and reveal dart.getFlutterSdkCommand.
		const openedWorkspace = new Promise<void>((resolve) => openWorkspaceSettings.callsFake(async () => resolve()));
		await privateApi.sdkUtils?.runCustomGetSDKCommand(command, "dart.getFlutterSdkCommand", true);
		await openedWorkspace;
		assert.equal(showWarningMessage.callCount, 2);
		assert.ok(openWorkspaceSettings.calledOnceWithExactly("workbench.action.openWorkspaceSettingsFile", {
			revealSetting: { key: "dart.getFlutterSdkCommand" },
		}));
	});

	it("uses workspaceFile directory as working directory when in a multi-root workspace", async () => {
		// In a multi-root workspace (where vs.workspace.workspaceFile is defined), getWorkingDirectoryForGetSdkCommand()
		// should use the directory containing the .code-workspace file as the default working directory (cwd)
		// when command.cwd is not specified, rather than workspaceFolders[0].
		const fakeWorkspaceDir = getRandomTempFolder();
		defer("delete fakeWorkspaceDir", () => tryDelete(fakeWorkspaceDir));
		const fakeWorkspaceFile = vs.Uri.file(path.join(fakeWorkspaceDir, "my.code-workspace"));
		sb.stub(vs.workspace, "workspaceFile").get(() => fakeWorkspaceFile);
		const spawnSpy = sb.spy(childProcess, "spawn");

		const result = await runCommand(0, privateApi.workspaceContext.sdks.dart);
		assert.equal(result?.path, privateApi.workspaceContext.sdks.dart);
		assert.ok(spawnSpy.calledOnce);
		// Verify that child_process.spawn was called with SpawnOptions.cwd set to the .code-workspace file's directory.
		assert.equal(spawnSpy.firstCall.args[2]?.cwd, fakeWorkspaceDir);
	});

	it("returns undefined path when no workspace is open", async () => {
		// When neither workspaceFile nor workspaceFolders is defined, getWorkingDirectoryForGetSdkCommand()
		// returns undefined and runCustomGetSDKCommand() returns early with { path: undefined }.
		sb.stub(vs.workspace, "workspaceFile").get(() => undefined);
		sb.stub(vs.workspace, "workspaceFolders").get(() => undefined);

		const result = await runCommand(0, privateApi.workspaceContext.sdks.dart);
		assert.equal(result?.path, undefined);
		assert.equal(result?.error, undefined);
	});
});

describe("SdkUtils", () => {
	const origSetTimeout = global.setTimeout;
	let executeCommandStub: sinon.SinonStub;
	let reloadExtensionStub: sinon.SinonStub;

	beforeEach("activate", async () => {
		await activate();

		executeCommandStub = sb.stub(vs.commands, "executeCommand").callThrough();
		reloadExtensionStub = executeCommandStub.withArgs("_dart.reloadExtension", sinon.match.any).resolves();

		const timers: NodeJS.Timeout[] = [];
		sb.stub(global, "setTimeout").callsFake(((fn: () => void, ms?: number) => {
			const timer = origSetTimeout(fn, ms);
			timers.push(timer);
			return timer;
		}) as typeof global.setTimeout);
		deferUntilLast("clear pending timers", () => timers.forEach((t) => clearTimeout(t)));
	});

	async function setWorkspaceConfigForTest(section: string, key: string, value: any): Promise<void> {
		const conf = vs.workspace.getConfiguration(section);
		const values = conf.inspect(key);
		const oldValue = values?.workspaceValue;
		await conf.update(key, value, vs.ConfigurationTarget.Workspace);
		defer("Restore workspace test config", () => conf.update(key, oldValue, vs.ConfigurationTarget.Workspace));
	}

	function waitForStubCall<T = void>(stub: sinon.SinonStub): Promise<T> {
		return new Promise<T>((resolve) => {
			stub.callsFake(async (arg: T) => {
				resolve(arg);
				return undefined;
			});
		});
	}

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
			// When no postFilter callback is passed to searchPaths, any directory containing bin/<executable> is returned.
			const tempDir = createTempDir();
			touchFile(path.join(tempDir, "bin", executableNames.dart));

			const res = privateApi.sdkUtils!.searchPaths([tempDir], executableNames.dart);
			assert.equal(res.sdkPath, tempDir);
		});

		it("resolves symlinks when executable is a symlink to another SDK path", () => {
			// When a PATH entry contains a symlink to the dart binary inside an actual SDK directory (e.g. Homebrew),
			// searchPaths should resolve the symlink target and walk up two levels (bin/dart -> SDK root) while keeping
			// originalPath as the searched directory. Also uses dartaotruntime to cover the AOT runtime check in findDartSdk.
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
			// When the flutter executable symlink resolves to a binary with a different basename (such as /usr/bin/snap),
			// searchPaths records the symlink path as sdkInitScript and does not walk up two directories.
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
			// findFlutterSdk checks for additional SDK marker files so that a standalone /usr/bin/flutter binary
			// does not cause /usr to be treated as a Flutter SDK root.
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
		it("warns when configured global dart.sdkPath does not match found SDK and opens global settings", async () => {
			// Configure an invalid global dart.sdkPath so scanWorkspace falls back to PATH and warns that
			// dart.sdkPath is invalid. Clicking "Open Settings" should open global settings.json.
			const badSdkPath = path.join(createTempDir(), "not-an-sdk");
			await setConfigForTest("dart", "sdkPath", badSdkPath);

			const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves(openSettingsAction as any);
			const openGlobalSettings = executeCommandStub.withArgs("workbench.action.openSettingsJson", sinon.match.any);
			const openedSettings = waitForStubCall(openGlobalSettings);

			await privateApi.sdkUtils!.scanWorkspace();
			await openedSettings;

			assert.ok(showWarningMessage.calledOnceWithExactly(
				`The SDK configured in dart.sdkPath is not a valid SDK folder: ${badSdkPath}`,
				openSettingsAction,
			));
			assert.ok(openGlobalSettings.calledOnceWithExactly("workbench.action.openSettingsJson", {
				revealSetting: { key: "dart.sdkPath" },
			}));
		});

		it("warns when configured workspace dart.sdkPath does not match found SDK and opens workspace settings", async () => {
			// Configure an invalid workspace-level dart.sdkPath so clicking "Open Settings" on the warning
			// opens the workspace settings file instead of global settings.json.
			const badSdkPath = path.join(createTempDir(), "not-an-sdk");
			await setWorkspaceConfigForTest("dart", "sdkPath", badSdkPath);

			const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves(openSettingsAction as any);
			const openWorkspaceSettings = executeCommandStub.withArgs("workbench.action.openWorkspaceSettingsFile", sinon.match.any);
			const openedSettings = waitForStubCall(openWorkspaceSettings);

			await privateApi.sdkUtils!.scanWorkspace();
			await openedSettings;

			assert.ok(showWarningMessage.calledOnceWithExactly(
				`The SDK configured in dart.sdkPath is not a valid SDK folder: ${badSdkPath}`,
				openSettingsAction,
			));
			assert.ok(openWorkspaceSettings.calledOnceWithExactly("workbench.action.openWorkspaceSettingsFile", {
				revealSetting: { key: "dart.sdkPath" },
			}));
		});
	});

	describe("handleMissingSdks & showSdkActivationFailure", () => {
		it("showFluttersDartSdkActivationFailure prompts to reload extension", async () => {
			// When a Flutter SDK is found but its embedded Dart SDK is missing, showFluttersDartSdkActivationFailure
			// instructs the user to run 'flutter doctor' and offers a "Reload" button that restarts the extension.
			const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves("Reload" as any);
			const reloaded = waitForStubCall(reloadExtensionStub);

			privateApi.sdkUtils!.showFluttersDartSdkActivationFailure();
			await reloaded;

			assert.ok(showInformationMessage.calledOnceWithExactly(
				"Could not find Dart in your Flutter SDK. Please run 'flutter doctor' in the terminal then reload the project once all issues are resolved.",
				"Reload",
				showLogAction,
			));
			assert.ok(reloadExtensionStub.calledOnceWith("_dart.reloadExtension", ExtensionRestartReason.FlutterSdkActivationFailure));
		});

		it("showDartActivationFailure locates a Dart SDK, updates global sdkPath, and reloads the extension", async () => {
			// Clicking "Locate SDK" on the missing Dart SDK error prompt opens a folder picker, validates the selected
			// folder using findDartSdk, saves it to global dart.sdkPath, and reloads the extension.
			await setConfigForTest("dart", "sdkPath", undefined);

			const tempDir = createTempDir();
			const dartSdkDir = path.join(tempDir, "dart-sdk");
			createFakeDartSdk(dartSdkDir);

			const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves("Locate SDK" as any);
			sb.stub(vs.window, "showOpenDialog").resolves([vs.Uri.file(dartSdkDir)]);
			const reloaded = waitForStubCall(reloadExtensionStub);

			privateApi.sdkUtils!.showDartActivationFailure();
			await reloaded;

			assert.ok(showErrorMessage.calledOnce);
			assert.equal(vs.workspace.getConfiguration("dart").inspect("sdkPath")?.globalValue, dartSdkDir);
			assert.ok(reloadExtensionStub.calledOnceWith("_dart.reloadExtension", ExtensionRestartReason.LocatedSdk));
		});

		it("showFlutterActivationFailure locates a Flutter SDK, updates global flutterSdkPath, and reloads the extension", async () => {
			// Clicking "Locate SDK" on the missing Flutter SDK error prompt opens a folder picker, validates the selected
			// folder using findFlutterSdk, saves it to global dart.flutterSdkPath, and reloads the extension.
			await setConfigForTest("dart", "flutterSdkPath", undefined);

			const tempDir = createTempDir();
			const flutterSdkDir = path.join(tempDir, "flutter-sdk");
			createFakeFlutterSdk(flutterSdkDir);

			const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves("Locate SDK" as any);
			sb.stub(vs.window, "showOpenDialog").resolves([vs.Uri.file(flutterSdkDir)]);
			const reloaded = waitForStubCall(reloadExtensionStub);

			privateApi.sdkUtils!.showFlutterActivationFailure();
			await reloaded;

			assert.ok(showErrorMessage.calledOnce);
			assert.equal(vs.workspace.getConfiguration("dart").inspect("flutterSdkPath")?.globalValue, flutterSdkDir);
			assert.ok(reloadExtensionStub.calledOnceWith("_dart.reloadExtension", ExtensionRestartReason.LocatedSdk));
		});

		it("Locate SDK validates via search, loops on invalid folder, saves valid SDK, reloads, and re-runs command", async () => {
			// If the user selects a folder that is not a valid SDK on the first attempt, showSdkActivationFailure
			// updates the error prompt message and loops. Selecting a valid SDK folder on the second attempt
			// saves the path, reloads the extension, and re-runs commandToReRun.
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
			const rerunStub = executeCommandStub.withArgs("dart.createProject").resolves();

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
			assert.ok(reloadExtensionStub.calledOnceWith("_dart.reloadExtension", ExtensionRestartReason.LocatedSdk));
			assert.ok(rerunStub.calledOnceWithExactly("dart.createProject"));
		});

		it("Download SDK opens DART_DOWNLOAD_URL in browser for Dart", async () => {
			// Unlike Flutter (which attempts to clone via Git), clicking "Download SDK" for a missing Dart SDK
			// directly opens DART_DOWNLOAD_URL in the browser.
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
			// Clicking "Show Log" on the missing SDK error prompt opens a document containing the startup ringLog.
			sb.stub(vs.window, "showErrorMessage").resolves(showLogAction as any);
			const showTextDocument = sb.stub(vs.window, "showTextDocument");
			const shownDoc = waitForStubCall(showTextDocument);

			await privateApi.sdkUtils!.showSdkActivationFailure(
				"Dart",
				() => ({ candidatePaths: [], sdkInitScript: undefined }),
				DART_DOWNLOAD_URL,
				() => Promise.resolve(),
			);
			await shownDoc;

			assert.ok(showTextDocument.calledOnce);
		});

		it("handleMissingSdks registers fallback commands that trigger activation failure prompts with commandToReRun", () => {
			// When SDKs are missing at activation, handleMissingSdks registers fallback handlers for SDK-dependent
			// commands so invoking any of them shows the relevant missing SDK prompt and passes the command ID to re-run.
			const registeredCommands = new Map<string, (...args: any[]) => any>();
			sb.stub(vs.commands, "registerCommand").callsFake((cmd: string, cb: (...args: any[]) => any) => {
				registeredCommands.set(cmd, cb);
				return { dispose: () => undefined };
			});
			const timeoutCallbacks: Array<() => void> = [];
			(global.setTimeout as unknown as sinon.SinonStub).callsFake(((fn: () => void, ms?: number) => {
				if (ms === 500) {
					timeoutCallbacks.push(fn);
					return 0 as unknown as NodeJS.Timeout;
				}
				return origSetTimeout(fn, ms);
			}) as typeof global.setTimeout);

			const showFlutterStub = sb.stub(privateApi.sdkUtils!, "showFlutterActivationFailure");
			const showDartStub = sb.stub(privateApi.sdkUtils!, "showDartActivationFailure");

			const wc = new WorkspaceContext(
				{ dart: undefined, flutter: undefined, dartSdkIsFromFlutter: false, isPreReleaseSdk: false },
				{},
				/* hasAnyFlutterProjects */ true,
				/* hasAnyWebProjects */ false,
				/* hasAnyStandardDartProjects */ false,
				/* hasProjectsInFuchsiaTree */ false,
				undefined,
				undefined,
			);
			privateApi.sdkUtils!.hasShownActivationFailure = false;
			privateApi.sdkUtils!.handleMissingSdks(wc);

			assert.equal(registeredCommands.size, 5);

			registeredCommands.get("flutter.createProject")!();
			assert.ok(showFlutterStub.calledWithExactly("flutter.createProject"));

			registeredCommands.get("dart.createProject")!();
			assert.ok(showDartStub.calledOnceWithExactly("dart.createProject"));

			registeredCommands.get("_dart.flutter.createSampleProject")!();
			assert.ok(showFlutterStub.calledWithExactly("_dart.flutter.createSampleProject"));

			registeredCommands.get("flutter.doctor")!();
			assert.ok(showFlutterStub.calledWithExactly("flutter.doctor"));

			registeredCommands.get("flutter.upgrade")!();
			assert.ok(showFlutterStub.calledWithExactly("flutter.upgrade"));
			assert.equal(showFlutterStub.callCount, 4);

			// Because a command already showed the activation failure, the 500ms startup timeout should be a no-op.
			assert.equal(privateApi.sdkUtils!.hasShownActivationFailure, true);
			timeoutCallbacks.pop()!();
			assert.equal(showFlutterStub.callCount, 4);
			assert.equal(showDartStub.callCount, 1);
		});

		it("handleMissingSdks shows appropriate startup failure prompt on timeout depending on workspace project types", () => {
			// If no command has triggered an activation failure prompt before the 500ms startup timer fires,
			// handleMissingSdks inspects the WorkspaceContext to decide which prompt (if any) to display.
			sb.stub(vs.commands, "registerCommand").returns({ dispose: () => undefined });
			const timeoutCallbacks: Array<() => void> = [];
			(global.setTimeout as unknown as sinon.SinonStub).callsFake(((fn: () => void, ms?: number) => {
				if (ms === 500) {
					timeoutCallbacks.push(fn);
					return 0 as unknown as NodeJS.Timeout;
				}
				return origSetTimeout(fn, ms);
			}) as typeof global.setTimeout);

			const showFluttersDartStub = sb.stub(privateApi.sdkUtils!, "showFluttersDartSdkActivationFailure");
			const showFlutterStub = sb.stub(privateApi.sdkUtils!, "showFlutterActivationFailure");
			const showDartStub = sb.stub(privateApi.sdkUtils!, "showDartActivationFailure");
			const loggerErrorSpy = sb.spy(privateApi.logger, "error");

			// Case 1: Flutter project where Flutter SDK was found, but its embedded Dart SDK is missing.
			const wcFlutterNoDart = new WorkspaceContext(
				{ dart: undefined, flutter: "/flutter/sdk", dartSdkIsFromFlutter: false, isPreReleaseSdk: false },
				{},
				/* hasAnyFlutterProjects */ true,
				/* hasAnyWebProjects */ false,
				/* hasAnyStandardDartProjects */ false,
				/* hasProjectsInFuchsiaTree */ false,
				undefined,
				undefined,
			);
			privateApi.sdkUtils!.hasShownActivationFailure = false;
			privateApi.sdkUtils!.handleMissingSdks(wcFlutterNoDart);
			timeoutCallbacks.pop()!();
			assert.ok(showFluttersDartStub.calledOnce);

			// Case 2: Standard Dart project missing Dart SDK.
			const wcDartOnly = new WorkspaceContext(
				{ dart: undefined, flutter: undefined, dartSdkIsFromFlutter: false, isPreReleaseSdk: false },
				{},
				/* hasAnyFlutterProjects */ false,
				/* hasAnyWebProjects */ false,
				/* hasAnyStandardDartProjects */ true,
				/* hasProjectsInFuchsiaTree */ false,
				undefined,
				undefined,
			);
			privateApi.sdkUtils!.hasShownActivationFailure = false;
			privateApi.sdkUtils!.handleMissingSdks(wcDartOnly);
			timeoutCallbacks.pop()!();
			assert.ok(showDartStub.calledOnceWithExactly(undefined));

			// Case 3: Flutter project missing Flutter SDK.
			const wcFlutterMissing = new WorkspaceContext(
				{ dart: undefined, flutter: undefined, dartSdkIsFromFlutter: false, isPreReleaseSdk: false },
				{},
				/* hasAnyFlutterProjects */ true,
				/* hasAnyWebProjects */ false,
				/* hasAnyStandardDartProjects */ false,
				/* hasProjectsInFuchsiaTree */ false,
				undefined,
				undefined,
			);
			privateApi.sdkUtils!.hasShownActivationFailure = false;
			privateApi.sdkUtils!.handleMissingSdks(wcFlutterMissing);
			timeoutCallbacks.pop()!();
			assert.ok(showFlutterStub.calledOnceWithExactly(undefined));

			// Case 4: No Dart or Flutter projects open -> logs error and suppresses the UI prompt.
			showFluttersDartStub.resetHistory();
			showFlutterStub.resetHistory();
			showDartStub.resetHistory();
			const wcEmpty = new WorkspaceContext(
				{ dart: undefined, flutter: undefined, dartSdkIsFromFlutter: false, isPreReleaseSdk: false },
				{},
				/* hasAnyFlutterProjects */ false,
				/* hasAnyWebProjects */ false,
				/* hasAnyStandardDartProjects */ false,
				/* hasProjectsInFuchsiaTree */ false,
				undefined,
				undefined,
			);
			privateApi.sdkUtils!.hasShownActivationFailure = false;
			privateApi.sdkUtils!.handleMissingSdks(wcEmpty);
			timeoutCallbacks.pop()!();
			assert.equal(showFluttersDartStub.called, false);
			assert.equal(showFlutterStub.called, false);
			assert.equal(showDartStub.called, false);
			assert.ok(loggerErrorSpy.calledWith("No Dart or Flutter SDK was found. Suppressing prompt because it doesn't appear that a Dart/Flutter project is open."));
		});
	});

	describe("tryFlutterCloneIfGitAvailable, promptForFlutterClone, and cloneFlutterWithProgress", () => {
		// Intercepts child_process.spawn for git/flutter commands during the "Download SDK" (clone Flutter) workflow.
		function stubSpawnForGit(handler: (bin: string, args: string[], cwd: string | undefined) => { exitCode?: number; stdout?: string; stderr?: string; error?: Error; delayMs?: number } | undefined) {
			const realSpawn = childProcess.spawn as (command: string, args?: readonly string[], options?: SpawnOptions) => ChildProcess;
			return sb.stub(childProcess, "spawn").callsFake((bin: string, args?: string[], opts?: SpawnOptions): unknown => {
				const res = handler(bin, args ?? [], opts?.cwd?.toString());
				if (!res)
					return realSpawn(bin, args, opts);

				const proc: any = new EventEmitter();
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

				setImmediate(() => {
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
				});

				return proc as ChildProcess;
			});
		}

		it("shows error and opens setup instructions when git --version fails or errors", async () => {
			// Clicking "Download SDK" for Flutter checks whether Git is available by running "git --version"
			// (using the git binary path from the active vscode.git extension if available).
			sb.stub(vs.extensions, "getExtension").withArgs("vscode.git").returns({
				exports: { getAPI: () => ({ git: { path: "/custom/git" } }) },
				isActive: true,
			} as any);

			let gitResult: { exitCode?: number; stderr?: string; error?: Error } = { exitCode: 1, stderr: "git not found" };
			const spawnedBins: string[] = [];
			stubSpawnForGit((bin, args) => {
				if (args.includes("--version")) {
					spawnedBins.push(bin);
					return gitResult;
				}
				return undefined;
			});

			const openInBrowser = sb.stub(privateApi.envUtils, "openInBrowser").resolves(true);
			const showErrorMessage = sb.stub(vs.window, "showErrorMessage");

			// 1. Non-zero exit code from "git --version" -> shows error message; clicking "Setup Instructions" opens FLUTTER_DOWNLOAD_URL.
			showErrorMessage.onCall(0).resolves("Download SDK" as any);
			showErrorMessage.onCall(1).resolves("Setup Instructions" as any);

			await privateApi.sdkUtils!.showSdkActivationFailure(
				"Flutter",
				() => ({ candidatePaths: [], sdkInitScript: undefined }),
				FLUTTER_DOWNLOAD_URL,
				() => Promise.resolve(),
			);

			assert.deepStrictEqual(spawnedBins, ["/custom/git"]);
			assert.ok(showErrorMessage.calledWithExactly(
				"Unable to clone Flutter because Git was not found. Please clone or download the Flutter SDK manually.",
				"Setup Instructions",
			));
			assert.ok(openInBrowser.calledOnceWithExactly(FLUTTER_DOWNLOAD_URL));

			// 2. Spawn error from "git --version" -> shows the same error message; dismissing it returns to the outer prompt.
			showErrorMessage.resetHistory();
			gitResult = { error: new Error("ENOENT") };
			showErrorMessage.onCall(0).resolves("Download SDK" as any);
			showErrorMessage.onCall(1).resolves(undefined);
			showErrorMessage.onCall(2).resolves(undefined);

			await privateApi.sdkUtils!.showSdkActivationFailure(
				"Flutter",
				() => ({ candidatePaths: [], sdkInitScript: undefined }),
				FLUTTER_DOWNLOAD_URL,
				() => Promise.resolve(),
			);

			assert.equal(showErrorMessage.callCount, 3);
			assert.ok(showErrorMessage.secondCall.calledWithExactly(
				"Unable to clone Flutter because Git was not found. Please clone or download the Flutter SDK manually.",
				"Setup Instructions",
			));
		});

		it("returns to activation failure prompt when git check or folder selection is cancelled", async () => {
			// If the user cancels the "Checking for git" progress notification or cancels the folder selection dialog,
			// the clone workflow aborts without showing an error and returns to the initial "Could not find a Flutter SDK" prompt.
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

			let cloneSpawned = false;
			stubSpawnForGit((_bin, args) => {
				if (args.includes("--version")) {
					if (throwOnGitCancel)
						return { error: new Error("cancelled error") };
					return { exitCode: 0, stdout: "git version 2.40.0" };
				}
				if (args.includes("clone")) {
					cloneSpawned = true;
					return { exitCode: 0 };
				}
				return undefined;
			});

			const showErrorMessage = sb.stub(vs.window, "showErrorMessage");
			const showOpenDialog = sb.stub(vs.window, "showOpenDialog").resolves(undefined);

			// 1. Cancelled during "git --version" check (covers both normal exit and spawn error while cancelled).
			showErrorMessage.onCall(0).resolves("Download SDK" as any);
			showErrorMessage.onCall(1).callsFake(async () => {
				throwOnGitCancel = true;
				return "Download SDK";
			});
			showErrorMessage.onCall(2).resolves(undefined);

			await privateApi.sdkUtils!.showSdkActivationFailure(
				"Flutter",
				() => ({ candidatePaths: [], sdkInitScript: undefined }),
				FLUTTER_DOWNLOAD_URL,
				() => Promise.resolve(),
			);

			assert.equal(showErrorMessage.callCount, 3);
			assert.equal(showOpenDialog.called, false);

			// 2. Cancelled during folder selection (showOpenDialog returns undefined).
			cancelGitCheck = false;
			throwOnGitCancel = false;
			showErrorMessage.resetHistory();
			showErrorMessage.onCall(0).resolves("Download SDK" as any);
			showErrorMessage.onCall(1).resolves(undefined);

			await privateApi.sdkUtils!.showSdkActivationFailure(
				"Flutter",
				() => ({ candidatePaths: [], sdkInitScript: undefined }),
				FLUTTER_DOWNLOAD_URL,
				() => Promise.resolve(),
			);

			assert.equal(showErrorMessage.callCount, 2);
			assert.ok(showOpenDialog.calledOnce);
			assert.equal(cloneSpawned, false);
		});

		it("shows error when git clone fails or errors, and suppresses error when cancelled", async () => {
			// Tests the three non-success outcomes of cloneFlutterWithProgress:
			// 1. Non-zero exit code from "git clone".
			// 2. Process spawn error from "git clone".
			// 3. User cancelling the "Cloning the Flutter SDK..." progress notification.
			let cancelClone = false;
			let cloneResult: { exitCode?: number; stderr?: string; error?: Error } = { exitCode: 128, stderr: "fatal: repository not found" };
			const origWithProgress = vs.window.withProgress.bind(vs.window);
			sb.stub(vs.window, "withProgress").callsFake(async <R>(options: vs.ProgressOptions, task: (progress: vs.Progress<{ message?: string; increment?: number }>, token: vs.CancellationToken) => Thenable<R>): Promise<R> => {
				if (options.title === cloningFlutterMessage && cancelClone) {
					const tokenSource = new vs.CancellationTokenSource();
					tokenSource.cancel();
					return task({ report: () => undefined }, tokenSource.token);
				}
				return origWithProgress(options, task);
			});

			stubSpawnForGit((_bin, args) => {
				if (args.includes("--version"))
					return { exitCode: 0, stdout: "git version 2.40.0" };
				if (args.includes("clone"))
					return cloneResult;
				return undefined;
			});

			const cloneDir = createTempDir();
			sb.stub(vs.window, "showOpenDialog").resolves([vs.Uri.file(cloneDir)]);
			const openInBrowser = sb.stub(privateApi.envUtils, "openInBrowser").resolves(true);
			const showErrorMessage = sb.stub(vs.window, "showErrorMessage");

			// 1. Non-zero exit code from git clone -> shows stderr error and setup instructions prompt.
			showErrorMessage.onCall(0).resolves("Download SDK" as any);
			showErrorMessage.onCall(1).resolves(undefined);
			showErrorMessage.onCall(2).resolves("Setup Instructions" as any);

			await privateApi.sdkUtils!.showSdkActivationFailure(
				"Flutter",
				() => ({ candidatePaths: [], sdkInitScript: undefined }),
				FLUTTER_DOWNLOAD_URL,
				() => Promise.resolve(),
			);

			assert.ok(showErrorMessage.calledWith("Failed to clone Flutter: fatal: repository not found"));
			assert.ok(showErrorMessage.calledWith(
				"Failed to clone Flutter using Git. Please clone or download the Flutter SDK manually.",
				"Setup Instructions",
			));
			assert.ok(openInBrowser.calledOnceWithExactly(FLUTTER_DOWNLOAD_URL));

			// 2. Spawn error from git clone -> logs error and shows manual setup message.
			const loggerErrorSpy = sb.spy(privateApi.logger, "error");
			showErrorMessage.resetHistory();
			cloneResult = { error: new Error("clone spawn error") };
			showErrorMessage.onCall(0).resolves("Download SDK" as any);
			showErrorMessage.onCall(1).resolves(undefined);
			showErrorMessage.onCall(2).resolves(undefined);

			await privateApi.sdkUtils!.showSdkActivationFailure(
				"Flutter",
				() => ({ candidatePaths: [], sdkInitScript: undefined }),
				FLUTTER_DOWNLOAD_URL,
				() => Promise.resolve(),
			);

			assert.ok(loggerErrorSpy.calledWith('Failed to run "git clone" to download Flutter, so skipping "clone Flutter SDK" workflow: Error: clone spawn error'));
			assert.ok(showErrorMessage.calledWith(
				"Failed to clone Flutter using Git. Please clone or download the Flutter SDK manually.",
				"Setup Instructions",
			));

			// 3. Cancelled during git clone (both normal exit and error exit) -> no failure message shown.
			showErrorMessage.resetHistory();
			cancelClone = true;
			cloneResult = { exitCode: 1, stderr: "cancelled" };
			showErrorMessage.onCall(0).resolves("Download SDK" as any);
			showErrorMessage.onCall(1).callsFake(async () => {
				cloneResult = { error: new Error("cancelled error") };
				return "Download SDK";
			});
			showErrorMessage.onCall(2).resolves(undefined);

			await privateApi.sdkUtils!.showSdkActivationFailure(
				"Flutter",
				() => ({ candidatePaths: [], sdkInitScript: undefined }),
				FLUTTER_DOWNLOAD_URL,
				() => Promise.resolve(),
			);

			assert.equal(showErrorMessage.callCount, 3);
			assert.ok(showErrorMessage.getCalls().every((c) => (c.args[0] as string).startsWith("Could not find a Flutter SDK.")));
		});

		it("clones Flutter into selected folder, sets global Flutter SDK path, initializes Flutter, and reloads extension", async () => {
			// Full happy path when clicking "Download SDK" for Flutter:
			// checks "git --version", prompts for a target directory, runs "git clone -b stable https://github.com/flutter/flutter.git",
			// saves the cloned flutter directory to global dart.flutterSdkPath, runs "flutter --help" to initialize Flutter,
			// offers to add Flutter to PATH, reloads the extension, and re-runs commandToReRun.
			await setConfigForTest("dart", "flutterSdkPath", undefined);

			const cloneDir = createTempDir();
			const expectedFlutterFolder = path.join(cloneDir, "flutter");

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

			const rerunStub = executeCommandStub.withArgs("flutter.createProject").resolves();

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
			assert.equal(vs.workspace.getConfiguration("dart").inspect("flutterSdkPath")?.globalValue, expectedFlutterFolder);
			assert.ok(showInfo.calledWith(addSdkToPathPrompt("Flutter")));
			assert.ok(reloadExtensionStub.calledOnceWithExactly("_dart.reloadExtension", ExtensionRestartReason.AfterFlutterClone));
			assert.ok(rerunStub.calledOnceWithExactly("flutter.createProject"));
		});
	});

	describe("scanWorkspace", () => {
		it("returns early when analyzerSshHost is configured", async () => {
			// When dart.analyzerSshHost is configured, the analysis server runs over SSH on a remote host,
			// so scanWorkspace skips local workspace/SDK scanning and returns a WorkspaceContext with config.sdkPath.
			await setConfigForTest("dart", "analyzerSshHost", "my-ssh-host");
			await setConfigForTest("dart", "sdkPath", "/remote/dart-sdk");

			const wc = await privateApi.sdkUtils!.scanWorkspace();
			assert.equal(wc.sdks.dart, "/remote/dart-sdk");
			assert.equal(wc.sdks.flutter, undefined);
		});

		it("handles Flutter projects, snap initialization, missing version file, and Fuchsia/Dart SDK roots", async () => {
			// Set up a workspace root that is simultaneously a Dart SDK repo (.git + README.dart-sdk + DEPS),
			// a Fuchsia tree (.jiri_root), and a Bazel workspace (WORKSPACE) containing a standard Dart project (pubspec.yaml).
			const tempDir = createTempDir();
			fs.mkdirSync(path.join(tempDir, ".git"), { recursive: true });
			touchFile(path.join(tempDir, "README.dart-sdk"));
			touchFile(path.join(tempDir, "DEPS"));
			fs.mkdirSync(path.join(tempDir, ".jiri_root"), { recursive: true });
			touchFile(path.join(tempDir, "WORKSPACE"));
			touchFile(path.join(tempDir, "pubspec.yaml"), "name: dart_proj\n");

			// Set up a second workspace folder containing FLUTTER_CREATE_PROJECT_TRIGGER_FILE so it is detected as a Flutter project.
			const flutterProj = path.join(tempDir, "flutter_proj");
			touchFile(path.join(flutterProj, FLUTTER_CREATE_PROJECT_TRIGGER_FILE));

			// Put a snap flutter symlink on PATH ahead of an uninitialized Flutter SDK directory.
			// On the first search, findFlutterSdk sees no initialized SDK and returns the snap symlink as sdkInitScript.
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

			// When scanWorkspace runs "<snapFlutterLink> --help" to initialize the SDK, create the Flutter SDK on disk
			// (without a version file, to also test the MISSING_VERSION_FILE_VERSION fallback for main/master builds).
			const realSpawn = childProcess.spawn as (command: string, args?: readonly string[], options?: SpawnOptions) => ChildProcess;
			sb.stub(childProcess, "spawn").callsFake((bin: string, args?: string[], opts?: SpawnOptions): unknown => {
				if (args?.includes("--help")) {
					createFakeFlutterSdk(realFlutterSdk, { version: null, withDartSdk: true });
					const proc: any = new EventEmitter();
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
			defer("clear caches", () => privateApi.clearCaches());

			const origPath = process.env.PATH;
			process.env.PATH = `${snapBinDir}${path.delimiter}${path.join(realFlutterSdk, "bin")}`;
			defer("restore PATH", () => process.env.PATH = origPath);

			// Configure an invalid workspace-level dart.flutterSdkPath so warnIfBadConfigSdk is triggered once realFlutterSdk is found on PATH.
			const badFlutterPath = path.join(tempDir, "bad-flutter-sdk");
			await setWorkspaceConfigForTest("dart", "flutterSdkPath", badFlutterPath);
			const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves(undefined);

			const wc = await privateApi.sdkUtils!.scanWorkspace();
			assert.equal(wc.hasAnyFlutterProjects, true);
			assert.equal(wc.hasAnyStandardDartProjects, true);
			assert.equal(wc.hasProjectsInFuchsiaTree, true);
			assert.equal(wc.sdks.flutter, realFlutterSdk);
			assert.equal(wc.sdks.flutterVersion, MISSING_VERSION_FILE_VERSION);
			assert.ok(showWarningMessage.calledWith(
				`The SDK configured in dart.flutterSdkPath is not a valid SDK folder: ${badFlutterPath}`,
				openSettingsAction,
			));
		});

		it("handles non-Dart workspace, forceFlutterWorkspace, and fallback Flutter initialization for Dart SDK", async () => {
			// Create a Flutter SDK whose embedded bin/cache/dart-sdk has not yet been downloaded.
			const tempDir = createTempDir();
			const flutterSdk = path.join(tempDir, "flutter-sdk");
			createFakeFlutterSdk(flutterSdk, { withDartSdk: false });

			// When scanWorkspace runs "flutter --help" to initialize Flutter, populate bin/cache/dart-sdk.
			const realSpawn = childProcess.spawn as (command: string, args?: readonly string[], options?: SpawnOptions) => ChildProcess;
			sb.stub(childProcess, "spawn").callsFake((bin: string, args?: string[], opts?: SpawnOptions): unknown => {
				if (args?.includes("--help")) {
					createFakeDartSdk(path.join(flutterSdk, "bin", "cache", "dart-sdk"));
					const proc: any = new EventEmitter();
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

			// Open an empty workspace with no pubspec.yaml and no .dart files.
			sb.stub(vs.workspace, "workspaceFolders").get(() => [
				{ uri: vs.Uri.file(tempDir), name: "empty", index: 0 },
			]);
			sb.stub(vs.workspace, "findFiles").resolves([]);
			privateApi.clearCaches();
			defer("clear caches", () => privateApi.clearCaches());

			const origPath = process.env.PATH;
			process.env.PATH = "";
			defer("restore PATH", () => process.env.PATH = origPath);

			await setConfigForTest("dart", "flutterSdkPath", flutterSdk);
			await setConfigForTest("dart", "sdkPath", undefined);

			// Because there are no Flutter or Dart projects in the workspace:
			// 1. Analytics, startup prompts, and SDK update checks are disabled on workspaceConfig.
			// 2. Even though no Flutter project was open (so Flutter wasn't initialized earlier in scanWorkspace),
			//    fallback initialization runs "flutter --help" to obtain a Dart SDK from flutterSdk/bin/cache/dart-sdk.
			const wc = await privateApi.sdkUtils!.scanWorkspace();
			assert.equal(wc.hasAnyFlutterProjects, false);
			assert.equal(wc.hasAnyStandardDartProjects, false);
			assert.equal(wc.config.disableAnalytics, true);
			assert.equal(wc.config.disableStartupPrompts, true);
			assert.equal(wc.config.disableSdkUpdateChecks, true);
			assert.equal(wc.sdks.dart, path.join(flutterSdk, "bin", "cache", "dart-sdk"));

			// On non-Windows platforms, adding a Bazel WORKSPACE and dart/config/ide/flutter.json causes
			// processBazelWorkspace / tryReadFlutterJson to set forceFlutterWorkspace = true and read sdkHome.
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
		});
	});
});
