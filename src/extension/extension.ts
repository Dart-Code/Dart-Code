import * as vs from "vscode";
import { DartCapabilities } from "../shared/capabilities/dart";
import { FlutterCapabilities } from "../shared/capabilities/flutter";
import { DART_PROJECT_LOADED, FLUTTER_PROJECT_LOADED, FLUTTER_SUPPORTS_ATTACH, PROJECT_LOADED, WEB_PROJECT_LOADED } from "../shared/constants.contexts";
import { DartWorkspaceContext, FlutterWorkspaceContext, IAmDisposable, IFlutterDaemon } from "../shared/interfaces";
import { EmittingLogger, RingLog } from "../shared/logging";
import { internalApiSymbol } from "../shared/symbols";
import { getRandomInt } from "../shared/utils/fs";
import { FlutterDeviceManager } from "../shared/vscode/device_manager";
import { Context } from "../shared/vscode/workspace";
import { WorkspaceContext } from "../shared/workspace";
import { LspAnalyzer } from "./analysis/analyzer";
import { Analytics } from "./analytics";
import { PublicDartExtensionApiImpl } from "./api/extension_api";
import { PublicDartExtensionApi } from "./api/interfaces";
import { config } from "./config";
import { VsCodeDartToolingDaemon } from "./dart/tooling_daemon";
import { FlutterDaemon } from "./flutter/flutter_daemon";
import { SdkUtils } from "./sdk/utils";

let maybeAnalyzer: LspAnalyzer | undefined;
let flutterDaemon: IFlutterDaemon | undefined;
let deviceManager: FlutterDeviceManager | undefined;
const dartCapabilities = DartCapabilities.empty;
const flutterCapabilities = FlutterCapabilities.empty;
let analytics: Analytics;

const loggers: IAmDisposable[] = [];
let ringLogger: IAmDisposable | undefined;
const logger = new EmittingLogger();
let extensionLog: IAmDisposable | undefined;
const exportedApi: PublicDartExtensionApi & { [internalApiSymbol]?: any } = new PublicDartExtensionApiImpl();

// Keep a running in-memory buffer of last 500 log events we can give to the
// user when something crashed even if they don't have disk-logging enabled.
export const ringLog: RingLog = new RingLog(500);

// A key used to access state tied to this "session" to work around a possible VS Code bug that persists
// state unexpectedly accross sessions.
//
// https://github.com/microsoft/vscode/issues/240207
export const perSessionWebviewStateKey = `webviewState_${(new Date()).getTime()}_${getRandomInt(1, 1000)}`;

export async function activate(context: vs.ExtensionContext, isRestart = false) {
	analytics = new Analytics(logger);
	const sdkUtils = new SdkUtils(logger, context, analytics);
	const workspaceContextUnverified = await sdkUtils.scanWorkspace();
	analytics.workspaceContext = workspaceContextUnverified;

	const workspaceContext = workspaceContextUnverified as DartWorkspaceContext;
	const extContext = Context.for(context, workspaceContext);
	const sdks = workspaceContext.sdks;

	// // Record the Flutter SDK path so we can set FLUTTER_ROOT for spawned processes.
	// if (workspaceContext.hasAnyFlutterProjects && workspaceContext.sdks.flutter)
	// 	setFlutterRoot(workspaceContext.sdks.flutter);
	// setupToolEnv(config.env);

	if (sdks.dartVersion)
		dartCapabilities.version = sdks.dartVersion;

	if (sdks.flutterVersion)
		flutterCapabilities.version = sdks.flutterVersion;

	// Fire up Flutter daemon if required.
	if (workspaceContext.hasAnyFlutterProjects && sdks.flutter) {
		let runIfNoDevices;
		let portFromLocalExtension;

		flutterDaemon = new FlutterDaemon(logger, analytics, workspaceContext as FlutterWorkspaceContext, flutterCapabilities, runIfNoDevices, portFromLocalExtension);
		deviceManager = new FlutterDeviceManager(logger, flutterDaemon, config, workspaceContext, extContext, runIfNoDevices, portFromLocalExtension);
		context.subscriptions.push(deviceManager);
		context.subscriptions.push(flutterDaemon);
	}

	// Dart Tooling Daemon.
	const dartToolingDaemon = dartCapabilities.supportsToolingDaemon && !workspaceContext.config.disableDartToolingDaemon
		? new VsCodeDartToolingDaemon(context, logger, sdks, dartCapabilities, deviceManager)
		: undefined;
	// void dartToolingDaemon?.dtdUri.then((uri) => extensionApiModel.setDtdUri(uri));

	// Fire up the analyzer process.
	const analyzer = new LspAnalyzer(logger, sdks, dartCapabilities, workspaceContext, dartToolingDaemon);

	const privateApi = {
		analyzer,
		logger,
	};
	// Copy all fields and getters from privateApi into the existing object so that it works
	// correctly through exports.
	Object.defineProperties(
		(exportedApi as any)[internalApiSymbol] ??= {},
		Object.getOwnPropertyDescriptors(privateApi)
	);

	return exportedApi;
}

export async function deactivate(isRestart = false): Promise<void> {
	logger.info(`Extension deactivate was called (isRestart: ${isRestart})`);
	// extensionApiModel.clear();

	const loggersToDispose = [...loggers];
	loggers.length = 0;
	await Promise.allSettled([
		tryCleanup(() => setCommandVisiblity(false)),
		tryCleanup(() => maybeAnalyzer?.dispose()),
		tryCleanup(() => flutterDaemon?.shutdown()),
		tryCleanup(() => vs.commands.executeCommand("setContext", FLUTTER_SUPPORTS_ATTACH, false)),
		...loggersToDispose.map((l) => tryCleanup(() => l.dispose())),
	]);
	logger.info(`Extension cleanup done`);

	// Pump for any log events that might need to be written to the loggers.
	await new Promise((resolve) => setTimeout(resolve, 100));

	if (!isRestart) {
		logger.info(`Closing all loggers...`);
		await new Promise((resolve) => setTimeout(resolve, 50));
		await Promise.allSettled([
			tryCleanup(() => logger.dispose()),
			tryCleanup(() => ringLogger?.dispose()),
			tryCleanup(() => extensionLog?.dispose()),
		]);
		await new Promise((resolve) => setTimeout(resolve, 50));
	} else {
		logger.info(`Restarting...`);
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
}

function setCommandVisiblity(enable: boolean, workspaceContext?: WorkspaceContext) {
	void vs.commands.executeCommand("setContext", PROJECT_LOADED, enable);
	void vs.commands.executeCommand("setContext", DART_PROJECT_LOADED, enable && workspaceContext?.hasAnyStandardDartProjects);
	void vs.commands.executeCommand("setContext", FLUTTER_PROJECT_LOADED, enable && workspaceContext?.hasAnyFlutterProjects);
	void vs.commands.executeCommand("setContext", WEB_PROJECT_LOADED, enable && workspaceContext?.hasAnyWebProjects);
}

/// Calls a cleanup function in a try/catch to ensure we never throw and logs any error to the logger
/// and the console.
async function tryCleanup(f: () => void | Promise<void> | Thenable<void>): Promise<void> {
	try {
		await f();
	} catch (e) {
		try {
			console.error(`Error cleaning up during extension shutdown: ${e}`);
			logger.error(`Error cleaning up during extension shutdown: ${e}`);
		} catch { }
	}
}

