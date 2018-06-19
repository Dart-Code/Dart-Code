import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import * as vs from "vscode";
import { CancellationToken, DebugConfiguration, DebugConfigurationProvider, ProviderResult, Uri, WorkspaceFolder, window, workspace } from "vscode";
import { DebugSession } from "vscode-debugadapter";
import { Analytics } from "../analytics";
import { config } from "../config";
import { DartDebugSession } from "../debug/dart_debug_impl";
import { DartTestDebugSession } from "../debug/dart_test_debug_impl";
import { FlutterDebugSession } from "../debug/flutter_debug_impl";
import { FlutterTestDebugSession } from "../debug/flutter_test_debug_impl";
import { FlutterLaunchRequestArguments, forceWindowsDriveLetterToUppercase, isWithinPath } from "../debug/utils";
import { FlutterDeviceManager } from "../flutter/device_manager";
import { locateBestProjectRoot } from "../project";
import { dartPubPath, dartVMPath, flutterPath } from "../sdk/utils";
import { Sdks, fsPath, isFlutterProjectFolder, isFlutterWorkspaceFolder, isInsideFolderNamed, isTestFile, supportsPubRunTest } from "../utils";

export class DebugConfigProvider implements DebugConfigurationProvider {
	private sdks: Sdks;
	private analytics: Analytics;
	private deviceManager: FlutterDeviceManager;
	private debugServers: { [index: string]: net.Server } = {};

	constructor(sdks: Sdks, analytics: Analytics, deviceManager: FlutterDeviceManager) {
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

		// VS Code often gives us a bogus folder, so only trust it if we got a real debugConfig (eg. with program or cwd).
		// Otherwise, take from open file if we have one, else blank it (unless we only have one open folder, then use that).
		if (!debugConfig.cwd && !debugConfig.program) {
			folder = openFile
				? workspace.getWorkspaceFolder(Uri.file(openFile))
				: (
					workspace.workspaceFolders.length === 1
						? workspace.workspaceFolders[0]
						: undefined
				);
		}

		function resolveVariables(input: string): string {
			if (!input) return input;
			if (input === "${file}") return openFile;
			if (!folder) return input;
			return input.replace(/\${workspaceFolder}/, fsPath(folder.uri));
		}

		debugConfig.program = resolveVariables(debugConfig.program);
		debugConfig.cwd = resolveVariables(debugConfig.cwd);

		const isAttachRequest = debugConfig.request === "attach";
		if (!isAttachRequest) {
			// If there's no program set, try to guess one.
			debugConfig.program = debugConfig.program || this.guessBestEntryPoint(openFile, folder);

			// If we still don't have an entry point, the user will have to provide it.
			if (!debugConfig.program) {
				// Set type=null which causes launch.json to open.
				debugConfig.type = null;
				window.showInformationMessage("Set the 'program' value in your launch config (eg 'bin/main.dart') then launch again");
				return debugConfig;
			}
		} else {
			// For attaching, the Observatory address must be specified. If it's not provided already, prompt for it.
			debugConfig.observatoryUri = await this.getObservatoryUri(debugConfig.observatoryUri);

			if (!debugConfig.observatoryUri) {
				// Set type=null which causes launch.json to open.
				debugConfig.type = null;
				window.showInformationMessage("You must provide an Observatory URI/port to attach a debugger");
				return debugConfig;
			}
		}

		// If we don't have a cwd then find the best one from the project root.
		if (!debugConfig.cwd && folder) {
			debugConfig.cwd = fsPath(folder.uri);

			// If we have an entry point, see if we can make this more specific by finding a .packages file
			if (debugConfig.program) {
				const bestProjectRoot = locateBestProjectRoot(debugConfig.program);
				if (bestProjectRoot) {
					if (!folder || isWithinPath(bestProjectRoot, fsPath(folder.uri)))
						debugConfig.cwd = bestProjectRoot;
				}
			}
		}

		// Ensure we have a full path.
		if (debugConfig.program && debugConfig.cwd && !path.isAbsolute(debugConfig.program))
			debugConfig.program = path.join(debugConfig.cwd, debugConfig.program);

		// Disable Flutter mode for attach.
		// TODO: Update FlutterDebugSession to understand attach mode, and remove this limitation.
		const isFlutter = debugConfig.cwd && isFlutterProjectFolder(debugConfig.cwd as string) && !isAttachRequest;
		const isTest = debugConfig.program && isTestFile(debugConfig.program as string);
		const canPubRunTest = isTest && supportsPubRunTest(debugConfig.program as string);
		const debugType = isFlutter
			? (isTest ? DebuggerType.FlutterTest : DebuggerType.Flutter)
			: (isTest && canPubRunTest ? DebuggerType.DartTest : DebuggerType.Dart);

		// Ensure we have a device
		const deviceId = this.deviceManager && this.deviceManager.currentDevice ? this.deviceManager.currentDevice.id : null;
		if (isFlutter && !isTest && !deviceId && this.deviceManager && debugConfig.deviceId !== "flutter-tester") {
			// Fetch a list of emulators
			if (!await this.deviceManager.promptForAndLaunchEmulator(true)) {
				// Set type=null which causes launch.json to open.
				debugConfig.type = null;
				window.showInformationMessage("Cannot launch without an active device");
				return debugConfig;
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

		return debugConfig;
	}

	private guessBestEntryPoint(openFile: string, workspaceFolder: WorkspaceFolder | undefined): string {

		if (isTestFile(openFile) || isInsideFolderNamed(openFile, "bin") || isInsideFolderNamed(openFile, "tool")) {
			return openFile;
		} else if (workspaceFolder) {
			// Use the open file as a clue to find the best project root, then search from there.
			const commonLaunchPaths = [
				path.join(fsPath(workspaceFolder.uri), "lib", "main.dart"),
				path.join(fsPath(workspaceFolder.uri), "bin", "main.dart"),
			];
			for (const launchPath of commonLaunchPaths) {
				if (fs.existsSync(launchPath)) {
					return launchPath;
				}
			}
		}
	}

	private async getObservatoryUri(observatoryUri: string): Promise<string> {
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
			case DebuggerType.DartTest:
				return this.spawnOrGetServer("dartTest", port, () => new DartTestDebugSession());
			default:
				throw new Error("Unknown debugger type");
		}
	}

	private spawnOrGetServer(type: string, port: number = 0, create: () => DebugSession): net.Server {
		// Start port listener on launch of first debug session.
		if (!this.debugServers[type]) {

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
		debugConfig.pubPath = debugConfig.pubPath || path.join(this.sdks.dart, dartPubPath);
		debugConfig.dartTestLogFile = debugConfig.dartTestLogFile || conf.dartTestLogFile;
		debugConfig.debugSdkLibraries = debugConfig.debugSdkLibraries || conf.debugSdkLibraries;
		debugConfig.debugExternalLibraries = debugConfig.debugExternalLibraries || conf.debugExternalLibraries;
		debugConfig.evaluateGettersInDebugViews = debugConfig.evaluateGettersInDebugViews || conf.evaluateGettersInDebugViews;
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
	DartTest,
	Flutter,
	FlutterTest,
}
