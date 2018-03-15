import * as path from "path";
import * as net from "net";
import { Analytics } from "../analytics";
import { config } from "../config";
import { DartDebugSession } from "../debug/dart_debug_impl";
import { DebugConfigurationProvider, WorkspaceFolder, CancellationToken, DebugConfiguration, ProviderResult, commands, window } from "vscode";
import { DebugSession } from "vscode-debugadapter";
import { FlutterDebugSession } from "../debug/flutter_debug_impl";
import { FlutterDeviceManager } from "../flutter/device_manager";
import { FlutterLaunchRequestArguments, isWin } from "../debug/utils";
import { ProjectType, Sdks, isFlutterProject } from "../utils";
import { SdkCommands } from "../commands/sdk";
import { spawn } from "child_process";

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
		const isFlutter = isFlutterProject(folder);
		return [{
			name: isFlutter ? "Flutter" : "Dart",
			program: isFlutter ? undefined : "${workspaceRoot}/bin/main.dart",
			request: "launch",
			type: "dart",
		}];
	}

	public resolveDebugConfiguration(folder: WorkspaceFolder | undefined, debugConfig: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {
		const isFlutter = isFlutterProject(folder);
		// TODO: This cast feels nasty?
		this.setupDebugConfig(folder, debugConfig as any as FlutterLaunchRequestArguments, isFlutter, this.deviceManager && this.deviceManager.currentDevice ? this.deviceManager.currentDevice.id : null);

		if (isFlutter)
			debugConfig.program = debugConfig.program || "${workspaceRoot}/lib/main.dart"; // Set Flutter default path.
		else if (!debugConfig.program) {
			// For Dart projects that don't have a program, we can't launch, so we perform set type=null which causes launch.json
			// to open.
			debugConfig.type = null;
			window.showInformationMessage("Set the 'program' value in your launch config (eg ${workspaceRoot}/bin/main.dart) then launch again");
			return debugConfig;
		}

		// Start port listener on launch of first debug session.
		const debugServer = isFlutter
			? this.getServer("flutter", () => new FlutterDebugSession())
			: this.getServer("dart", () => new DartDebugSession());

		// Make VS Code connect to debug server instead of launching debug adapter.
		// TODO: Why do we need this cast? The node-mock-debug does not?
		(debugConfig as any).debugServer = debugServer.address().port;
		return debugConfig;
	}

	private getServer(type: string, create: () => DebugSession): net.Server {
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
		debugConfig.cwd = debugConfig.cwd || "${workspaceRoot}";
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
