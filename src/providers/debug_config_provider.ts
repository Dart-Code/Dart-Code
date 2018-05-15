import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import * as vs from "vscode";
import { CancellationToken, DebugConfiguration, DebugConfigurationProvider, ProviderResult, Uri, WorkspaceFolder, window, workspace } from "vscode";
import { DebugSession } from "vscode-debugadapter";
import { Analytics } from "../analytics";
import { config } from "../config";
import { DartDebugSession } from "../debug/dart_debug_impl";
import { FlutterDebugSession } from "../debug/flutter_debug_impl";
import { FlutterTestDebugSession } from "../debug/flutter_test_debug_impl";
import { FlutterLaunchRequestArguments, forceWindowsDriveLetterToUppercase, isWin } from "../debug/utils";
import { FlutterDeviceManager } from "../flutter/device_manager";
import { Sdks, fsPath, isFlutterProjectFolder, isFlutterWorkspaceFolder, isInsideFolderNamed, isTestFile } from "../utils";

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
		function resolveVariables(input: string): string {
			if (!input) return input;
			if (input === "${file}") return openFile;
			return input.replace(/\${workspaceFolder}/, fsPath(folder.uri));
		}

		const isAttachRequest = debugConfig.request === "attach";

		debugConfig.program = resolveVariables(debugConfig.program);
		debugConfig.cwd = resolveVariables(debugConfig.cwd);

		// If there's no program set, try to guess one.
		if (!isAttachRequest) {
			// Overwrite the folder with a more appropriate workspace root (https://github.com/Microsoft/vscode/issues/45580)
			if (openFile)
				folder = workspace.getWorkspaceFolder(Uri.file(openFile)) || folder;

			debugConfig.program = debugConfig.program || this.guessBestEntryPoint(openFile, folder);

			// If we still don't have an entry point, the user will have to provide it.
			if (!debugConfig.program) {
				// Set type=null which causes launch.json to open.
				debugConfig.type = null;
				window.showInformationMessage("Set the 'program' value in your launch config (eg 'bin/main.dart') then launch again");
				return debugConfig;
			}
		} else {
			debugConfig.packages = debugConfig.packages || path.join(fsPath(folder.uri), ".packages");

			// For attaching, the Observatory address must be specified. If it's not provided already, prompt for it.
			debugConfig.observatoryUri = debugConfig.observatoryUri || await this.getObservatoryUri();

			if (!debugConfig.observatoryUri) {
				// Set type=null which causes launch.json to open.
				debugConfig.type = null;
				window.showInformationMessage("Set the 'program' value in your launch config (eg 'bin/main.dart') then launch again");
				return debugConfig;
			}
		}

		// If we don't have a cwd then find the best one from the project root.
		debugConfig.cwd = debugConfig.cwd || fsPath(folder.uri);

		// Disable Flutter mode for attach.
		// TODO: Update FlutterDebugSession to understand attach mode, and remove this limitation.
		const isFlutter = isFlutterProjectFolder(debugConfig.cwd as string) && !isAttachRequest;
		const isTest = isTestFile(resolveVariables(debugConfig.program as string));
		const debugType = isFlutter
			? (isTest ? DebuggerType.FlutterTest : DebuggerType.Flutter)
			: DebuggerType.Dart;

		// TODO: This cast feels nasty?
		this.setupDebugConfig(folder, debugConfig as any as FlutterLaunchRequestArguments, isFlutter, this.deviceManager && this.deviceManager.currentDevice ? this.deviceManager.currentDevice.id : null);

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
		} else {
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

	private async getObservatoryUri(): Promise<string> {
		let userInput = await vs.window.showInputBox({ prompt: "Enter Observatory address. This can be a full URL, or just a port for localhost." });

		// If the input is just a number, treat is as a localhost port.
		if (userInput && /^\s*[0-9]+\s*$/.exec(userInput)) {
			userInput = `http://127.0.0.1:${userInput}`;
		}

		return userInput;
	}

	private getDebugServer(debugType: DebuggerType, port?: number) {
		switch (debugType) {
			case DebuggerType.Flutter:
				return this.spawnOrGetServer("flutter", port, () => new FlutterDebugSession());
			case DebuggerType.FlutterTest:
				return this.spawnOrGetServer("flutterTest", port, () => new FlutterTestDebugSession());
			case DebuggerType.Dart:
				return this.spawnOrGetServer("dart", port, () => new DartDebugSession());
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
		const dartExec = isWin ? "dart.exe" : "dart";
		const flutterExec = isWin ? "flutter.bat" : "flutter";

		const conf = config.for(folder.uri);

		// Attach any properties that weren't explicitly set.
		debugConfig.type = debugConfig.type || "dart";
		debugConfig.request = debugConfig.request || "launch";
		debugConfig.cwd = debugConfig.cwd || fsPath(folder.uri);
		debugConfig.args = debugConfig.args || [];
		debugConfig.vmAdditionalArgs = debugConfig.vmAdditionalArgs || conf.vmAdditionalArgs;
		debugConfig.dartPath = debugConfig.dartPath || path.join(this.sdks.dart, "bin", dartExec);
		debugConfig.observatoryLogFile = debugConfig.observatoryLogFile || conf.observatoryLogFile;
		if (debugConfig.previewDart2 !== undefined) {
			debugConfig.previewDart2 = debugConfig.previewDart2;
		} else {
			debugConfig.previewDart2 = config.previewDart2;
		}
		debugConfig.debugSdkLibraries = debugConfig.debugSdkLibraries || conf.debugSdkLibraries;
		debugConfig.debugExternalLibraries = debugConfig.debugExternalLibraries || conf.debugExternalLibraries;
		if (isFlutter) {
			debugConfig.flutterMode = debugConfig.flutterMode || "debug";
			debugConfig.flutterPath = debugConfig.flutterPath || (this.sdks.flutter ? path.join(this.sdks.flutter, "bin", flutterExec) : null);
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
	Flutter,
	FlutterTest,
}
