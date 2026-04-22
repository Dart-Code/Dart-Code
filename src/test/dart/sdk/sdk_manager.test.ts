import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { config } from "../../../extension/config";
import { DartSdkManager, FlutterSdkManager } from "../../../extension/sdk/sdk_manager";
import { dartVMPath, flutterPath } from "../../../shared/constants";
import { Logger, Sdks } from "../../../shared/interfaces";
import * as fsUtils from "../../../shared/utils/fs";
import { defer, getRandomTempFolder, sb, tryDelete } from "../../helpers";

describe("SdkManager", () => {
	let logger: Logger;
	let sdks: Sdks;
	let getChildFoldersStub: sinon.SinonStub;
	let setSdkPath: sinon.SinonStub;
	let setFlutterSdkPath: sinon.SinonStub;

	beforeEach(() => {
		logger = {
			error: sb.stub(),
			info: sb.stub(),
			warn: sb.stub(),
		};
		sdks = {
			dart: "/sdks/current-dart",
			dartSdkIsFromFlutter: false,
			flutter: "/sdks/current-flutter",
			isPreReleaseSdk: false,
		};

		setSdkPath = sb.stub(config, "setSdkPath").resolves();
		setFlutterSdkPath = sb.stub(config, "setFlutterSdkPath").resolves();
		getChildFoldersStub = sb.stub(fsUtils, "getChildFolders").resolves([]);
		sb.stub(fsUtils, "homeRelativePath").callsFake((value: string | undefined) => value);
		sb.stub(fsUtils, "safeRealpathSync").callsFake((value: string) => value);
	});

	function createSdkRoot(folderName: string) {
		const tempFolder = getRandomTempFolder();
		const sdkRoot = path.join(tempFolder, folderName);
		defer(`delete temp sdk root folder ${tempFolder}`, () => tryDelete(tempFolder));
		fs.mkdirSync(sdkRoot, { recursive: true });
		return sdkRoot;
	}

	function stubDartConfig({
		sdkPath,
		sdkPaths = ["/sdks"],
		sdkSwitchingTarget = "workspace",
		workspaceSdkPath,
	}: {
		sdkPath?: string,
		sdkPaths?: string[],
		sdkSwitchingTarget?: "workspace" | "global",
		workspaceSdkPath?: string,
	}) {
		sb.stub(config, "sdkPath").get(() => sdkPath);
		sb.stub(config, "sdkPaths").get(() => sdkPaths);
		sb.stub(config, "sdkSwitchingTarget").get(() => sdkSwitchingTarget);
		sb.stub(config, "workspaceSdkPath").get(() => workspaceSdkPath);
	}

	function stubFlutterConfig({
		flutterSdkPath,
		flutterSdkPaths = ["/sdks"],
		sdkSwitchingTarget = "workspace",
		workspaceFlutterSdkPath,
	}: {
		flutterSdkPath?: string,
		flutterSdkPaths?: string[],
		sdkSwitchingTarget?: "workspace" | "global",
		workspaceFlutterSdkPath?: string,
	}) {
		sb.stub(config, "flutterSdkPath").get(() => flutterSdkPath);
		sb.stub(config, "flutterSdkPaths").get(() => flutterSdkPaths);
		sb.stub(config, "sdkSwitchingTarget").get(() => sdkSwitchingTarget);
		sb.stub(config, "workspaceFlutterSdkPath").get(() => workspaceFlutterSdkPath);
	}

	it("promptForSdk does not prompt when no SDKs are found", async () => {
		const sdkRoot = createSdkRoot("sdks");
		stubDartConfig({ sdkPath: undefined });
		sb.stub(fsUtils, "existsAndIsFileSync").returns(false);
		sb.stub(fsUtils, "getSdkVersion").returns(undefined);
		const showQuickPick = sb.stub(vs.window, "showQuickPick");
		const manager = new DartSdkManager(logger, sdks);

		await manager.promptForSdk([sdkRoot]);

		assert.equal(showQuickPick.called, false);
	});

	it("promptForSdk prompts with auto-detect, current SDK and sorted versions", async () => {
		const sdkRoot = createSdkRoot("sdks");
		const dart300 = path.join(sdkRoot, "dart-3.0.0");
		const dart219 = path.join(sdkRoot, "dart-2.19.0");
		const currentDart = path.join(sdkRoot, "dart-current");
		sdks = {
			...sdks,
			dart: currentDart,
		};
		stubDartConfig({ sdkPath: "/configured/dart" });
		getChildFoldersStub.resolves([dart300, dart219]);
		sb.stub(fsUtils, "existsAndIsFileSync").callsFake((filePath: string) => [
			path.join(dart219, dartVMPath),
			path.join(dart300, dartVMPath),
			path.join(currentDart, dartVMPath),
		].includes(filePath));
		sb.stub(fsUtils, "getSdkVersion").callsFake((_logger, sdk) => {
			switch (sdk.sdkRoot) {
				case currentDart: return "3.1.0";
				case dart300: return "3.0.0";
				case dart219: return "2.19.0";
				default: return undefined;
			}
		});
		const showQuickPick = sb.stub(vs.window, "showQuickPick").resolves(undefined);
		const manager = new DartSdkManager(logger, sdks);

		await manager.promptForSdk([sdkRoot]);

		assert.ok(showQuickPick.calledOnce);
		const items = showQuickPick.firstCall.args[0] as vs.QuickPickItem[];
		assert.equal(showQuickPick.firstCall.args[1]?.placeHolder, "Select an SDK to use");
		assert.equal(items.length, 4);
		assert.deepStrictEqual(items.map((item) => item.label), [
			"Auto-detect SDK location",
			"Dart SDK 2.19.0",
			"Dart SDK 3.0.0",
			"Dart SDK 3.1.0",
		]);
		assert.equal(items[3].description, "Current setting");
		assert.equal(items[3].detail, currentDart);
	});

	it("promptForSdk marks auto-detect as current when no SDK is configured", async () => {
		const sdkRoot = createSdkRoot("sdks");
		const dart300 = path.join(sdkRoot, "dart-3.0.0");
		const currentDart = path.join(sdkRoot, "dart-current");
		sdks = {
			...sdks,
			dart: currentDart,
		};
		stubDartConfig({ sdkPath: undefined });
		getChildFoldersStub.resolves([dart300]);
		sb.stub(fsUtils, "existsAndIsFileSync").callsFake((filePath: string) => [
			path.join(dart300, dartVMPath),
			path.join(currentDart, dartVMPath),
		].includes(filePath));
		sb.stub(fsUtils, "getSdkVersion").callsFake((_logger, sdk) => sdk.sdkRoot === dart300 ? "3.0.0" : "3.1.0");
		const showQuickPick = sb.stub(vs.window, "showQuickPick").resolves(undefined);
		const manager = new DartSdkManager(logger, sdks);

		await manager.promptForSdk([sdkRoot]);

		const items = showQuickPick.firstCall.args[0] as vs.QuickPickItem[];
		assert.equal(items[0].label, "Auto-detect SDK location");
		assert.equal(items[0].description, "Current setting");
		assert.equal(items[0].detail, `Found at ${currentDart}`);
	});

	it("selecting a Dart SDK updates workspace config by default", async () => {
		const sdkRoot = createSdkRoot("sdks");
		const dart300 = path.join(sdkRoot, "dart-3.0.0");
		const currentDart = path.join(sdkRoot, "dart-current");
		sdks = {
			...sdks,
			dart: currentDart,
		};
		stubDartConfig({ sdkPath: "/configured/dart", sdkSwitchingTarget: "workspace" });
		getChildFoldersStub.resolves([dart300]);
		sb.stub(fsUtils, "existsAndIsFileSync").callsFake((filePath: string) => [
			path.join(dart300, dartVMPath),
			path.join(currentDart, dartVMPath),
		].includes(filePath));
		sb.stub(fsUtils, "getSdkVersion").callsFake((_logger, sdk) => sdk.sdkRoot === dart300 ? "3.0.0" : "3.1.0");
		const showQuickPick = sb.stub(vs.window, "showQuickPick").callsFake(async (items) => (items as Array<{ folder: string }>).find((item) => item.folder === dart300));
		const manager = new DartSdkManager(logger, sdks);

		await manager.promptForSdk([sdkRoot]);

		assert.ok(setSdkPath.calledOnce);
		assert.ok(showQuickPick.calledOnce);
		assert.deepStrictEqual(setSdkPath.firstCall.args, [dart300, vs.ConfigurationTarget.Workspace]);
	});

	it("selecting a Dart SDK with global switching clears workspace config first", async () => {
		const sdkRoot = createSdkRoot("sdks");
		const dart300 = path.join(sdkRoot, "dart-3.0.0");
		const currentDart = path.join(sdkRoot, "dart-current");
		sdks = {
			...sdks,
			dart: currentDart,
		};
		stubDartConfig({ sdkPath: "/configured/dart", sdkSwitchingTarget: "global", workspaceSdkPath: "/workspace/dart" });
		getChildFoldersStub.resolves([dart300]);
		sb.stub(fsUtils, "existsAndIsFileSync").callsFake((filePath: string) => [
			path.join(dart300, dartVMPath),
			path.join(currentDart, dartVMPath),
		].includes(filePath));
		sb.stub(fsUtils, "getSdkVersion").callsFake((_logger, sdk) => sdk.sdkRoot === dart300 ? "3.0.0" : "3.1.0");
		sb.stub(vs.window, "showQuickPick").callsFake(async (items) => (items as Array<{ folder: string }>).find((item) => item.folder === dart300));
		const manager = new DartSdkManager(logger, sdks);

		await manager.promptForSdk([sdkRoot]);

		assert.equal(setSdkPath.callCount, 2);
		assert.deepStrictEqual(setSdkPath.firstCall.args, [undefined, vs.ConfigurationTarget.Workspace]);
		assert.deepStrictEqual(setSdkPath.secondCall.args, [dart300, vs.ConfigurationTarget.Global]);
	});

	it("selecting auto-detect for Flutter with global switching clears workspace config and stores undefined globally", async () => {
		const sdkRoot = createSdkRoot("sdks");
		const flutter310 = path.join(sdkRoot, "flutter-3.10.0");
		const currentFlutter = path.join(sdkRoot, "flutter-current");
		sdks = {
			...sdks,
			flutter: currentFlutter,
		};
		stubFlutterConfig({ flutterSdkPath: "/configured/flutter", sdkSwitchingTarget: "global", workspaceFlutterSdkPath: "/workspace/flutter" });
		getChildFoldersStub.resolves([flutter310]);
		sb.stub(fsUtils, "existsAndIsFileSync").callsFake((filePath: string) => [
			path.join(flutter310, flutterPath),
			path.join(currentFlutter, flutterPath),
		].includes(filePath));
		sb.stub(fsUtils, "getSdkVersion").callsFake((_logger, sdk) => sdk.sdkRoot === flutter310 ? "3.10.0" : "3.13.0");
		sb.stub(vs.window, "showQuickPick").callsFake(async (items) => (items as Array<{ folder: string | undefined }>)[0]);
		const manager = new FlutterSdkManager(logger, sdks);

		await manager.promptForSdk([sdkRoot]);

		assert.equal(setFlutterSdkPath.callCount, 2);
		assert.deepStrictEqual(setFlutterSdkPath.firstCall.args, [undefined, vs.ConfigurationTarget.Workspace]);
		assert.deepStrictEqual(setFlutterSdkPath.secondCall.args, [undefined, vs.ConfigurationTarget.Global]);
	});
});
