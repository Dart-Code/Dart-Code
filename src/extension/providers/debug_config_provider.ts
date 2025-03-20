/* eslint-disable @typescript-eslint/tslint/config */
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { CancellationToken, DebugConfiguration, DebugConfigurationProvider, ProviderResult, Uri, window, workspace, WorkspaceFolder } from "vscode";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { isDartCodeTestRun, runAnywayAction, showErrorsAction } from "../../shared/constants";
import { HAS_LAST_DEBUG_CONFIG, HAS_LAST_TEST_DEBUG_CONFIG } from "../../shared/constants.contexts";
import { DartLaunchArgs, DartVsCodeLaunchArgs } from "../../shared/debug/interfaces";
import { DebuggerType, VmServiceExtension } from "../../shared/enums";
import { Device } from "../../shared/flutter/daemon_interfaces";
import { getFutterWebRenderer } from "../../shared/flutter/utils";
import { DartWorkspaceContext, IFlutterDaemon, Logger } from "../../shared/interfaces";
import { TestModel } from "../../shared/test/test_model";
import { getPackageTestCapabilities } from "../../shared/test/version";
import { isWebDevice, notNullOrUndefined } from "../../shared/utils";
import { findCommonAncestorFolder, forceWindowsDriveLetterToUppercase, fsPath, isFlutterProjectFolder, isWithinPath } from "../../shared/utils/fs";
import { getProgramPath } from "../../shared/utils/test";
import { FlutterDeviceManager } from "../../shared/vscode/device_manager";
import { envUtils, getAllProjectFolders, isRunningLocally, warnIfPathCaseMismatch } from "../../shared/vscode/utils";
import { debugSessions, LastDebugSession, LastTestDebugSession } from "../commands/debug";
import { isLogging } from "../commands/logging";
import { config, ResourceConfig } from "../config";
import { getActiveRealFileEditor } from "../editors";
import { locateBestProjectRoot } from "../project";
import { PubGlobal } from "../pub/global";
import { WebDev } from "../pub/webdev";
import { DevToolsManager } from "../sdk/dev_tools/manager";
import { ensureDebugLaunchUniqueId, getExcludedFolders, hasTestFilter, insertSessionName, isInsideFolderNamed, isTestFileOrFolder, isTestFolder, isValidEntryFile, projectCanUsePackageTest } from "../utils";
import { getGlobalFlutterArgs, getToolEnv } from "../utils/processes";

export class DebugConfigProvider implements DebugConfigurationProvider {
	constructor(private readonly logger: Logger, private readonly wsContext: DartWorkspaceContext, private readonly pubGlobal: PubGlobal, private readonly testModel: TestModel, private readonly daemon: IFlutterDaemon | undefined, private readonly deviceManager: FlutterDeviceManager | undefined, private readonly devTools: DevToolsManager, private readonly flutterCapabilities: FlutterCapabilities) { }

	public resolveDebugConfiguration(folder: WorkspaceFolder | undefined, debugConfig: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {
		ensureDebugLaunchUniqueId(debugConfig);
		debugConfig.type = debugConfig.type || "dart";
		debugConfig.request = debugConfig.request || "launch";

		return debugConfig;
	}

	private warnOnUnresolvedVariables(property: string, input?: string): boolean {
		if (!input) return false;
		const v = this.getUnresolvedVariable(input);

		if (v) {
			this.logger.error(`Launch config property '${property}' has unresolvable variable ${v}`);
			void window.showErrorMessage(`Launch config property '${property}' has unresolvable variable ${v}`);
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
		ensureDebugLaunchUniqueId(debugConfig);
		const isAttachRequest = debugConfig.request === "attach";
		const logger = this.logger;
		const editor = getActiveRealFileEditor();
		const openFile = editor
			? fsPath(editor.document.uri)
			: undefined;

		logger.info(`Starting debug session...`);
		if (folder)
			logger.info(`    workspace: ${fsPath(folder.uri)}`);
		if (debugConfig.program)
			logger.info(`    program  : ${debugConfig.program}`);
		if (debugConfig.cwd)
			logger.info(`    cwd      : ${debugConfig.cwd}`);

		// Split off any querystring from program because there's a lot of path
		// manipulation that may not handle it. We'll put it back on at the end.
		debugConfig.programQuery = debugConfig.program?.includes("?") ? "?" + debugConfig.program.split("?")[1] : undefined;
		debugConfig.program = debugConfig.program ? getProgramPath(debugConfig.program) : undefined;

		if (this.warnOnUnresolvedVariables("program", debugConfig.program) || this.warnOnUnresolvedVariables("cwd", debugConfig.cwd)) {
			// Warning is shown from inside warnOnUnresolvedVariables.
			return null; // null means open launch.json.
		}

		this.configureProgramAndCwd(debugConfig, folder, openFile);

		// If we still don't have an entry point, the user will have to provide it.
		if (!isAttachRequest && !debugConfig.program) {
			this.logger.warn("No program was set in launch config");
			const exampleEntryPoint = this.wsContext.hasAnyFlutterProjects ? "lib/main.dart" : "bin/main.dart";
			void window.showInformationMessage(`Set the 'program' value in your launch config (eg '${exampleEntryPoint}') then launch again`);
			return null; // null means open launch.json.
		}

		const argsHaveTestFilter = (!!debugConfig.programQuery) || hasTestFilter((debugConfig.toolArgs ?? []).concat(debugConfig.args ?? []));
		const isTest = !!debugConfig.program && isTestFileOrFolder(debugConfig.program);
		const debugType = this.selectDebuggerType(debugConfig, argsHaveTestFilter, isTest, logger);
		const isFlutter = debugType === DebuggerType.Flutter || debugType === DebuggerType.FlutterTest;
		const isIntegrationTest = debugConfig.program && isInsideFolderNamed(debugConfig.program, "integration_test");

		// Handle detecting a Flutter app, but the extension has loaded in Dart-only mode.
		if (isFlutter && !this.wsContext.hasAnyFlutterProjects) {
			this.logger.warn("Tried to launch Flutter project in non-Flutter workspace");
			void window.showErrorMessage(`Unable to launch Flutter project in a Dart-only workspace. Please open a folder closer to your Flutter project root or increase the value of the "dart.projectSearchDepth" setting.`);
			return undefined; // undefined means abort
		}

		// Handle test_driver tests that can be pointed at an existing running instrumented app.
		if (debugType === DebuggerType.FlutterTest && isInsideFolderNamed(debugConfig.program, "test_driver") && !debugConfig.env?.VM_SERVICE_URL) {
			const runningInstrumentedApps = debugSessions.filter((s) => s.loadedServiceExtensions.includes(VmServiceExtension.Driver));
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
			void window.showErrorMessage("Tests in web projects are not currently supported");
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
		if (isAttachRequest && !debugConfig.vmServiceInfoFile) {
			// For attaching, the VM service address must be specified. If it's not provided already, prompt for it.
			if (!isFlutter) { // TEMP Condition because there's no point asking yet as the user doesn't know how to get this..
				debugConfig.vmServiceUri = await this.getFullVmServiceUri(debugConfig.vmServiceUri || debugConfig.observatoryUri);
			}

			if (!debugConfig.vmServiceUri && !isFlutter) {
				logger.warn("No VM service URI/port was provided");
				void window.showInformationMessage("You must provide a VM service URI/port to attach a debugger");
				return undefined; // undefined means silent (don't open launch.json).
			}
		}

		if (token && token.isCancellationRequested)
			return;

		// Ensure we have a device if required.
		let deviceToLaunchOn = this.deviceManager?.getDevice(debugConfig.deviceId as string | undefined) || this.deviceManager?.currentDevice;
		const requiresDevice = (debugType === DebuggerType.Flutter && !isAttachRequest)
			|| (DebuggerType.FlutterTest && isIntegrationTest);
		if (requiresDevice) {
			if (this.deviceManager && this.daemon && debugConfig.deviceId !== "flutter-tester") {
				let supportedPlatforms = this.daemon.capabilities.providesPlatformTypes && debugConfig.cwd
					? (await this.deviceManager.tryGetSupportedPlatforms(debugConfig.cwd))?.platforms
					: undefined;

				if (!debugConfig.suppressPrompts) {
					// If the current device is not valid, prompt the user.
					if (!this.deviceManager.isSupported(supportedPlatforms, deviceToLaunchOn))
						deviceToLaunchOn = await this.deviceManager.showDevicePicker(supportedPlatforms);

					// Refresh the supported platforms, as the we may have enabled new platforms during
					// the call to showDevicePicker.
					supportedPlatforms = this.daemon.capabilities.providesPlatformTypes && debugConfig.cwd
						? (await this.deviceManager.tryGetSupportedPlatforms(debugConfig.cwd))?.platforms
						: undefined;
				}

				// If we still don't have a valid device, show an error.
				if (!this.deviceManager.isSupported(supportedPlatforms, deviceToLaunchOn)) {
					if (!debugConfig.suppressPrompts) {
						if (deviceToLaunchOn) {
							logger.warn(`Unable to launch because ${deviceToLaunchOn.id} is not valid for this project (${deviceToLaunchOn.platformType} is not allowed according to [${supportedPlatforms?.join(", ")}])`);
							void window.showInformationMessage("Cannot launch without a valid device for this project");
						} else {
							logger.warn("Unable to launch due to no active device");
							void window.showInformationMessage("Cannot launch without an active device");
						}
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
		if (!isAttachRequest && debugConfig.cwd && config.promptToRunIfErrors && !debugConfig.suppressPrompts) {
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

		if (debugType === DebuggerType.FlutterTest /* || debugType === DebuggerType.WebTest */ || debugType === DebuggerType.DartTest) {
			if (debugConfig.program) {
				const suites = isTestFolder(debugConfig.program)
					? Array.from(this.testModel.suites.values())
						.filter((suite) => suite.path.startsWith(debugConfig.program!))
					: [this.testModel.suites.getForPath(debugConfig.program)];
				for (const suite of suites.filter(notNullOrUndefined))
					this.testModel.flagSuiteStart(suite, !argsHaveTestFilter);
			}
		}

		debugConfig.debuggerType = debugType;
		if (debugConfig.programQuery) {
			debugConfig.program += debugConfig.programQuery;
			delete debugConfig.programQuery;
		}

		logger.info(`Debug session starting...\n    ${JSON.stringify(debugConfig, undefined, 4).replace(/\n/g, "\n    ")}`);

		// Stash the config to support the "rerun last debug session" command.
		LastDebugSession.workspaceFolder = folder;
		LastDebugSession.debugConfig = Object.assign({}, debugConfig);
		void vs.commands.executeCommand("setContext", HAS_LAST_DEBUG_CONFIG, true);

		// Stash the config to support the "rerun last test(s)" command.
		if (isTest) {
			LastTestDebugSession.workspaceFolder = folder;
			LastTestDebugSession.debugConfig = Object.assign({}, debugConfig);
			void vs.commands.executeCommand("setContext", HAS_LAST_TEST_DEBUG_CONFIG, true);
		}

		if (Array.isArray(debugConfig.additionalExposedUrls)) {
			for (const url of debugConfig.additionalExposedUrls) {
				await envUtils.exposeUrl(url as string, this.logger);
			}
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
				"Errors exist in your project.",
				{ modal: true },
				runAnywayAction,
				showErrorsAction
			);
			if (action === runAnywayAction) {
				logger.info("Running anyway!");
				// Do nothing, we'll just carry on.
			} else {
				logger.info("Aborting!");
				if (action === showErrorsAction)
					void vs.commands.executeCommand("workbench.action.showErrorsWarnings");
				return true;
			}
		}

		return false;
	}

	protected selectDebuggerType(debugConfig: vs.DebugConfiguration & DartLaunchArgs, argsHaveTestFilter: boolean, isTest: boolean, logger: Logger): DebuggerType {
		const isIntegrationTest = debugConfig.program && isInsideFolderNamed(debugConfig.program, "integration_test");

		let debugType = DebuggerType.Dart;
		let firstPathSegment: string | undefined;
		const projectRoot: string | undefined = debugConfig.projectRootPath ?? debugConfig.cwd;
		if (projectRoot && debugConfig.program && isWithinPath(debugConfig.program, projectRoot)) {
			const relativePath = debugConfig.program ? path.relative(projectRoot, debugConfig.program) : undefined;
			firstPathSegment = relativePath?.split(path.sep)[0];
		}
		if (firstPathSegment === "bin" || firstPathSegment === "tool" || firstPathSegment === ".dart_tool") {
			logger.info(`Program is 'bin', 'tool', '.dart_tool' so will use Dart debugger`);
		} else if (isFlutterProjectFolder(projectRoot) || this.wsContext.config.forceFlutterDebug) {
			debugType = DebuggerType.Flutter;
		} else if (firstPathSegment === "web") {
			debugType = DebuggerType.Web;
		} else {
			logger.info(`Program (${debugConfig.program}) not recognised as Flutter or Web, will use Dart debugger`);
		}
		logger.info(`Detected launch project as ${DebuggerType[debugType]}`);

		if (isTest)
			logger.info(`Detected launch project as a Test project`);
		const canUsePackageTest = isTest && projectRoot && projectCanUsePackageTest(projectRoot, this.wsContext.config);
		if (isTest && !canUsePackageTest)
			logger.info(`Project does not appear to support 'pub run test', will use VM directly`);
		if (isTest) {
			switch (debugType) {
				case DebuggerType.Dart:
					if (canUsePackageTest)
						debugType = DebuggerType.DartTest;
					break;
				case DebuggerType.Flutter:
					if (isIntegrationTest) {
						// Integration tests always use "flutter test".
						debugType = DebuggerType.FlutterTest;
					} else if (debugConfig.runTestsOnDevice && argsHaveTestFilter) {
						// TODO: Remove argsHaveTestFilter now that "flutter test" supports running tests on device (integration tests).
						// Non-integration tests set to run on device but have a test name filter will also have
						// to run with "flutter test".
						void vs.window.showWarningMessage("Running with 'flutter test' as 'runTestsOnDevice' is not supported for individual tests.");
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

	protected configureProgramAndCwd(debugConfig: DartVsCodeLaunchArgs, folder: WorkspaceFolder | undefined, openFile: string | undefined) {
		const logger = this.logger;
		const isAttachRequest = debugConfig.request === "attach";

		// Try to infer a default working directory:
		//
		//   1. Provided by the user
		//   2. Inferred from the likely entry point (`program ?? openFile`)
		//   3. From the active workspace folder for this launch configuration (only if no explicit entry point)
		//   4. A common ancestor from the workspace folders
		//
		// The default may be overwritten further down if we locate a project root
		// while walking up the tree from the `program`.

		let defaultCwd = debugConfig.cwd;
		if (!defaultCwd) {
			const likelyEntryPoint = debugConfig.program ?? openFile;
			if (likelyEntryPoint && path.isAbsolute(likelyEntryPoint)) {
				// If we have an explicit program, always use that to try and get a cwd.
				folder = workspace.getWorkspaceFolder(Uri.file(likelyEntryPoint));
				if (folder) {
					defaultCwd = fsPath(folder.uri);
					logger.info(`Setting cwd based on likely entry point: ${defaultCwd}`);
				}
			} else if (folder) {
				// Otherwise, if we had no entry point but did have an active workspace folder, use that.
				defaultCwd = fsPath(folder.uri);
				logger.info(`Setting cwd based on active workspace folder: ${defaultCwd}`);
			}

			// If none of those searches found a good cwd, try to infer one from our active workspace
			// folders.
			if (!defaultCwd && vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length >= 1) {
				if (vs.workspace.workspaceFolders.length === 1) {
					folder = vs.workspace.workspaceFolders[0];
					defaultCwd = fsPath(folder.uri);
					logger.info(`Setting folder/defaultCwd based single open folder: ${defaultCwd}`);
				} else {
					const workspaceFolderPaths = vs.workspace.workspaceFolders.map((wf) => fsPath(wf.uri));
					defaultCwd = findCommonAncestorFolder(workspaceFolderPaths);
				}
				if (defaultCwd)
					logger.info(`Setting defaultCwd based on common ancestor of open folders: ${defaultCwd}`);
				else
					logger.info(`Unable to infer defaultCwd from open workspace (no common ancestor)`);
			}
		}

		// Convert any relative paths to absolute paths (if possible).
		if (defaultCwd && !path.isAbsolute(defaultCwd) && folder) {
			debugConfig.cwd = path.join(fsPath(folder.uri), defaultCwd);
			this.logger.info(`Converted defaultCwd to absolute path: ${defaultCwd}`);
		}
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
					: defaultCwd;

				// If we have a folder specified, we should only consider open files if it's inside it.
				const preferredFile = !preferredFolder || (!!openFile && isWithinPath(openFile, preferredFolder)) ? openFile : undefined;
				debugConfig.program = debugConfig.program || this.guessBestEntryPoint(preferredFile, preferredFolder);
			}
		}

		// Compute a best project root and store it against the config. This can be used to pass to tools like
		// DevTools to ensure we have the right root regardless of the actual cwd we end up using.
		// We allow this to be outside of the project to support some use cases of spawning utility scripts from outside
		// this project (https://github.com/Dart-Code/Dart-Code/issues/4867).
		const bestProjectRoot = debugConfig.program ? locateBestProjectRoot(debugConfig.program, true) : undefined;
		debugConfig.projectRootPath = bestProjectRoot;

		// If we don't have a cwd then find the best one from the project root.
		if (!debugConfig.cwd && defaultCwd) {
			debugConfig.cwd = defaultCwd;
			this.logger.info(`Using workspace as cwd: ${debugConfig.cwd}`);

			// If we have an entry point, see if we can make this more specific by finding a project root.
			if (bestProjectRoot && isWithinPath(bestProjectRoot, defaultCwd)) {
				debugConfig.cwd = bestProjectRoot;
				this.logger.info(`Found better project root to use as cwd: ${debugConfig.cwd}`);
			}
		}

		// Ensure we have a full path.
		if (debugConfig.program && debugConfig.cwd && !path.isAbsolute(debugConfig.program))
			debugConfig.program = path.join(debugConfig.cwd, debugConfig.program);

		if (debugConfig.program && path.isAbsolute(debugConfig.program) && !this.wsContext.config.omitTargetFlag) {
			if (!fs.existsSync(debugConfig.program)) {
				this.logger.warn(`Launch config references non-existent file ${debugConfig.program}`);
				void window.showWarningMessage(`Your launch config references a program that does not exist. If you have problems launching, check the "program" field in your ".vscode/launch.json" file.`);
			}
		}
	}

	private errorWithoutOpeningLaunchConfig(message: string) {
		this.logger.error(message);
		void window.showErrorMessage(message);
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
		if (projectRoot) {
			const projectFolderName = path.basename(projectRoot);
			const commonLaunchPaths = [
				path.join(projectRoot, "lib", "main.dart"),
				path.join(projectRoot, "bin", "main.dart"),
				path.join(projectRoot, "bin", `${projectFolderName}.dart`),
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

		// Finally, if we don't have any workspace folder open, assume the user just wants to
		// run this file.
		if (!workspace.workspaceFolders?.length)
			return openFile;
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

	private async setupDebugConfig(folder: WorkspaceFolder | undefined, debugConfig: DartVsCodeLaunchArgs, debugType: DebuggerType, isFlutter: boolean, isAttach: boolean, isTest: boolean, device: Device | undefined, deviceManager: FlutterDeviceManager | undefined): Promise<void> {
		const conf = config.for(folder && folder.uri);

		if (!debugConfig.name)
			debugConfig.name = isFlutter ? "Flutter" : "Dart";

		if (isFlutter && !debugConfig.deviceId && device) {
			const deviceLabel = deviceManager ? deviceManager.labelForDevice(device) : device.name;

			// Append the device name onto the session name to make it easier to start a config on multiple devices.
			// https://github.com/Dart-Code/Dart-Code/issues/4491
			debugConfig.name += ` (${deviceLabel})`;

			debugConfig.deviceId = device.id;
			debugConfig.deviceName = `${deviceLabel} (${device.platform})`;
		}

		if (isFlutter && !isTest && !isAttach && debugConfig.noDebug
			&& this.flutterCapabilities.requiresForcedDebugModeForNoDebug
			&& config.allowFlutterForcedDebugMode
		) {
			// Force debug mode in the adapter to get a VM Service connection.
			debugConfig.forceEnableDebugging = true;
		}

		debugConfig.toolEnv = getToolEnv();
		debugConfig.sendLogsToClient = isLogging || isDartCodeTestRun;
		debugConfig.sendCustomProgressEvents = true;
		debugConfig.allowAnsiColorOutput = true;
		debugConfig.cwd = debugConfig.cwd || (folder && fsPath(folder.uri));
		debugConfig.additionalProjectPaths = debugConfig.additionalProjectPaths || vs.workspace.workspaceFolders?.map((wf) => fsPath(wf.uri));
		debugConfig.args = debugConfig.args || [];
		debugConfig.vmAdditionalArgs = debugConfig.vmAdditionalArgs || conf.vmAdditionalArgs;
		debugConfig.toolArgs = await this.buildToolArgs(debugType, debugConfig, conf, deviceManager?.daemonPortOverride);
		debugConfig.vmServicePort = debugConfig.vmServicePort ?? 0;
		debugConfig.dartSdkPath = this.wsContext.sdks.dart!;
		debugConfig.vmServiceLogFile = insertSessionName(debugConfig, debugConfig.vmServiceLogFile || conf.vmServiceLogFile);
		debugConfig.webDaemonLogFile = insertSessionName(debugConfig, debugConfig.webDaemonLogFile || conf.webDaemonLogFile);
		debugConfig.maxLogLineLength = debugConfig.maxLogLineLength || config.maxLogLineLength;
		debugConfig.dartTestLogFile = insertSessionName(debugConfig, debugConfig.dartTestLogFile || conf.dartTestLogFile);
		debugConfig.debugSdkLibraries = debugConfig.debugSdkLibraries !== undefined && debugConfig.debugSdkLibraries !== null
			? debugConfig.debugSdkLibraries
			: !!config.debugSdkLibraries;
		debugConfig.debugExternalPackageLibraries = debugConfig.debugExternalPackageLibraries !== undefined && debugConfig.debugExternalPackageLibraries !== null
			? debugConfig.debugExternalPackageLibraries
			: config.debugExternalPackageLibraries;
		debugConfig.showDartDeveloperLogs = conf.showDartDeveloperLogs;
		debugConfig.evaluateGettersInDebugViews = debugConfig.evaluateGettersInDebugViews || conf.evaluateGettersInDebugViews;
		debugConfig.showGettersInDebugViews = debugConfig.showGettersInDebugViews || conf.showGettersInDebugViews;
		debugConfig.evaluateToStringInDebugViews = debugConfig.evaluateToStringInDebugViews || config.evaluateToStringInDebugViews;
		debugConfig.daemonPort = config.daemonPort;

		if (!isFlutter && !isAttach && !isTest && debugConfig.console === undefined && config.cliConsole !== undefined)
			debugConfig.console = config.cliConsole;
		else if (isFlutter && (debugConfig.console === "terminal" || debugConfig.console === "externalTerminal"))
			void vs.window.showWarningMessage(`Flutter projects do not support "terminal" or "externalTerminal" for the "console" setting of a launch configuration. This setting will be ignored.`);

		if (isFlutter && this.wsContext.sdks.flutter) {
			debugConfig.flutterSdkPath = this.wsContext.sdks.flutter;
			debugConfig.omitTargetFlag = this.wsContext.config.omitTargetFlag;
			debugConfig.useInspectorNotificationsForWidgetErrors = config.showInspectorNotificationsForWidgetErrors;
			if (!debugConfig.customTool) {
				const customScript = isAttach ? this.wsContext.config.flutterToolsScript : isTest
					? this.wsContext.config.flutterTestScript
					: this.wsContext.config.flutterRunScript;
				debugConfig.customTool = customScript?.script;
				debugConfig.customToolReplacesArgs = customScript?.replacesArgs;
			}
			debugConfig.flutterRunLogFile = insertSessionName(debugConfig, debugConfig.flutterRunLogFile || conf.flutterRunLogFile);
			debugConfig.flutterTestLogFile = insertSessionName(debugConfig, debugConfig.flutterTestLogFile || conf.flutterTestLogFile);
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
	protected async buildToolArgs(debugType: DebuggerType, debugConfig: DartLaunchArgs, conf: ResourceConfig, portFromLocalExtension?: number): Promise<string[]> {
		let args: string[] = [];
		args = args.concat(debugConfig.toolArgs ?? []);

		switch (debugType) {
			case DebuggerType.Dart:
				args = args.concat(await this.buildDartToolArgs(debugConfig, conf));
				break;
			case DebuggerType.DartTest:
				args = args.concat(await this.buildDartTestToolArgs(debugConfig, conf));
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

		this.addArgsIfNotExist(args, ...conf.cliAdditionalArgs);

		if (debugConfig.enableAsserts !== false) // undefined = on
			this.addArgsIfNotExist(args, "--enable-asserts");

		return args;
	}

	protected async buildDartTestToolArgs(debugConfig: DartVsCodeLaunchArgs, conf: ResourceConfig): Promise<string[]> {
		const args: string[] = [];

		this.addArgsIfNotExist(args, ...conf.testAdditionalArgs);
		if (conf.suppressTestTimeouts === "always" || (conf.suppressTestTimeouts === "debug" && !debugConfig.noDebug)) {
			// Check whether package:test supports --ignore-timeouts
			let useIgnoreTimeouts = false;
			if (debugConfig.cwd) {
				const testCapabilities = await getPackageTestCapabilities(this.logger, this.wsContext, debugConfig.cwd);
				useIgnoreTimeouts = testCapabilities.supportsIgnoreTimeouts;
			}
			if (useIgnoreTimeouts)
				this.addArgsIfNotExist(args, "--ignore-timeouts");
			else
				this.addArgsIfNotExist(args, "--timeout", "1d");
		}

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

		if (debugConfig.deviceId)
			this.addArgsIfNotExist(args, "-d", debugConfig.deviceId);

		if (!isAttach) {
			switch (debugConfig.flutterMode) {
				case "profile":
				case "release":
					this.addArgsIfNotExist(args, `--${debugConfig.flutterMode}`);
					break;

				default: // Debug mode.
					const futterVmServicePortOption = "host-vmservice-port";
					if (debugConfig.vmServicePort && isDebug)
						this.addArgsIfNotExist(args, `--${futterVmServicePortOption}`, debugConfig.vmServicePort.toString());
					if (!conf.flutterTrackWidgetCreation && !args.includes("--no-track-widget-creation"))
						this.addArgsIfNotExist(args, "--no-track-widget-creation");
			}

			if (debugConfig.flutterPlatform && debugConfig.flutterPlatform !== "default")
				this.addArgsIfNotExist(args, "--target-platform", debugConfig.flutterPlatform);

			if (debugConfig.deviceId === "web-server") {
				if (!args.includes("--web-server-debug-protocol"))
					this.addArgsIfNotExist(args, "--web-server-debug-protocol", "ws");
				if (config.debugExtensionBackendProtocol)
					this.addArgsIfNotExist(args, "--web-server-debug-backend-protocol", config.debugExtensionBackendProtocol);
				if (config.debugExtensionBackendProtocol)
					this.addArgsIfNotExist(args, "--web-server-debug-injected-client-protocol", config.debugExtensionBackendProtocol);
			}
			if (!isRunningLocally)
				this.addArgsIfNotExist(args, "--web-allow-expose-url");

			if (isWeb) {
				const renderer = getFutterWebRenderer(this.flutterCapabilities, config.flutterWebRenderer);
				if (renderer)
					this.addArgsIfNotExist(args, "--web-renderer", renderer);
			}
		}

		const daemonPort = this.deviceManager?.daemonPortOverride ?? conf.daemonPort;
		if (this.wsContext.config.forceFlutterWorkspace && daemonPort) {
			this.addArgsIfNotExist(args, "--daemon-connection-port", daemonPort.toString());
		}

		if (config.shareDevToolsWithFlutter && !args.includes("--devtools-server-address")) {
			this.logger.info("Getting DevTools server address to pass to Flutter...");
			try {
				const devtoolsUrl = await this.devTools.devtoolsUrl;
				if (devtoolsUrl)
					this.addArgsIfNotExist(args, "--devtools-server-address", devtoolsUrl.toString());
				else if (!isDartCodeTestRun) // Suppress warning on test runs as they're fast and can launch before the server starts
					this.logger.warn("DevTools server unavailable, not sending --devtools-server-address!");
			} catch (e) {
				this.logger.error(`Failed to get DevTools server address ${e}`);
			}
		}

		if ((isLogging || isDartCodeTestRun) && !args.includes("--verbose"))
			this.addArgsIfNotExist(args, "-v");

		return args;
	}

	protected async buildFlutterTestToolArgs(debugConfig: DartVsCodeLaunchArgs, conf: ResourceConfig): Promise<string[]> {
		const args: string[] = [];

		this.addArgsIfNotExist(args, ...getGlobalFlutterArgs());
		this.addArgsIfNotExist(args, ...conf.flutterAdditionalArgs);
		this.addArgsIfNotExist(args, ...conf.flutterTestAdditionalArgs);

		if (debugConfig.deviceId)
			this.addArgsIfNotExist(args, "-d", debugConfig.deviceId);

		if (conf.suppressTestTimeouts === "always" || (conf.suppressTestTimeouts === "debug" && !debugConfig.noDebug))
			this.addArgsIfNotExist(args, "--timeout", "1d");

		return args;
	}

	protected addArgsIfNotExist(args: string[], ...toAdd: string[]) {
		if (!args.includes(toAdd[0])) {
			toAdd.forEach((s) => args.push(s));
		}
	}
}

export class InitialLaunchJsonDebugConfigProvider implements DebugConfigurationProvider {
	constructor(private readonly logger: Logger) { }

	public async provideDebugConfigurations(folder: WorkspaceFolder | undefined, token?: CancellationToken): Promise<DebugConfiguration[]> {
		const results: DebugConfiguration[] = [];

		const projectFolders = folder
			? await getAllProjectFolders(this.logger, getExcludedFolders, { requirePubspec: true, searchDepth: config.projectSearchDepth, workspaceFolders: [folder] })
			: [];
		const rootFolder = folder ? fsPath(folder.uri) : undefined;

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
					results.push({
						name: `${name} (release mode)`,
						cwd,
						request: "launch",
						type: "dart",
						flutterMode: "release",
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
	constructor(private readonly logger: Logger, private readonly deviceManager: FlutterDeviceManager | undefined) { }

	public async provideDebugConfigurations(folder: WorkspaceFolder | undefined, token?: CancellationToken): Promise<DebugConfiguration[]> {
		const results: DebugConfiguration[] = [];

		const rootFolder = folder ? fsPath(folder.uri) : undefined;
		const projectFolders = folder
			? await getAllProjectFolders(this.logger, getExcludedFolders, { requirePubspec: true, searchDepth: config.projectSearchDepth, workspaceFolders: [folder] })
			: [];
		for (const projectFolder of projectFolders) {
			const isFlutter = isFlutterProjectFolder(projectFolder);
			const name = path.basename(projectFolder);
			// Compute cwd, using undefined instead of empty if rootFolder === projectFolder
			const cwd = rootFolder ? path.relative(rootFolder, projectFolder) || undefined : undefined;
			const exists = (p: string) => projectFolder && fs.existsSync(path.join(projectFolder, p));

			if (isFlutter && exists("lib/main.dart") && this.deviceManager) {
				results.push({
					name: `${name} (Flutter)`,
					program: "lib/main.dart",
					cwd,
					request: "launch",
					type: "dart",
				});
				const devices = await this.deviceManager.getValidDevicesForProject(projectFolder);
				for (const device of devices) {
					const deviceLabel = this.deviceManager?.labelForDevice(device);
					results.push({
						name: `${name} (Flutter ${deviceLabel})`,
						program: "lib/main.dart",
						cwd,
						deviceId: device.id,
						request: "launch",
						type: "dart",
					});
				}
				results.push({
					name: `${name} (Flutter profile mode)`,
					program: "lib/main.dart",
					cwd,
					request: "launch",
					type: "dart",
					flutterMode: "profile",
				});
				results.push({
					name: `${name} (Flutter release mode)`,
					program: "lib/main.dart",
					cwd,
					request: "launch",
					type: "dart",
					flutterMode: "release",
				});
			}
			if (!isFlutter && exists("web")) {
				results.push({
					name: `${name} (Dart Web)`,
					program: "web",
					cwd,
					request: "launch",
					type: "dart",
				});
			}
			if (exists("bin/main.dart")) {
				results.push({
					name: `${name} (Dart)`,
					program: "bin/main.dart",
					cwd,
					request: "launch",
					type: "dart",
				});
			}
			if (exists("test")) {
				results.push({
					name: `${name} (${isFlutter ? "Flutter" : "Dart"} Tests)`,
					program: "test",
					cwd,
					request: "launch",
					type: "dart",
				});
			}
			if (isFlutter && exists("integration_test")) {
				results.push({
					name: `${name} (${isFlutter ? "Flutter" : "Dart"} Integration Tests)`,
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
