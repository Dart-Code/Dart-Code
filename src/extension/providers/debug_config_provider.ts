import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import * as vs from "vscode";
import { CancellationToken, DebugConfiguration, DebugConfigurationProvider, ProviderResult, Uri, window, workspace, WorkspaceFolder } from "vscode";
import { DebugSession } from "vscode-debugadapter";
import { DartDebugSession } from "../../debug/dart_debug_impl";
import { DartTestDebugSession } from "../../debug/dart_test_debug_impl";
import { FlutterDebugSession } from "../../debug/flutter_debug_impl";
import { FlutterTestDebugSession } from "../../debug/flutter_test_debug_impl";
import { FlutterLaunchRequestArguments } from "../../debug/utils";
import { WebDebugSession } from "../../debug/web_debug_impl";
import { WebTestDebugSession } from "../../debug/web_test_debug_impl";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { CHROME_OS_VM_SERVICE_PORT, dartVMPath, debugAnywayAction, flutterPath, HAS_LAST_DEBUG_CONFIG, HAS_LAST_TEST_DEBUG_CONFIG, isChromeOS, pubPath, pubSnapshotPath, showErrorsAction } from "../../shared/constants";
import { DebuggerType, VmServiceExtension } from "../../shared/enums";
import { Device } from "../../shared/flutter/daemon_interfaces";
import { IFlutterDaemon, Logger } from "../../shared/interfaces";
import { filenameSafe } from "../../shared/utils";
import { forceWindowsDriveLetterToUppercase, fsPath, isWithinPath } from "../../shared/utils/fs";
import { FlutterDeviceManager } from "../../shared/vscode/device_manager";
import { warnIfPathCaseMismatch } from "../../shared/vscode/utils";
import { WorkspaceContext } from "../../shared/workspace";
import { Analytics } from "../analytics";
import { debugSessions, LastDebugSession, LastTestDebugSession } from "../commands/debug";
import { isLogging } from "../commands/logging";
import { config } from "../config";
import { locateBestProjectRoot } from "../project";
import { PubGlobal } from "../pub/global";
import { WebDev } from "../pub/webdev";
import { isFlutterProjectFolder, isFlutterWorkspaceFolder, isInsideFolderNamed, isTestFileOrFolder, isTestFolder, isValidEntryFile, projectShouldUsePubForTests as shouldUsePubForTests } from "../utils";
import { getGlobalFlutterArgs, getToolEnv } from "../utils/processes";
import { TestResultsProvider } from "../views/test_view";

const isCI = !!process.env.CI;

export class DebugConfigProvider implements DebugConfigurationProvider {
	private debugServers: { [index: string]: net.Server } = {};

	constructor(private readonly logger: Logger, private readonly wsContext: WorkspaceContext, private readonly analytics: Analytics, private readonly pubGlobal: PubGlobal, private readonly daemon: IFlutterDaemon, private readonly deviceManager: FlutterDeviceManager, private dartCapabilities: DartCapabilities, private readonly flutterCapabilities: FlutterCapabilities) { }

	public resolveDebugConfiguration(folder: WorkspaceFolder | undefined, debugConfig: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {
		debugConfig.type = debugConfig.type || "dart";
		debugConfig.request = debugConfig.request || "launch";

		return debugConfig;
	}

	public async resolveDebugConfigurationWithSubstitutedVariables(folder: WorkspaceFolder | undefined, debugConfig: DebugConfiguration, token?: CancellationToken): Promise<DebugConfiguration | undefined | null> {
		const logger = this.logger;
		const openFile = window.activeTextEditor && window.activeTextEditor.document && window.activeTextEditor.document.uri.scheme === "file"
			? fsPath(window.activeTextEditor.document.uri)
			: undefined;

		/** Gets the first unresolved variable from the given string. */
		function getUnresolvedVariable(input?: string): string | undefined {
			if (!input) return undefined;
			const matches = /\${\w+}/.exec(input);
			return matches ? matches[0] : undefined;
		}

		function warnOnUnresolvedVariables(property: string, input?: string): boolean {
			if (!input) return false;
			const v = getUnresolvedVariable(input);

			if (v) {
				logger.error(`Launch config property '${property}' has unresolvable variable ${v}`);
				window.showErrorMessage(`Launch config property '${property}' has unresolvable variable ${v}`);
				return true;
			}
			return false;
		}

		logger.info(`Starting debug session...`);
		if (folder)
			logger.info(`    workspace: ${fsPath(folder.uri)}`);
		if (debugConfig.program)
			logger.info(`    program  : ${debugConfig.program}`);
		if (debugConfig.cwd)
			logger.info(`    cwd      : ${debugConfig.cwd}`);

		if (warnOnUnresolvedVariables("program", debugConfig.program) || warnOnUnresolvedVariables("cwd", debugConfig.cwd)) {
			// Warning is shown from inside warnOnUnresolvedVariables.
			return null; // null means open launch.json.
		}

		if (openFile && !folder) {
			folder = workspace.getWorkspaceFolder(Uri.file(openFile));
			if (folder)
				logger.info(`Setting workspace based on open file: ${fsPath(folder.uri)}`);
		} else if (!folder && vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length === 1) {
			folder = vs.workspace.workspaceFolders[0];
			if (folder)
				logger.info(`Setting workspace based on single open workspace: ${fsPath(folder.uri)}`);
		}

		// Convert to an absolute paths (if possible).
		if (debugConfig.cwd && !path.isAbsolute(debugConfig.cwd) && folder) {
			debugConfig.cwd = path.join(fsPath(folder.uri), debugConfig.cwd);
			logger.info(`Converted cwd to absolute path: ${debugConfig.cwd}`);
		}
		if (debugConfig.program && !path.isAbsolute(debugConfig.program) && (debugConfig.cwd || folder)) {
			debugConfig.program = path.join(debugConfig.cwd || fsPath(folder!.uri), debugConfig.program);
			logger.info(`Converted program to absolute path: ${debugConfig.program}`);
		}

		const isAttachRequest = debugConfig.request === "attach";
		if (!isAttachRequest) {
			// If there's no program set, try to guess one.
			if (!debugConfig.program) {
				const preferredFolder = debugConfig.cwd
					? debugConfig.cwd
					: folder
						? fsPath(folder.uri)
						: undefined;

				// If we have a folder specified, we should only consider open files if it's inside it.
				const preferredFile = !preferredFolder || (!!openFile && isWithinPath(openFile, preferredFolder)) ? openFile : undefined;
				debugConfig.program = debugConfig.program || this.guessBestEntryPoint(preferredFile, preferredFolder);
			}

			// If we still don't have an entry point, the user will have to provide it.
			if (!debugConfig.program) {
				logger.warn("No program was set in launch config");
				const exampleEntryPoint = this.wsContext.hasAnyFlutterProjects ? "lib/main.dart" : "bin/main.dart";
				window.showInformationMessage(`Set the 'program' value in your launch config (eg '${exampleEntryPoint}') then launch again`);
				return null; // null means open launch.json.
			}
		}

		// If we don't have a cwd then find the best one from the project root.
		if (!debugConfig.cwd && folder) {
			debugConfig.cwd = fsPath(folder.uri);
			logger.info(`Using workspace as cwd: ${debugConfig.cwd}`);

			// If we have an entry point, see if we can make this more specific by finding a .packages file
			if (debugConfig.program) {
				const bestProjectRoot = locateBestProjectRoot(debugConfig.program);
				if (bestProjectRoot && isWithinPath(bestProjectRoot, fsPath(folder.uri))) {
					debugConfig.cwd = bestProjectRoot;
					logger.info(`Found better project root to use as cwd: ${debugConfig.cwd}`);
				}
			}
		}

		// Ensure we have a full path.
		if (debugConfig.program && debugConfig.cwd && !path.isAbsolute(debugConfig.program))
			debugConfig.program = path.join(debugConfig.cwd, debugConfig.program);

		if (debugConfig.program && path.isAbsolute(debugConfig.program) && !fs.existsSync(debugConfig.program)) {
			logger.warn(`Launch config references non-existant file ${debugConfig.program}`);
			window.showWarningMessage(`Your launch config references a program that does not exist. If you have problems launching, check the "program" field in your ".vscode/launch.json" file.`);
		}

		let debugType = DebuggerType.Dart;
		if (debugConfig.cwd
			// TODO: This isInsideFolderNamed often fails when we found a better project root above.
			&& !isInsideFolderNamed(debugConfig.program, "bin")
			&& !isInsideFolderNamed(debugConfig.program, "tool")
			&& !isInsideFolderNamed(debugConfig.program, ".dart_tool")) {
			// Check if we're a Flutter or Web project.
			if (isInsideFolderNamed(debugConfig.program, "web") && !isInsideFolderNamed(debugConfig.program, "test")) {
				debugType = DebuggerType.Web;
			} else if (isFlutterProjectFolder(debugConfig.cwd as string))
				debugType = DebuggerType.Flutter;
			else
				logger.info(`Project (${debugConfig.program}) not recognised as Flutter or Web, will use Dart debugger`);
		}
		logger.info(`Detected launch project as ${DebuggerType[debugType]}`);

		// Some helpers for conditions below.
		const isAnyFlutter = debugType === DebuggerType.Flutter || debugType === DebuggerType.Web;
		const isStandardFlutter = debugType === DebuggerType.Flutter;
		const isTest = debugConfig.program && isTestFileOrFolder(debugConfig.program as string);
		const argsHaveTestNameFilter = isTest && debugConfig.args && (debugConfig.args.indexOf("--name") !== -1 || debugConfig.args.indexOf("--pname") !== -1);

		if (isTest)
			logger.info(`Detected launch project as a Test project`);
		const canPubRunTest = isTest && debugConfig.cwd && shouldUsePubForTests(debugConfig.cwd as string, this.wsContext.config);
		if (isTest && !canPubRunTest)
			logger.info(`Project does not appear to support 'pub run test', will use VM directly`);
		if (isTest) {
			switch (debugType) {
				case DebuggerType.Dart:
					if (canPubRunTest)
						debugType = DebuggerType.PubTest;
					break;
				case DebuggerType.Flutter:
					if (!debugConfig.runTestsOnDevice || argsHaveTestNameFilter) {
						if (debugConfig.runTestsOnDevice && argsHaveTestNameFilter) {
							vs.window.showWarningMessage("Running with 'flutter test' as 'runTestsOnDevice' is not supported for individual tests.");
							logger.info(`runTestsOnDevice is set but args have test filter so will still use Flutter`);
						}
						debugType = DebuggerType.FlutterTest;
					} else {
						logger.info(`runTestsOnDevice is set, so will use Flutter instead of FlutterTest`);
					}
					break;
				case DebuggerType.Web:
					debugType = DebuggerType.WebTest;
					break;
				default:
					logger.info("Unknown debugType, unable to switch to test debugger");
			}
		}
		logger.info(`Using ${DebuggerType[debugType]} debug adapter for this session`);

		if (debugType === DebuggerType.FlutterTest && isInsideFolderNamed(debugConfig.program, "test_driver") && !debugConfig.env?.VM_SERVICE_URL) {
			const runningInstrumentedApps = debugSessions.filter((s) => s.loadedServiceExtensions.indexOf(VmServiceExtension.Driver) !== -1);
			if (runningInstrumentedApps.length === 0) {
				return this.errorWithoutOpeningLaunchConfig("Could not find a running Flutter app that was instrumented with enableFlutterDriverExtension. Run your instrumented app before running driver tests.");
			} else if (runningInstrumentedApps.length > 1) {
				return this.errorWithoutOpeningLaunchConfig("More than one Flutter app instrumented with enableFlutterDriverExtension is running. Please run only one app before running driver tests.");
			} else {
				const app = runningInstrumentedApps[0];
				// This shouldn't really be possible as we wouldn't find an instrumented app without having its VM Service connection.
				if (!app.vmServiceUri)
					return this.errorWithoutOpeningLaunchConfig("The Flutter app instrumented with enableFlutterDriverExtension is not fully initialised yet.");

				// Restart the app for clean state before the test run.
				await app.session.customRequest("hotRestart");
				debugConfig.env = debugConfig.env || {};
				debugConfig.env.VM_SERVICE_URL = app.vmServiceUri;
			}
		}

		if (debugType === DebuggerType.WebTest) {
			// TODO: IMPORTANT! When removing this if statement, add WebTest to
			// the call to TestResultsProvider.flagSuiteStart below!
			logger.error("Tests in web projects are not currently supported");
			window.showErrorMessage("Tests in web projects are not currently supported");
			return undefined; // undefined means silent (don't open launch.json).
		}

		if (debugType === DebuggerType.FlutterTest && isTestFolder(debugConfig.program) && !debugConfig.noDebug) {
			// When running `flutter test (folder)`, multiple debug sessions are created - one for each file. This is
			// different to how `pub run test (folder)` works (one debug session, which each file in an isolate). The
			// debugger does not currently support multiple VM service sessions so we have to downgrade this to noDebug.
			logger.warn("Setting noDebug=true for Flutter test run because it's a folder");
			debugConfig.noDebug = true;
		}

		// If we're attaching to Dart, ensure we get a VM service URI.
		if (isAttachRequest && !debugConfig.serviceInfoFile) {
			// For attaching, the VM service address must be specified. If it's not provided already, prompt for it.
			if (!isStandardFlutter) { // TEMP Condition because there's no point asking yet as the user doesn't know how to get this..
				debugConfig.vmServiceUri = await this.getFullVmServiceUri(debugConfig.vmServiceUri || debugConfig.observatoryUri);
			}

			if (!debugConfig.vmServiceUri && !isStandardFlutter) {
				logger.warn("No VM service URI/port was provided");
				window.showInformationMessage("You must provide a VM service URI/port to attach a debugger");
				return undefined; // undefined means silent (don't open launch.json).
			}
		}

		if (token && token.isCancellationRequested)
			return;

		let deviceToLaunchOn = this.deviceManager?.getDevice(debugConfig.deviceId) || this.deviceManager?.currentDevice;

		// Ensure we have a device if required.
		if (debugType === DebuggerType.Flutter && this.deviceManager && this.daemon && debugConfig.deviceId !== "flutter-tester") {
			let supportedPlatforms = this.daemon.capabilities.providesPlatformTypes && debugConfig.cwd
				? (await this.daemon.getSupportedPlatforms(debugConfig.cwd)).platforms
				: [];

			// If the current device is not valid, prompt the user.
			if (!this.deviceManager.isSupported(supportedPlatforms, deviceToLaunchOn))
				deviceToLaunchOn = await this.deviceManager.showDevicePicker(supportedPlatforms);

			// Refresh the supported platforms, as the we may have enabled new platforms during
			// the call to showDevicePicker.
			supportedPlatforms = this.daemon.capabilities.providesPlatformTypes && debugConfig.cwd
				? (await this.daemon.getSupportedPlatforms(debugConfig.cwd)).platforms
				: [];

			// If we still don't have a valid device, show an error.
			if (!this.deviceManager.isSupported(supportedPlatforms, deviceToLaunchOn)) {
				logger.warn("Unable to launch due to no active device");
				window.showInformationMessage("Cannot launch without an active device");
				return undefined; // undefined means silent (don't open launch.json).
			}
		}

		if (token && token.isCancellationRequested)
			return;

		// Ensure we have any require dependencies.
		if (!(await this.installDependencies(debugType, this.pubGlobal))) {
			return undefined;
		}

		if (token && token.isCancellationRequested)
			return;

		// TODO: This cast feels nasty?
		this.setupDebugConfig(folder, debugConfig as any as FlutterLaunchRequestArguments, isAnyFlutter, deviceToLaunchOn, this.deviceManager);

		// Debugger always uses uppercase drive letters to ensure our paths have them regardless of where they came from.
		debugConfig.program = forceWindowsDriveLetterToUppercase(debugConfig.program);
		debugConfig.cwd = forceWindowsDriveLetterToUppercase(debugConfig.cwd);

		// If we're launching (not attaching) then check there are no errors before we launch.
		if (!isAttachRequest && debugConfig.cwd && config.promptToRunIfErrors) {
			logger.info("Checking for errors before launching");
			const isDartError = (d: vs.Diagnostic) => d.source === "dart" && d.severity === vs.DiagnosticSeverity.Error;
			const dartErrors = vs.languages
				.getDiagnostics()
				.filter((file) => file[1].find(isDartError));
			// Check if any are inside our CWD.
			const firstRelevantDiagnostic = dartErrors.find((fd) => {
				const file = fsPath(fd[0]);
				return isWithinPath(file, debugConfig.cwd)
					// Ignore errors in test folder unless it's the file we're running.
					&& (!isInsideFolderNamed(file, "test") || file === debugConfig.program);
			});
			if (firstRelevantDiagnostic) {
				logger.warn("Project has errors, prompting user");
				const firstRelevantError = firstRelevantDiagnostic[1].find(isDartError)!;
				const range = firstRelevantError.range;
				logger.warn(`    ${fsPath(firstRelevantDiagnostic[0])}:${range.start.line}:${range.start.character}`);
				logger.warn(`    ${firstRelevantError.message.split("\n")[0].trim()}`);
				const action = await window.showErrorMessage(
					"Build errors exist in your project.",
					{ modal: true },
					debugAnywayAction,
					showErrorsAction,
				);
				if (action === debugAnywayAction) {
					logger.info("Debugging anyway!");
					// Do nothing, we'll just carry on.
				} else {
					logger.info("Aborting!");
					if (action === showErrorsAction)
						vs.commands.executeCommand("workbench.action.showErrorsWarnings");
					return undefined; // undefined means silent (don't open launch.json).
				}
			}
		}

		if (token && token.isCancellationRequested)
			return;

		const didWarnAboutCwd = debugConfig.cwd && path.isAbsolute(debugConfig.cwd)
			? warnIfPathCaseMismatch(logger, debugConfig.cwd, "the launch script working directory", "check the 'cwd' field in your launch configuration file (.vscode/launch.json)")
			: false;
		if (!didWarnAboutCwd && debugConfig.program && path.isAbsolute(debugConfig.program))
			warnIfPathCaseMismatch(logger, debugConfig.program, "the launch script", "check the 'program' field in your launch configuration file (.vscode/launch.json)");

		// Start port listener on launch of first debug session.
		const debugServer = this.getDebugServer(debugType, debugConfig.debugServer);
		const serverAddress = debugServer.address();

		// Updated node bindings say address can be a string (used for pipes) but
		// this should never be the case here. This check is to keep the types happy.
		if (!serverAddress || typeof serverAddress === "string") {
			logger.info("Debug server does not have a valid address");
			window.showErrorMessage("Debug server does not have a valid address");
			return undefined;
		}

		// Make VS Code connect to debug server instead of launching debug adapter.
		// TODO: Why do we need this cast? The node-mock-debug does not?
		(debugConfig as any).debugServer = serverAddress.port;

		this.analytics.logDebuggerStart(folder && folder.uri, DebuggerType[debugType], debugConfig.noDebug ? "Run" : "Debug");
		if (debugType === DebuggerType.FlutterTest /*|| debugType === DebuggerType.WebTest*/ || debugType === DebuggerType.PubTest) {
			TestResultsProvider.flagSuiteStart(debugConfig.program, !argsHaveTestNameFilter);
		}

		debugConfig.debuggerType = debugType;

		logger.info(`Debug session starting...\n    ${JSON.stringify(debugConfig, undefined, 4).replace(/\n/g, "\n    ")}`);

		// Stash the config to support the "rerun last debug session" command.
		LastDebugSession.workspaceFolder = folder;
		LastDebugSession.debugConfig = Object.assign({}, debugConfig);
		vs.commands.executeCommand("setContext", HAS_LAST_DEBUG_CONFIG, true);

		// Stash the config to support the "rerun last test(s)" command.
		if (isTest) {
			LastTestDebugSession.workspaceFolder = folder;
			LastTestDebugSession.debugConfig = Object.assign({}, debugConfig);
			vs.commands.executeCommand("setContext", HAS_LAST_TEST_DEBUG_CONFIG, true);
		}

		return debugConfig;
	}

	private errorWithoutOpeningLaunchConfig(message: string) {
		this.logger.error(message);
		window.showErrorMessage(message);
		return undefined; // undefined means silent (don't open launch.json).
	}

	private installDependencies(debugType: DebuggerType, pubGlobal: PubGlobal) {
		return debugType === DebuggerType.Web
			? new WebDev(pubGlobal).promptToInstallIfRequired()
			: true;
	}

	private guessBestEntryPoint(openFile: string | undefined, folder: string | undefined): string | undefined {
		// For certain open files, assume the user wants to run them.
		if (isValidEntryFile(openFile)) {
			this.logger.info(`Using open file as entry point: ${openFile}`);
			return openFile;
		}

		// Use the open file as a clue to find the best project root, then search from there.
		const projectRoot = (openFile && locateBestProjectRoot(openFile)) || folder;
		if (!projectRoot)
			return;

		const commonLaunchPaths = [
			path.join(projectRoot, "lib", "main.dart"),
			path.join(projectRoot, "bin", "main.dart"),
		];
		for (const launchPath of commonLaunchPaths) {
			if (fs.existsSync(launchPath)) {
				this.logger.info(`Using found common entry point: ${launchPath}`);
				return launchPath;
			}
		}

		// If we don't have a bin folder, or a lib/main.dart, or a web folder, then
		// see if we have an example and try that.
		if (!fs.existsSync(path.join(projectRoot, "bin"))
			&& !fs.existsSync(path.join(projectRoot, "web"))
			&& fs.existsSync(path.join(projectRoot, "example")))
			return this.guessBestEntryPoint(undefined, path.join(projectRoot, "example"));
	}

	private async getFullVmServiceUri(vmServiceUriOrPort: string | undefined): Promise<string | undefined> {
		vmServiceUriOrPort = vmServiceUriOrPort || await vs.commands.executeCommand("dart.promptForVmService");
		vmServiceUriOrPort = vmServiceUriOrPort && vmServiceUriOrPort.trim();

		// If the input is just a number, treat is as a localhost port.
		if (vmServiceUriOrPort && /^[0-9]+$/.exec(vmServiceUriOrPort)) {
			vmServiceUriOrPort = `http://127.0.0.1:${vmServiceUriOrPort}`;
		}

		return vmServiceUriOrPort;
	}

	private getDebugServer(debugType: DebuggerType, port?: number) {
		switch (debugType) {
			case DebuggerType.Flutter:
				return this.spawnOrGetServer("flutter", port, () => new FlutterDebugSession());
			case DebuggerType.FlutterTest:
				return this.spawnOrGetServer("flutterTest", port, () => new FlutterTestDebugSession());
			case DebuggerType.Web:
				return this.spawnOrGetServer("web", port, () => new WebDebugSession());
			case DebuggerType.WebTest:
				return this.spawnOrGetServer("pubTest", port, () => new WebTestDebugSession());
			case DebuggerType.Dart:
				return this.spawnOrGetServer("dart", port, () => new DartDebugSession());
			case DebuggerType.PubTest:
				return this.spawnOrGetServer("pubTest", port, () => new DartTestDebugSession());
			default:
				throw new Error("Unknown debugger type");
		}
	}

	private spawnOrGetServer(type: string, port: number = 0, create: () => DebugSession): net.Server {
		// Start port listener on launch of first debug session.
		if (!this.debugServers[type]) {
			this.logger.info(`Spawning a new ${type} debugger`);
			// Start listening on a random port.
			this.debugServers[type] = net.createServer((socket) => {
				const session = create();
				session.setRunAsServer(true);
				session.start(socket as NodeJS.ReadableStream, socket);
			}).listen(port);
		}

		return this.debugServers[type];
	}

	private setupDebugConfig(folder: WorkspaceFolder | undefined, debugConfig: FlutterLaunchRequestArguments, isFlutter: boolean, device: Device | undefined, deviceManager: FlutterDeviceManager) {
		const conf = config.for(folder && folder.uri);

		// Attach any properties that weren't explicitly set.
		if (!debugConfig.name) {
			if (isFlutter && debugConfig.deviceId) {
				debugConfig.name = `Flutter (${debugConfig.deviceId})`;
			} else if (isFlutter && device) {
				debugConfig.name = `Flutter (${deviceManager ? deviceManager.labelForDevice(device) : device.name})`;
			} else if (isFlutter) {
				debugConfig.name = "Flutter";
			} else {
				debugConfig.name = "Dart";
			}
		}
		debugConfig.dartVersion = this.dartCapabilities.version;
		debugConfig.toolEnv = getToolEnv();
		debugConfig.sendLogsToClient = true;
		debugConfig.cwd = debugConfig.cwd || (folder && fsPath(folder.uri));
		debugConfig.args = debugConfig.args || [];
		debugConfig.vmAdditionalArgs = debugConfig.vmAdditionalArgs || conf.vmAdditionalArgs;
		debugConfig.vmServicePort = debugConfig.vmServicePort || (isChromeOS && config.useKnownChromeOSPorts ? CHROME_OS_VM_SERVICE_PORT : 0);
		debugConfig.dartPath = debugConfig.dartPath || path.join(this.wsContext.sdks.dart!, dartVMPath);
		debugConfig.vmServiceLogFile = this.insertSessionName(debugConfig, debugConfig.vmServiceLogFile || conf.vmServiceLogFile);
		debugConfig.webDaemonLogFile = this.insertSessionName(debugConfig, debugConfig.webDaemonLogFile || conf.webDaemonLogFile);
		debugConfig.maxLogLineLength = debugConfig.maxLogLineLength || config.maxLogLineLength;
		debugConfig.pubPath = debugConfig.pubPath || path.join(this.wsContext.sdks.dart!, pubPath);
		debugConfig.pubSnapshotPath = debugConfig.pubSnapshotPath || path.join(this.wsContext.sdks.dart!, pubSnapshotPath);
		debugConfig.pubTestLogFile = this.insertSessionName(debugConfig, debugConfig.pubTestLogFile || conf.pubTestLogFile);
		debugConfig.debugSdkLibraries = debugConfig.debugSdkLibraries !== undefined && debugConfig.debugSdkLibraries !== null
			? debugConfig.debugSdkLibraries
			: !!config.debugSdkLibraries;
		debugConfig.debugExternalLibraries = debugConfig.debugExternalLibraries !== undefined && debugConfig.debugExternalLibraries !== null
			? debugConfig.debugExternalLibraries
			: config.debugExternalLibraries;
		debugConfig.showDartDeveloperLogs = conf.showDartDeveloperLogs;
		debugConfig.evaluateGettersInDebugViews = debugConfig.evaluateGettersInDebugViews || conf.evaluateGettersInDebugViews;
		debugConfig.evaluateToStringInDebugViews = debugConfig.evaluateToStringInDebugViews || config.evaluateToStringInDebugViews;
		if (isFlutter && this.wsContext.sdks.flutter) {
			debugConfig.globalFlutterArgs = getGlobalFlutterArgs();
			debugConfig.useFlutterStructuredErrors = conf.flutterStructuredErrors;
			debugConfig.debugExtensionBackendProtocol = config.debugExtensionBackendProtocol;
			debugConfig.flutterVersion = this.flutterCapabilities.version;
			debugConfig.args = conf.flutterAdditionalArgs.concat(debugConfig.args);
			debugConfig.forceFlutterVerboseMode = isLogging;
			debugConfig.flutterTrackWidgetCreation =
				// Use from the launch.json if configured.
				debugConfig.flutterTrackWidgetCreation !== undefined && debugConfig.flutterTrackWidgetCreation !== null
					? debugConfig.flutterTrackWidgetCreation :
					// Otherwise use the config.
					conf.flutterTrackWidgetCreation;
			debugConfig.flutterMode = debugConfig.flutterMode || "debug";
			debugConfig.flutterPlatform = debugConfig.flutterPlatform || "default";
			debugConfig.flutterPath = debugConfig.flutterPath || path.join(this.wsContext.sdks.flutter, flutterPath);
			debugConfig.workspaceConfig = this.wsContext.config;
			debugConfig.flutterRunLogFile = this.insertSessionName(debugConfig, debugConfig.flutterRunLogFile || conf.flutterRunLogFile);
			debugConfig.flutterTestLogFile = this.insertSessionName(debugConfig, debugConfig.flutterTestLogFile || conf.flutterTestLogFile);
			if (!debugConfig.deviceId && device) {
				debugConfig.deviceId = device.id;
				debugConfig.deviceName = `${deviceManager ? deviceManager.labelForDevice(device) : device.name} (${device.platform})`;
			}
			debugConfig.showMemoryUsage =
				debugConfig.showMemoryUsage || debugConfig.showMemoryUsage === false
					? debugConfig.showMemoryUsage
					: debugConfig.flutterMode === "profile";
		}
	}

	private insertSessionName(args: { name: string }, logPath: string | undefined) {
		return logPath
			? logPath.replace(/\${name}/, filenameSafe(args.name || "unnamed-session"))
			: logPath;
	}

	public dispose() {
		if (this.debugServers) {
			for (const type of Object.keys(this.debugServers)) {
				this.debugServers[type].close();
				delete this.debugServers[type];
			}
		}
	}
}

export class InitialLaunchJsonDebugConfigProvider implements DebugConfigurationProvider {
	public provideDebugConfigurations(folder: WorkspaceFolder | undefined, token?: CancellationToken): ProviderResult<DebugConfiguration[]> {
		const isFlutter = isFlutterWorkspaceFolder(folder);
		return [{
			name: isFlutter ? "Flutter" : "Dart",
			program: isFlutter ? "lib/main.dart" : "bin/main.dart",
			request: "launch",
			type: "dart",
		}];
	}
}

export class DynamicDebugConfigProvider implements DebugConfigurationProvider {
	public provideDebugConfigurations(folder: WorkspaceFolder | undefined, token?: CancellationToken): ProviderResult<DebugConfiguration[]> {
		const isFlutter = isFlutterWorkspaceFolder(folder);
		const exists = (p: string) => folder && fs.existsSync(path.join(fsPath(folder.uri), p));
		const results: DebugConfiguration[] = [];

		if (isFlutter && exists("lib/main.dart")) {
			results.push({
				name: "Flutter app",
				program: "lib/main.dart",
				request: "launch",
				type: "dart",
			});
		}
		if (!isFlutter && exists("web")) {
			results.push({
				name: `Dart web app`,
				program: "web",
				request: "launch",
				type: "dart",
			});
		}
		if (exists("bin/main.dart")) {
			results.push({
				name: "Dart app",
				program: "bin/main.dart",
				request: "launch",
				type: "dart",
			});
		}
		if (exists("test")) {
			const name = isFlutter ? "Flutter" : "Dart";
			results.push({
				name: `${name} tests`,
				program: "test",
				request: "launch",
				type: "dart",
			});
		}
		return results;
	}
}
