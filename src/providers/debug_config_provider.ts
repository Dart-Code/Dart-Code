import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import * as vs from "vscode";
import { CancellationToken, DebugConfiguration, DebugConfigurationProvider, ProviderResult, Uri, window, workspace, WorkspaceFolder } from "vscode";
import { DebugSession } from "vscode-debugadapter";
import { Analytics } from "../analytics";
import { LastDebugSession } from "../commands/debug";
import { config } from "../config";
import { DartDebugSession } from "../debug/dart_debug_impl";
import { DartTestDebugSession } from "../debug/dart_test_debug_impl";
import { FlutterDebugSession } from "../debug/flutter_debug_impl";
import { FlutterTestDebugSession } from "../debug/flutter_test_debug_impl";
import { FlutterLaunchRequestArguments, forceWindowsDriveLetterToUppercase, isWithinPath } from "../debug/utils";
import { FlutterCapabilities } from "../flutter/capabilities";
import { FlutterDeviceManager } from "../flutter/device_manager";
import { locateBestProjectRoot } from "../project";
import { dartVMPath, flutterPath, pubPath, pubSnapshotPath } from "../sdk/utils";
import { fsPath, isDartFile, isFlutterProjectFolder, isFlutterWorkspaceFolder, isInsideFolderNamed, isTestFile, isTestFileOrFolder, projectSupportsPubRunTest, ProjectType, Sdks } from "../utils";
import { log, logError, logWarn } from "../utils/log";
import { TestResultsProvider } from "../views/test_view";

export const TRACK_WIDGET_CREATION_ENABLED = "dart-code:trackWidgetCreationEnabled";
export const HAS_LAST_DEBUG_CONFIG = "dart-code:hasLastDebugConfig";

export class DebugConfigProvider implements DebugConfigurationProvider {
	private debugServers: { [index: string]: net.Server } = {};

	constructor(private sdks: Sdks, private analytics: Analytics, private deviceManager: FlutterDeviceManager, private flutterCapabilities: FlutterCapabilities) {
		this.sdks = sdks;
		this.analytics = analytics;
		this.deviceManager = deviceManager;
	}

	public provideDebugConfigurations(folder: WorkspaceFolder | undefined, token?: CancellationToken): ProviderResult<DebugConfiguration[]> {
		const isFlutter = isFlutterWorkspaceFolder(folder);
		return [{
			name: isFlutter ? "Flutter" : "Dart",
			program: isFlutter ? undefined : "bin/main.dart",
			request: "launch",
			type: "dart",
		}];
	}

	public async resolveDebugConfiguration(folder: WorkspaceFolder | undefined, debugConfig: DebugConfiguration, token?: CancellationToken): Promise<DebugConfiguration> {
		const openFile = window.activeTextEditor && window.activeTextEditor.document ? fsPath(window.activeTextEditor.document.uri) : null;

		function resolveVariables(input?: string): string {
			if (!input) return input;
			input = input.replace(/\${file}/gi, openFile);
			if (folder) {
				const folderPath = fsPath(folder.uri);
				input = input.replace(/\${(workspaceFolder|workspaceRoot)}/gi, folderPath);
			}
			return input;
		}

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
				logError(`Launch config property '${property}' has unresolvable variable ${v}`);
				window.showErrorMessage(`Launch config property '${property}' has unresolvable variable ${v}`);
				return true;
			}
			return false;
		}

		log(`Starting debug session...`);
		if (folder)
			log(`    workspace: ${fsPath(folder.uri)}`);
		if (debugConfig.program)
			log(`    program  : ${debugConfig.program}`);
		if (debugConfig.cwd)
			log(`    cwd      : ${debugConfig.cwd}`);

		debugConfig.program = resolveVariables(debugConfig.program);
		debugConfig.cwd = resolveVariables(debugConfig.cwd);

		if (warnOnUnresolvedVariables("program", debugConfig.program) || warnOnUnresolvedVariables("cwd", debugConfig.cwd)) {
			// Warning is shown from inside warnOnUnresolvedVariables.
			return null; // null means open launch.json.
		}

		if (openFile && !folder) {
			folder = workspace.getWorkspaceFolder(Uri.file(openFile));
			if (folder)
				log(`Setting workspace based on open file: ${fsPath(folder.uri)}`);
		} else if (!folder && vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length === 1) {
			folder = vs.workspace.workspaceFolders[0];
			if (folder)
				log(`Setting workspace based on single open workspace: ${fsPath(folder.uri)}`);
		}

		// Convert to an absolute paths (if possible).
		if (debugConfig.cwd && !path.isAbsolute(debugConfig.cwd) && folder) {
			debugConfig.cwd = path.join(fsPath(folder.uri), debugConfig.cwd);
			log(`Converted cwd to absolute path: ${debugConfig.cwd}`);
		}
		if (debugConfig.program && !path.isAbsolute(debugConfig.program) && (debugConfig.cwd || folder)) {
			debugConfig.program = path.join(debugConfig.cwd || fsPath(folder.uri), debugConfig.program);
			log(`Converted program to absolute path: ${debugConfig.program}`);
		}

		const isAttachRequest = debugConfig.request === "attach";
		if (!isAttachRequest) {
			// If there's no program set, try to guess one.
			const preferredFolder = debugConfig.cwd
				? debugConfig.cwd
				: folder
					? fsPath(folder.uri)
					: undefined;
			// If we have a folder specificed, we should only consider open files if it's inside it.
			const preferredFile = preferredFolder == null || isWithinPath(openFile, preferredFolder) ? openFile : undefined;
			debugConfig.program = debugConfig.program || this.guessBestEntryPoint(preferredFile, preferredFolder);

			// If we still don't have an entry point, the user will have to provide it.
			if (!debugConfig.program) {
				logWarn("No program was set in launch config");
				window.showInformationMessage("Set the 'program' value in your launch config (eg 'bin/main.dart') then launch again");
				return null; // null means open launch.json.
			}
		}

		// If we don't have a cwd then find the best one from the project root.
		if (!debugConfig.cwd && folder) {
			debugConfig.cwd = fsPath(folder.uri);
			log(`Using workspace as cwd: ${debugConfig.cwd}`);

			// If we have an entry point, see if we can make this more specific by finding a .packages file
			if (debugConfig.program) {
				const bestProjectRoot = locateBestProjectRoot(debugConfig.program);
				if (bestProjectRoot) {
					if (!folder || isWithinPath(bestProjectRoot, fsPath(folder.uri))) {
						debugConfig.cwd = bestProjectRoot;
						log(`Found better project root to use as cwd: ${debugConfig.cwd}`);
					}
				}
			}
		}

		// Ensure we have a full path.
		if (debugConfig.program && debugConfig.cwd && !path.isAbsolute(debugConfig.program))
			debugConfig.program = path.join(debugConfig.cwd, debugConfig.program);

		const isFlutter = this.sdks.projectType !== ProjectType.Dart
			&& debugConfig.cwd && isFlutterProjectFolder(debugConfig.cwd as string)
			&& !isInsideFolderNamed(debugConfig.program, "bin") && !isInsideFolderNamed(debugConfig.program, "tool");
		log(`Detected launch project as ${isFlutter ? "Flutter" : "Dart"}`);
		const isTest = debugConfig.program && isTestFileOrFolder(debugConfig.program as string);
		if (isTest)
			log(`Detected launch project as a Test project`);
		const canPubRunTest = isTest && debugConfig.cwd && projectSupportsPubRunTest(debugConfig.cwd as string);
		if (isTest && !canPubRunTest)
			log(`Project does not appear to support 'pub run test', will use VM directly`);
		const debugType = isFlutter
			? (isTest ? DebuggerType.FlutterTest : DebuggerType.Flutter)
			: (isTest && canPubRunTest ? DebuggerType.PubTest : DebuggerType.Dart);
		log(`Using ${DebuggerType[debugType]} debug adapter for this session`);

		// If we're attaching to Dart, ensure we get an observatory URI.
		if (isAttachRequest) {
			// For attaching, the Observatory address must be specified. If it's not provided already, prompt for it.
			if (!isFlutter) { // TEMP Condition because there's no point asking yet as the user doesn't know how to get this..
				debugConfig.observatoryUri = await this.getObservatoryUri(debugConfig.observatoryUri/*, mostRecentAttachedProbablyReusableObservatoryUri*/);
			}

			if (!debugConfig.observatoryUri && !isFlutter) {
				logWarn("No Observatory URI/port was provided");
				window.showInformationMessage("You must provide an Observatory URI/port to attach a debugger");
				return undefined; // undefined means silent (don't open launch.json).
			}
		}

		// Ensure we have a device
		const deviceId = this.deviceManager && this.deviceManager.currentDevice ? this.deviceManager.currentDevice.id : null;
		if (isFlutter && !isTest && !deviceId && this.deviceManager && debugConfig.deviceId !== "flutter-tester") {
			// Fetch a list of emulators
			if (!await this.deviceManager.promptForAndLaunchEmulator(true)) {
				logWarn("Unable to launch due to no active device");
				window.showInformationMessage("Cannot launch without an active device");
				return undefined; // undefined means silent (don't open launch.json).
			}
		}

		// TODO: This cast feels nasty?
		this.setupDebugConfig(folder, debugConfig as any as FlutterLaunchRequestArguments, isFlutter, deviceId);

		// Debugger always uses uppercase drive letters to ensure our paths have them regardless of where they came from.
		debugConfig.program = forceWindowsDriveLetterToUppercase(debugConfig.program);
		debugConfig.cwd = forceWindowsDriveLetterToUppercase(debugConfig.cwd);

		// Start port listener on launch of first debug session.
		const debugServer = this.getDebugServer(debugType, debugConfig.debugServer);

		// Make VS Code connect to debug server instead of launching debug adapter.
		// TODO: Why do we need this cast? The node-mock-debug does not?
		(debugConfig as any).debugServer = debugServer.address().port;

		this.analytics.logDebuggerStart(folder && folder.uri);
		if (debugType === DebuggerType.FlutterTest || debugType === DebuggerType.PubTest) {
			const isRunningTestSubset = debugConfig.args && (debugConfig.args.indexOf("--name") !== -1 || debugConfig.args.indexOf("--pname") !== -1);
			TestResultsProvider.flagSuiteStart(debugConfig.program, !isRunningTestSubset);
		}

		log(`Debug session starting...\n    ${JSON.stringify(debugConfig, undefined, 4).replace(/\n/g, "\n    ")}`);

		// Stash the config to support the "rerun last test(s)" command.
		LastDebugSession.workspaceFolder = folder;
		LastDebugSession.debugConfig = Object.assign({}, debugConfig);
		vs.commands.executeCommand("setContext", HAS_LAST_DEBUG_CONFIG, true);

		return debugConfig;
	}

	private guessBestEntryPoint(openFile: string, folder: string | undefined): string | undefined {
		// For certain open files, assume the user wants to run them.
		if (isDartFile(openFile) &&
			(isTestFile(openFile) || (isInsideFolderNamed(openFile, "bin") || isInsideFolderNamed(openFile, "tool")))) {
			log(`Using open file as entry point: ${openFile}`);
			return openFile;
		}

		// Use the open file as a clue to find the best project root, then search from there.
		const projectRoot = locateBestProjectRoot(openFile) || folder;
		if (!projectRoot)
			return;

		const commonLaunchPaths = [
			path.join(projectRoot, "lib", "main.dart"),
			path.join(projectRoot, "bin", "main.dart"),
		];
		for (const launchPath of commonLaunchPaths) {
			if (fs.existsSync(launchPath)) {
				log(`Using found common entry point: ${openFile}`);
				return launchPath;
			}
		}
	}

	private async getObservatoryUri(observatoryUri: string, defaultValue?: string): Promise<string> {
		observatoryUri = observatoryUri || await vs.window.showInputBox({
			ignoreFocusOut: true, // Don't close the window if the user tabs away to get the uri
			placeHolder: "Paste an Observatory URI or port",
			prompt: "Enter Observatory URI",
			validateInput: (input) => {
				if (!input)
					return;

				input = input.trim();

				if (Number.isInteger(parseFloat(input)))
					return;

				// Uri.parse doesn't seem to work as expected, so do our own basic validation
				// https://github.com/Microsoft/vscode/issues/49818

				if (!input.startsWith("http://") && !input.startsWith("https://"))
					return "Please enter a valid Observatory URI or port number";
			},
			value: defaultValue,
		});
		observatoryUri = observatoryUri && observatoryUri.trim();

		// If the input is just a number, treat is as a localhost port.
		if (observatoryUri && /^[0-9]+$/.exec(observatoryUri)) {
			observatoryUri = `http://127.0.0.1:${observatoryUri}`;
		}

		return observatoryUri;
	}

	private getDebugServer(debugType: DebuggerType, port?: number) {
		switch (debugType) {
			case DebuggerType.Flutter:
				return this.spawnOrGetServer("flutter", port, () => new FlutterDebugSession());
			case DebuggerType.FlutterTest:
				return this.spawnOrGetServer("flutterTest", port, () => new FlutterTestDebugSession());
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
			log(`Spawning a new ${type} debugger`);
			// Start listening on a random port.
			this.debugServers[type] = net.createServer((socket) => {
				const session = create();
				session.setRunAsServer(true);
				session.start(socket as NodeJS.ReadableStream, socket);
			}).listen(port);
		}

		return this.debugServers[type];
	}

	private setupDebugConfig(folder: WorkspaceFolder | undefined, debugConfig: FlutterLaunchRequestArguments, isFlutter: boolean, deviceId: string) {
		const conf = config.for(folder && folder.uri || null);

		// Attach any properties that weren't explicitly set.
		debugConfig.name = debugConfig.name || "Dart & Flutter";
		debugConfig.type = debugConfig.type || "dart";
		debugConfig.request = debugConfig.request || "launch";
		debugConfig.cwd = debugConfig.cwd || (folder && fsPath(folder.uri));
		debugConfig.args = debugConfig.args || [];
		debugConfig.vmAdditionalArgs = debugConfig.vmAdditionalArgs || conf.vmAdditionalArgs;
		debugConfig.dartPath = debugConfig.dartPath || path.join(this.sdks.dart, dartVMPath);
		debugConfig.observatoryLogFile = debugConfig.observatoryLogFile || conf.observatoryLogFile;
		debugConfig.maxLogLineLength = debugConfig.maxLogLineLength || config.maxLogLineLength;
		debugConfig.pubPath = debugConfig.pubPath || path.join(this.sdks.dart, pubPath);
		debugConfig.pubSnapshotPath = debugConfig.pubSnapshotPath || path.join(this.sdks.dart, pubSnapshotPath);
		debugConfig.pubTestLogFile = debugConfig.pubTestLogFile || conf.pubTestLogFile;
		debugConfig.debugSdkLibraries = debugConfig.debugSdkLibraries || conf.debugSdkLibraries;
		debugConfig.debugExternalLibraries = debugConfig.debugExternalLibraries || conf.debugExternalLibraries;
		debugConfig.evaluateGettersInDebugViews = debugConfig.evaluateGettersInDebugViews || conf.evaluateGettersInDebugViews;
		debugConfig.flutterTrackWidgetCreation =
			// Use from the launch.json if configured.
			debugConfig.flutterTrackWidgetCreation !== undefined
				? debugConfig.flutterTrackWidgetCreation :
				// Otherwise use the config, falling back to the version-dependant default.
				conf.flutterTrackWidgetCreationIsConfiguredExplicitly
					? conf.flutterTrackWidgetCreation
					: this.flutterCapabilities.trackWidgetCreationDefault;
		if (isFlutter) {
			debugConfig.flutterMode = debugConfig.flutterMode || "debug";
			debugConfig.flutterPath = debugConfig.flutterPath || (this.sdks.flutter ? path.join(this.sdks.flutter, flutterPath) : null);
			debugConfig.flutterRunLogFile = debugConfig.flutterRunLogFile || conf.flutterRunLogFile;
			debugConfig.flutterTestLogFile = debugConfig.flutterTestLogFile || conf.flutterTestLogFile;
			debugConfig.deviceId = debugConfig.deviceId || deviceId;
			debugConfig.showMemoryUsage =
				debugConfig.showMemoryUsage !== undefined && debugConfig.showMemoryUsage !== null
					? debugConfig.showMemoryUsage
					: debugConfig.flutterMode === "profile";
		}
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

enum DebuggerType {
	Dart,
	PubTest,
	Flutter,
	FlutterTest,
}
