import * as fs from "fs";
import * as path from "path";
import * as net from "net";
import { Analytics } from "../analytics";
import { config } from "../config";
import { DartDebugSession } from "../debug/dart_debug_impl";
import { DebugConfigurationProvider, WorkspaceFolder, CancellationToken, DebugConfiguration, ProviderResult, commands, window, workspace, debug, Uri } from "vscode";
import { DebugSession } from "vscode-debugadapter";
import { FlutterDebugSession } from "../debug/flutter_debug_impl";
import { FlutterDeviceManager } from "../flutter/device_manager";
import { FlutterLaunchRequestArguments, isWin, forceWindowsDriveLetterToUppercase } from "../debug/utils";
import { ProjectType, Sdks, isFlutterWorkspaceFolder, isInsideFolderNamed, isFlutterProjectFolder, isTestFile } from "../utils";
import { SdkCommands } from "../commands/sdk";
import { spawn } from "child_process";
import { FlutterTestDebugSession } from "../debug/flutter_test_debug_impl";

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
			program: isFlutter ? undefined : "${workspaceFolder}/bin/main.dart",
			request: "launch",
			type: "dart",
		}];
	}

	public resolveDebugConfiguration(folder: WorkspaceFolder | undefined, debugConfig: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {
		// If there's no program set, try to guess one.
		if (!debugConfig.program) {
			const openFile = window.activeTextEditor && window.activeTextEditor.document ? window.activeTextEditor.document.uri.fsPath : null;
			// Overwrite the folder with a more appropriate workspace root (https://github.com/Microsoft/vscode/issues/45580)
			if (openFile) {
				folder = workspace.getWorkspaceFolder(Uri.file(openFile)) || folder;
			}
			if (isTestFile(openFile) || isInsideFolderNamed(openFile, "bin") || isInsideFolderNamed(openFile, "tool")) {
				debugConfig.program = openFile;
			} else {
				// Use the open file as a clue to find the best project root, then search from there.
				const commonLaunchPaths = [
					path.join(folder.uri.fsPath, "lib", "main.dart"),
					path.join(folder.uri.fsPath, "bin", "main.dart"),
				];
				for (const launchPath of commonLaunchPaths) {
					if (fs.existsSync(launchPath)) {
						debugConfig.program = launchPath;
					}
				}
			}
		}

		// If we still don't have an entry point, the user will have to provide it.
		if (!debugConfig.program) {
			// Set type=null which causes launch.json to open.
			debugConfig.type = null;
			window.showInformationMessage("Set the 'program' value in your launch config (eg ${workspaceFolder}/bin/main.dart) then launch again");
			return debugConfig;
		}

		// If we don't have a cwd then find the best one from the project root.
		debugConfig.cwd = debugConfig.cwd || folder.uri.fsPath;

		const isFlutter = isFlutterProjectFolder(debugConfig.cwd as string);
		const isTest = isTestFile(debugConfig.program as string);
		const debugType = isFlutter
			? (isTest ? DebuggerType.FlutterTest : DebuggerType.Flutter)
			: DebuggerType.Dart;

		// TODO: This cast feels nasty?
		this.setupDebugConfig(folder, debugConfig as any as FlutterLaunchRequestArguments, isFlutter, this.deviceManager && this.deviceManager.currentDevice ? this.deviceManager.currentDevice.id : null);

		// Debugger always uses uppercase drive letters to ensure our paths have them regardless of where they came from.
		debugConfig.program = forceWindowsDriveLetterToUppercase(debugConfig.program);
		debugConfig.cwd = forceWindowsDriveLetterToUppercase(debugConfig.cwd);

		// Start port listener on launch of first debug session.
		const debugServer = this.getDebugServer(debugType);

		// Make VS Code connect to debug server instead of launching debug adapter.
		// TODO: Why do we need this cast? The node-mock-debug does not?
		(debugConfig as any).debugServer = debugServer.address().port;

		return debugConfig;
	}

	private getDebugServer(debugType: DebuggerType) {
		switch (debugType) {
			case DebuggerType.Flutter:
				return this.spawnOrGetServer("flutter", () => new FlutterDebugSession());
			case DebuggerType.FlutterTest:
				return this.spawnOrGetServer("flutterTest", () => new FlutterTestDebugSession());
			case DebuggerType.Dart:
				return this.spawnOrGetServer("dart", () => new DartDebugSession());
			default:
				throw new Error("Unknown debugger type");
		}
	}

	private spawnOrGetServer(type: string, create: () => DebugSession): net.Server {
		// Start port listener on launch of first debug session.
		if (!this.debugServers[type]) {

			// Start listening on a random port.
			this.debugServers[type] = net.createServer((socket) => {
				const session = create();
				session.setRunAsServer(true);
				session.start(socket as NodeJS.ReadableStream, socket);
			}).listen(0);
		}

		return this.debugServers[type];
	}

	private setupDebugConfig(folder: WorkspaceFolder | undefined, debugConfig: FlutterLaunchRequestArguments, isFlutter: boolean, deviceId: string) {
		this.analytics.logDebuggerStart(folder && folder.uri);

		const dartExec = isWin ? "dart.exe" : "dart";
		const flutterExec = isWin ? "flutter.bat" : "flutter";

		const conf = config.for(folder.uri);

		// Attach any properties that weren't explicitly set.
		debugConfig.type = debugConfig.type || "dart";
		debugConfig.request = debugConfig.request || "launch";
		debugConfig.cwd = forceWindowsDriveLetterToUppercase(debugConfig.cwd || folder.uri.fsPath);
		debugConfig.args = debugConfig.args || [];
		debugConfig.vmArgs = debugConfig.vmArgs || conf.vmAdditionalArgs;
		debugConfig.dartPath = debugConfig.dartPath || path.join(this.sdks.dart, "bin", dartExec);
		debugConfig.observatoryLogFile = debugConfig.observatoryLogFile || conf.observatoryLogFile;
		if (debugConfig.previewDart2 !== undefined) {
			debugConfig.previewDart2 = debugConfig.previewDart2;
		} else {
			debugConfig.previewDart2 = config.previewDart2;
		}
		debugConfig.debugSdkLibraries = debugConfig.debugSdkLibraries || conf.debugSdkLibraries;
		debugConfig.debugExternalLibraries = debugConfig.debugExternalLibraries || conf.debugExternalLibraries;
		if (debugConfig.checkedMode === undefined)
			debugConfig.checkedMode = true;
		if (isFlutter) {
			debugConfig.flutterPath = debugConfig.flutterPath || (this.sdks.flutter ? path.join(this.sdks.flutter, "bin", flutterExec) : null);
			debugConfig.flutterRunLogFile = debugConfig.flutterRunLogFile || conf.flutterRunLogFile;
			debugConfig.flutterTestLogFile = debugConfig.flutterTestLogFile || conf.flutterTestLogFile;
			debugConfig.deviceId = debugConfig.deviceId || deviceId;
		}
	}

	public dispose() {
		if (this.debugServers) {
			for (const type of Object.keys(this.debugServers)) {
				this.debugServers[type].close();
				this.debugServers[type] = null;
			}
		}
	}
}

enum DebuggerType {
	Dart,
	Flutter,
	FlutterTest,
}
