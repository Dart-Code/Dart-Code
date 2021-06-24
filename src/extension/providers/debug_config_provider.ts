/* eslint-disable @typescript-eslint/tslint/config */
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { CancellationToken, DebugConfiguration, DebugConfigurationProvider, ProviderResult, Uri, window, workspace, WorkspaceFolder } from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { CHROME_OS_VM_SERVICE_PORT, debugAnywayAction, HAS_LAST_DEBUG_CONFIG, HAS_LAST_TEST_DEBUG_CONFIG, isChromeOS, showErrorsAction } from "../../shared/constants";
import { DartLaunchArgs, DartVsCodeLaunchArgs } from "../../shared/debug/interfaces";
import { DebuggerType, VmServiceExtension } from "../../shared/enums";
import { Device } from "../../shared/flutter/daemon_interfaces";
import { getFutterWebRenderer } from "../../shared/flutter/utils";
import { IFlutterDaemon, Logger } from "../../shared/interfaces";
import { TestTreeModel } from "../../shared/test/test_model";
import { filenameSafe, isWebDevice } from "../../shared/utils";
import { findProjectFolders, forceWindowsDriveLetterToUppercase, fsPath, isWithinPath } from "../../shared/utils/fs";
import { FlutterDeviceManager } from "../../shared/vscode/device_manager";
import { warnIfPathCaseMismatch } from "../../shared/vscode/utils";
import { WorkspaceContext } from "../../shared/workspace";
import { Analytics } from "../analytics";
import { DebugCommands, debugSessions, LastDebugSession, LastTestDebugSession } from "../commands/debug";
import { isLogging } from "../commands/logging";
import { config, ResourceConfig } from "../config";
import { locateBestProjectRoot } from "../project";
import { PubGlobal } from "../pub/global";
import { WebDev } from "../pub/webdev";
import { getExcludedFolders, isFlutterProjectFolder, isInsideFolderNamed, isTestFileOrFolder, isTestFolder, isValidEntryFile, projectShouldUsePubForTests as shouldUsePubForTests } from "../utils";
import { getGlobalFlutterArgs, getToolEnv } from "../utils/processes";

export class DebugConfigProvider implements DebugConfigurationProvider {
	constructor(private readonly logger: Logger, private readonly wsContext: WorkspaceContext, private readonly analytics: Analytics, private readonly pubGlobal: PubGlobal, private readonly testTreeModel: TestTreeModel, private readonly daemon: IFlutterDaemon, private readonly deviceManager: FlutterDeviceManager, private readonly debugCommands: DebugCommands, private dartCapabilities: DartCapabilities, private readonly flutterCapabilities: FlutterCapabilities) { }

	public resolveDebugConfiguration(folder: WorkspaceFolder | undefined, debugConfig: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {
		debugConfig.type = debugConfig.type || "dart";
		debugConfig.request = debugConfig.request || "launch";

		return debugConfig;
	}

	private warnOnUnresolvedVariables(property: string, input?: string): boolean {
		if (!input) return false;
		const v = this.getUnresolvedVariable(input);

		if (v) {
			this.logger.error(`Launch config property '${property}' has unresolvable variable ${v}`);
			window.showErrorMessage(`Launch config property '${property}' has unresolvable variable ${v}`);
			return true;
		}
		return false;
	}

	/** Gets the first unresolved variable from the given string. */
	private getUnresolvedVariable(input?: string): string | undefined {
		if (!input) return undefined;
		const matches = /\${\w+}/.exec(input);
		return matches ? matches[0] : undefined;
	}

	public async resolveDebugConfigurationWithSubstitutedVariables(folder: WorkspaceFolder | undefined, debugConfig: DebugConfiguration & DartLaunchArgs, token?: CancellationToken): Promise<DebugConfiguration | undefined | null> {
		const isAttachRequest = debugConfig.request === "attach";
		const logger = this.logger;
		const openFile = window.activeTextEditor && window.activeTextEditor.document && window.activeTextEditor.document.uri.scheme === "file"
			? fsPath(window.activeTextEditor.document.uri)
			: undefined;

		logger.info(`Starting debug session...`);
		if (folder)
			logger.info(`    workspace: ${fsPath(folder.uri)}`);
		if (debugConfig.program)
			logger.info(`    program  : ${debugConfig.program}`);
		if (debugConfig.cwd)
			logger.info(`    cwd      : ${debugConfig.cwd}`);

		if (this.warnOnUnresolvedVariables("program", debugConfig.program) || this.warnOnUnresolvedVariables("cwd", debugConfig.cwd)) {
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

		this.configureProgramAndCwd(debugConfig, folder, openFile);

		// If we still don't have an entry point, the user will have to provide it.
		if (!isAttachRequest && !debugConfig.program) {
			this.logger.warn("No program was set in launch config");
			const exampleEntryPoint = this.wsContext.hasAnyFlutterProjects ? "lib/main.dart" : "bin/main.dart";
			window.showInformationMessage(`Set the 'program' value in your launch config (eg '${exampleEntryPoint}') then launch again`);
			return null; // null means open launch.json.
		}

		const debugType = this.selectDebuggerType(debugConfig, logger);

		const isFlutter = debugType === DebuggerType.Flutter || debugType === DebuggerType.FlutterTest;
		const isTest = isTestFileOrFolder(debugConfig.program);
		const isIntegrationTest = debugConfig.program && isInsideFolderNamed(debugConfig.program, "integration_test");
		const argsHaveTestNameFilter = debugConfig.toolArgs ? (debugConfig.toolArgs.includes("--name") || debugConfig.toolArgs.includes("--pname")) : false;

		// Handle test_driver tests that can be pointed at an existing running instrumented app.
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
			if (!isFlutter) { // TEMP Condition because there's no point asking yet as the user doesn't know how to get this..
				debugConfig.vmServiceUri = await this.getFullVmServiceUri(debugConfig.vmServiceUri || debugConfig.observatoryUri);
			}

			if (!debugConfig.vmServiceUri && !isFlutter) {
				logger.warn("No VM service URI/port was provided");
				window.showInformationMessage("You must provide a VM service URI/port to attach a debugger");
				return undefined; // undefined means silent (don't open launch.json).
			}
		}

		if (token && token.isCancellationRequested)
			return;

		// Ensure we have a device if required.
		let deviceToLaunchOn = this.deviceManager?.getDevice(debugConfig.deviceId) || this.deviceManager?.currentDevice;
		const requiresDevice = (debugType === DebuggerType.Flutter && !isAttachRequest)
			|| (DebuggerType.FlutterTest && isIntegrationTest && this.flutterCapabilities.supportsRunningIntegrationTests);
		if (requiresDevice) {
			deviceToLaunchOn = this.deviceManager?.getDevice(debugConfig.deviceId) || this.deviceManager?.currentDevice;
			if (this.deviceManager && this.daemon && debugConfig.deviceId !== "flutter-tester") {
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
					if (deviceToLaunchOn) {
						logger.warn(`Unable to launch because ${deviceToLaunchOn.id} is not valid for this project (${deviceToLaunchOn.platformType} is not allowed according to [${supportedPlatforms.join(", ")}])`);
						window.showInformationMessage("Cannot launch without a valid device for this project");
					} else {
						logger.warn("Unable to launch due to no active device");
						window.showInformationMessage("Cannot launch without an active device");
					}
					return undefined; // undefined means silent (don't open launch.json).
				}
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
		await this.setupDebugConfig(folder, debugConfig, debugType, isFlutter, isAttachRequest, isTest, deviceToLaunchOn, this.deviceManager);

		// Debugger always uses uppercase drive letters to ensure our paths have them regardless of where they came from.
		debugConfig.program = forceWindowsDriveLetterToUppercase(debugConfig.program);
		debugConfig.cwd = forceWindowsDriveLetterToUppercase(debugConfig.cwd);

		// If we're launching (not attaching) then check there are no errors before we launch.
		if (!isAttachRequest && debugConfig.cwd && config.promptToRunIfErrors && !debugConfig.suppressPromptOnErrors) {
			if (await this.checkIfProjectHasErrors(debugConfig))
				return undefined; // undefined means silent (don't open launch.json).
		}

		if (token && token.isCancellationRequested)
			return;

		const didWarnAboutCwd = debugConfig.cwd && path.isAbsolute(debugConfig.cwd)
			? warnIfPathCaseMismatch(logger, debugConfig.cwd, "the launch script working directory", "check the 'cwd' field in your launch configuration file (.vscode/launch.json)")
			: false;
		if (!didWarnAboutCwd && debugConfig.program && path.isAbsolute(debugConfig.program))
			warnIfPathCaseMismatch(logger, debugConfig.program, "the launch script", "check the 'program' field in your launch configuration file (.vscode/launch.json)");

		this.analytics.logDebuggerStart(folder && folder.uri, DebuggerType[debugType], debugConfig.noDebug ? "Run" : "Debug");
		if (debugType === DebuggerType.FlutterTest /* || debugType === DebuggerType.WebTest */ || debugType === DebuggerType.PubTest) {
			const suitePaths = isTestFolder(debugConfig.program)
				? Object.values(this.testTreeModel.suites)
					.map((suite) => suite.path)
					.filter((p) => p.startsWith(debugConfig.program!))
				: [debugConfig.program!];
			for (const suitePath of suitePaths)
				this.testTreeModel.flagSuiteStart(suitePath, !argsHaveTestNameFilter);
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

	private async checkIfProjectHasErrors(debugConfig: vs.DebugConfiguration & DartLaunchArgs) {
		const logger = this.logger;
		logger.info("Checking for errors before launching");

		const isDartError = (d: vs.Diagnostic) => d.source === "dart" && d.severity === vs.DiagnosticSeverity.Error;
		const dartErrors = vs.languages
			.getDiagnostics()
			.filter((file) => file[1].find(isDartError));

		// Check if any are inside our CWD.
		const firstRelevantDiagnostic = dartErrors.find((fd) => {
			const file = fsPath(fd[0]);
			return isWithinPath(file, debugConfig.cwd!)
				// Ignore errors in test folder unless it's the file we're running.
				&& ((!isInsideFolderNamed(file, "test") && !isInsideFolderNamed(file, "integration_test")) || file === debugConfig.program);
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
				showErrorsAction
			);
			if (action === debugAnywayAction) {
				logger.info("Debugging anyway!");
				// Do nothing, we'll just carry on.
			} else {
				logger.info("Aborting!");
				if (action === showErrorsAction)
					vs.commands.executeCommand("workbench.action.showErrorsWarnings");
				return true;
			}
		}

		return false;
	}

	protected selectDebuggerType(debugConfig: vs.DebugConfiguration & DartLaunchArgs, logger: Logger): DebuggerType {
		const isTest = isTestFileOrFolder(debugConfig.program);
		const isIntegrationTest = debugConfig.program && isInsideFolderNamed(debugConfig.program, "integration_test");
		// TODO: Remove argsHaveTestNameFilter now that "flutter test" supports running tests on device (integration tests).
		const argsHaveTestNameFilter = debugConfig.toolArgs ? (debugConfig.toolArgs.includes("--name") || debugConfig.toolArgs.includes("--pname")) : false;

		let debugType = DebuggerType.Dart;
		if (debugConfig.cwd
			// TODO: This isInsideFolderNamed often fails when we found a better project root above.
			&& !isInsideFolderNamed(debugConfig.program, "bin")
			&& !isInsideFolderNamed(debugConfig.program, "tool")
			&& !isInsideFolderNamed(debugConfig.program, ".dart_tool")) {
			// Check if we're a Flutter or Web project.
			if (isFlutterProjectFolder(debugConfig.cwd) || this.wsContext.config.forceFlutterDebug) {
				debugType = DebuggerType.Flutter;
			} else if (isInsideFolderNamed(debugConfig.program, "web") && !isInsideFolderNamed(debugConfig.program, "test"))
				debugType = DebuggerType.Web;

			else
				logger.info(`Project (${debugConfig.program}) not recognised as Flutter or Web, will use Dart debugger`);
		}
		logger.info(`Detected launch project as ${DebuggerType[debugType]}`);

		if (isTest)
			logger.info(`Detected launch project as a Test project`);
		const canPubRunTest = isTest && debugConfig.cwd && shouldUsePubForTests(debugConfig.cwd, this.wsContext.config);
		if (isTest && !canPubRunTest)
			logger.info(`Project does not appear to support 'pub run test', will use VM directly`);
		if (isTest) {
			switch (debugType) {
				case DebuggerType.Dart:
					if (canPubRunTest)
						debugType = DebuggerType.PubTest;
					break;
				case DebuggerType.Flutter:
					if (isIntegrationTest) {
						// Integration tests always use "flutter test".
						debugType = DebuggerType.FlutterTest;
					} else if (debugConfig.runTestsOnDevice && argsHaveTestNameFilter) {
						// Non-integration tests set to run on device but have a test name filter will also have
						// to run with "flutter test".
						vs.window.showWarningMessage("Running with 'flutter test' as 'runTestsOnDevice' is not supported for individual tests.");
						logger.info(`runTestsOnDevice is set but args have test filter so will still use Flutter`);
						debugType = DebuggerType.FlutterTest;
					} else if (debugConfig.runTestsOnDevice) {
						// Anything else (eg. Non-integration tests without a test name filter) is allowed to
						// run on a device if specified.
						logger.info(`runTestsOnDevice is set, so will use Flutter instead of FlutterTest`);
					} else {
						// Otherwise, default is to use "flutter test".
						debugType = DebuggerType.FlutterTest;
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
		return debugType;
	}

	protected configureProgramAndCwd(debugConfig: DartVsCodeLaunchArgs, folder: vs.WorkspaceFolder | undefined, openFile: string | undefined) {
		const isAttachRequest = debugConfig.request === "attach";

		// Convert to an absolute paths (if possible).
		if (debugConfig.cwd && !path.isAbsolute(debugConfig.cwd) && folder) {
			debugConfig.cwd = path.join(fsPath(folder.uri), debugConfig.cwd);
			this.logger.info(`Converted cwd to absolute path: ${debugConfig.cwd}`);
		}
		if (debugConfig.program && !path.isAbsolute(debugConfig.program) && (debugConfig.cwd || folder)) {
			debugConfig.program = path.join(debugConfig.cwd || fsPath(folder!.uri), debugConfig.program);
			this.logger.info(`Converted program to absolute path: ${debugConfig.program}`);
		}

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
		}

		// If we don't have a cwd then find the best one from the project root.
		if (!debugConfig.cwd && folder) {
			debugConfig.cwd = fsPath(folder.uri);
			this.logger.info(`Using workspace as cwd: ${debugConfig.cwd}`);

			// If we have an entry point, see if we can make this more specific by finding a .packages file
			if (debugConfig.program) {
				const bestProjectRoot = locateBestProjectRoot(debugConfig.program);
				if (bestProjectRoot && isWithinPath(bestProjectRoot, fsPath(folder.uri))) {
					debugConfig.cwd = bestProjectRoot;
					this.logger.info(`Found better project root to use as cwd: ${debugConfig.cwd}`);
				}
			}
		}

		// Ensure we have a full path.
		if (debugConfig.program && debugConfig.cwd && !path.isAbsolute(debugConfig.program))
			debugConfig.program = path.join(debugConfig.cwd, debugConfig.program);

		if (debugConfig.program && path.isAbsolute(debugConfig.program) && !fs.existsSync(debugConfig.program)) {
			this.logger.warn(`Launch config references non-existant file ${debugConfig.program}`);
			window.showWarningMessage(`Your launch config references a program that does not exist. If you have problems launching, check the "program" field in your ".vscode/launch.json" file.`);
		}
	}

	private errorWithoutOpeningLaunchConfig(message: string) {
		this.logger.error(message);
		window.showErrorMessage(message);
		return undefined; // undefined means silent (don't open launch.json).
	}

	private installDependencies(debugType: DebuggerType, pubGlobal: PubGlobal) {
		return debugType === DebuggerType.Web
			? new WebDev(pubGlobal).installIfRequired()
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

	private async setupDebugConfig(folder: WorkspaceFolder | undefined, debugConfig: DartVsCodeLaunchArgs, debugType: DebuggerType, isFlutter: boolean, isAttach: boolean, isTest: boolean, device: Device | undefined, deviceManager: FlutterDeviceManager): Promise<void> {
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

		// Some properties depend ont he device, so infer that first if required.
		if (isFlutter && !debugConfig.deviceId && device) {
			debugConfig.deviceId = device.id;
			debugConfig.deviceName = `${deviceManager ? deviceManager.labelForDevice(device) : device.name} (${device.platform})`;
		}

		debugConfig.toolEnv = getToolEnv();
		debugConfig.sendLogsToClient = true;
		debugConfig.cwd = debugConfig.cwd || (folder && fsPath(folder.uri));
		debugConfig.args = debugConfig.args || [];
		debugConfig.toolArgs = await this.buildToolArgs(debugType, debugConfig, conf);
		debugConfig.vmServicePort = debugConfig.vmServicePort || (isChromeOS && config.useKnownChromeOSPorts ? CHROME_OS_VM_SERVICE_PORT : 0);
		debugConfig.dartSdkPath = this.wsContext.sdks.dart!;
		debugConfig.vmServiceLogFile = this.insertSessionName(debugConfig, debugConfig.vmServiceLogFile || conf.vmServiceLogFile);
		debugConfig.webDaemonLogFile = this.insertSessionName(debugConfig, debugConfig.webDaemonLogFile || conf.webDaemonLogFile);
		debugConfig.maxLogLineLength = debugConfig.maxLogLineLength || config.maxLogLineLength;
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

		if (!isFlutter && !isAttach && !isTest && debugConfig.console === undefined && config.cliConsole !== undefined)
			debugConfig.console = config.cliConsole;

		if (isFlutter && this.wsContext.sdks.flutter) {
			debugConfig.flutterSdkPath = this.wsContext.sdks.flutter;
			debugConfig.useInspectorNotificationsForWidgetErrors = config.showInspectorNotificationsForWidgetErrors;
			debugConfig.workspaceConfig = this.wsContext.config;
			debugConfig.flutterRunLogFile = this.insertSessionName(debugConfig, debugConfig.flutterRunLogFile || conf.flutterRunLogFile);
			debugConfig.flutterTestLogFile = this.insertSessionName(debugConfig, debugConfig.flutterTestLogFile || conf.flutterTestLogFile);
			debugConfig.showMemoryUsage =
				debugConfig.showMemoryUsage || debugConfig.showMemoryUsage === false
					? debugConfig.showMemoryUsage
					: debugConfig.flutterMode === "profile";
		}
	}

	/// Builds arguments to be passed to tools (Dart VM or Flutter tool) for a given launch config.
	///
	/// Arguments included here are usually based on convenience flags that are supported in launch.json, and are
	/// just mapped to standard arguments in an array.
	///
	/// All arguments built here should be things that user the recognises based on the app they are trying to launch
	/// or settings they have configured. It should not include things that are specifically required by the debugger
	/// (for example, enabling the VM Service or starting paused). Those items should be handled inside the Debug Adapter.
	protected async buildToolArgs(debugType: DebuggerType, debugConfig: DartLaunchArgs, conf: ResourceConfig): Promise<string[]> {
		let args: string[] = [];
		args = args.concat(debugConfig.toolArgs ?? []);

		switch (debugType) {
			case DebuggerType.Dart:
				args = args.concat(await this.buildDartToolArgs(debugConfig, conf));
				break;
			case DebuggerType.Flutter:
				args = args.concat(await this.buildFlutterToolArgs(debugConfig, conf));
				break;
			case DebuggerType.FlutterTest:
				args = args.concat(await this.buildFlutterTestToolArgs(debugConfig, conf));
				break;
		}

		return args;
	}

	protected async buildDartToolArgs(debugConfig: DartVsCodeLaunchArgs, conf: ResourceConfig): Promise<string[]> {
		const args: string[] = [];
		const isDebug = debugConfig.noDebug !== true;

		this.addArgsIfNotExist(args, ...conf.vmAdditionalArgs);

		if (isDebug && debugConfig.enableAsserts !== false) // undefined = on
			this.addArgsIfNotExist(args, "--enable-asserts");

		return args;
	}

	protected async buildFlutterToolArgs(debugConfig: DartVsCodeLaunchArgs, conf: ResourceConfig): Promise<string[]> {
		const args: string[] = [];
		const isDebug = debugConfig.noDebug !== true;
		const isAttach = debugConfig.request === "attach";
		const isWeb = isWebDevice(debugConfig.deviceId);

		this.addArgsIfNotExist(args, ...getGlobalFlutterArgs());
		this.addArgsIfNotExist(args, ...conf.flutterAdditionalArgs);
		if (isAttach)
			this.addArgsIfNotExist(args, ...conf.flutterAttachAdditionalArgs);
		else
			this.addArgsIfNotExist(args, ...conf.flutterRunAdditionalArgs);

		switch (debugConfig.flutterMode) {
			case "profile":
			case "release":
				if (!args.includes(debugConfig.flutterMode))
					args.push(`--${debugConfig.flutterMode}`);
				break;

			default: // Debug mode.
				if (debugConfig.vmServicePort && isDebug)
					this.addArgsIfNotExist(args, "--observatory-port", debugConfig.vmServicePort.toString());
				if (!conf.flutterTrackWidgetCreation && !args.includes("--no-track-widget-creation"))
					this.addArgsIfNotExist(args, "--no-track-widget-creation");
				if (conf.flutterStructuredErrors && this.flutterCapabilities.supportsDartDefine)
					this.addArgsIfNotExist(args, "--dart-define=flutter.inspector.structuredErrors=true");
		}

		if (debugConfig.deviceId)
			this.addArgsIfNotExist(args, "-d", debugConfig.deviceId);

		if (debugConfig.flutterPlatform && debugConfig.flutterPlatform !== "default")
			this.addArgsIfNotExist(args, "--target-platform", debugConfig.flutterPlatform);

		if (debugConfig.deviceId === "web-server") {
			if (this.flutterCapabilities.supportsWsVmService && !args.includes("--web-server-debug-protocol"))
				this.addArgsIfNotExist(args, "--web-server-debug-protocol", "ws");
			if (config.debugExtensionBackendProtocol && this.flutterCapabilities.supportsWsDebugBackend)
				this.addArgsIfNotExist(args, "--web-server-debug-backend-protocol", config.debugExtensionBackendProtocol);
			if (config.debugExtensionBackendProtocol && this.flutterCapabilities.supportsWsInjectedClient)
				this.addArgsIfNotExist(args, "--web-server-debug-injected-client-protocol", config.debugExtensionBackendProtocol);
		}
		if (this.flutterCapabilities.supportsExposeUrl)
			this.addArgsIfNotExist(args, "--web-allow-expose-url");

		if (isLogging && !args.includes("--verbose"))
			this.addArgsIfNotExist(args, "-v");

		if (!isAttach && isWeb) {
			const renderer = getFutterWebRenderer(this.flutterCapabilities, config.flutterWebRenderer);
			if (renderer)
				this.addArgsIfNotExist(args, "--web-renderer", renderer);
		}

		if (config.shareDevToolsWithFlutter && this.flutterCapabilities.supportsDevToolsServerAddress && !args.includes("--devtools-server-address")) {
			this.logger.info("Getting DevTools server address to pass to Flutter...");
			try {
				const devtoolsUrl = await this.debugCommands.devTools?.devtoolsUrl;
				if (devtoolsUrl)
					this.addArgsIfNotExist(args, "--devtools-server-address", devtoolsUrl.toString());
				else
					this.logger.warn("DevTools server unavailable, not sending --devtools-server-address!");
			} catch (e) {
				this.logger.error(`Failed to get DevTools server address ${e}`);
			}
		}

		return args;
	}

	protected async buildFlutterTestToolArgs(debugConfig: DartVsCodeLaunchArgs, conf: ResourceConfig): Promise<string[]> {
		const args: string[] = [];

		this.addArgsIfNotExist(args, ...getGlobalFlutterArgs());
		this.addArgsIfNotExist(args, ...conf.flutterAdditionalArgs);
		if (debugConfig.request === "attach")
			this.addArgsIfNotExist(args, ...conf.flutterTestAdditionalArgs);

		if (debugConfig.deviceId)
			this.addArgsIfNotExist(args, "-d", debugConfig.deviceId);

		return args;
	}

	protected addArgsIfNotExist(args: string[], ...toAdd: string[]) {
		if (!args.includes(toAdd[0])) {
			toAdd.forEach((s) => args.push(s));
		}
	}

	private insertSessionName(args: { name: string }, logPath: string | undefined) {
		return logPath
			? logPath.replace(/\${name}/, filenameSafe(args.name || "unnamed-session"))
			: logPath;
	}
}

export class InitialLaunchJsonDebugConfigProvider implements DebugConfigurationProvider {
	constructor(private readonly logger: Logger) { }

	public async provideDebugConfigurations(folder: WorkspaceFolder | undefined, token?: CancellationToken): Promise<DebugConfiguration[]> {
		const results: DebugConfiguration[] = [];

		const rootFolder = folder ? fsPath(folder.uri) : undefined;
		const projectFolders = rootFolder ? await findProjectFolders(this.logger, [rootFolder], getExcludedFolders(folder), { requirePubspec: true }) : [];

		if (projectFolders.length) {
			for (const projectFolder of projectFolders) {
				const isFlutter = isFlutterProjectFolder(projectFolder);
				const name = path.basename(projectFolder);
				// Compute cwd, using undefined instead of empty if rootFolder === projectFolder
				const cwd = rootFolder ? path.relative(rootFolder, projectFolder) || undefined : undefined;

				if (isFlutter) {
					results.push({
						name,
						cwd,
						request: "launch",
						type: "dart",
					});
					results.push({
						name: `${name} (profile mode)`,
						cwd,
						request: "launch",
						type: "dart",
						flutterMode: "profile",
					});
				} else {
					results.push({
						name,
						cwd,
						request: "launch",
						type: "dart",
					});
				}
			}
		} else {
			results.push({
				name: "Dart & Flutter",
				request: "launch",
				type: "dart",
			});
		}

		return results;
	}
}

export class DynamicDebugConfigProvider implements DebugConfigurationProvider {
	constructor(private readonly logger: Logger) { }

	public async provideDebugConfigurations(folder: WorkspaceFolder | undefined, token?: CancellationToken): Promise<DebugConfiguration[]> {
		const results: DebugConfiguration[] = [];

		const rootFolder = folder ? fsPath(folder.uri) : undefined;
		const projectFolders = rootFolder ? await findProjectFolders(this.logger, [rootFolder], getExcludedFolders(folder), { requirePubspec: true }) : [];
		for (const projectFolder of projectFolders) {
			const isFlutter = isFlutterProjectFolder(projectFolder);
			const name = path.basename(projectFolder);
			// Compute cwd, using undefined instead of empty if rootFolder === projectFolder
			const cwd = rootFolder ? path.relative(rootFolder, projectFolder) || undefined : undefined;
			const exists = (p: string) => folder && fs.existsSync(path.join(projectFolder, p));

			if (isFlutter && exists("lib/main.dart")) {
				results.push({
					name: `Flutter`,
					program: "lib/main.dart",
					cwd,
					request: "launch",
					type: "dart",
				});
				results.push({
					name: `Flutter (profile mode)`,
					program: "lib/main.dart",
					cwd,
					request: "launch",
					type: "dart",
					flutterMode: "profile",
				});
			}
			if (!isFlutter && exists("web")) {
				results.push({
					name: `Dart Web`,
					program: "web",
					cwd,
					request: "launch",
					type: "dart",
				});
			}
			if (exists("bin/main.dart")) {
				results.push({
					name: `Dart`,
					program: "bin/main.dart",
					cwd,
					request: "launch",
					type: "dart",
				});
			}
			if (exists("test")) {
				results.push({
					name: `${isFlutter ? "Flutter" : "Dart"} Tests`,
					program: "test",
					cwd,
					request: "launch",
					type: "dart",
				});
			}
			if (isFlutter && exists("integration_test")) {
				results.push({
					name: `${isFlutter ? "Flutter" : "Dart"} Integration Tests`,
					program: "integration_test",
					cwd,
					request: "launch",
					type: "dart",
				});
			}
		}
		return results;
	}
}
