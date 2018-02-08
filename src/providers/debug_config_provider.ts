"use strict";

import * as path from "path";
import { Analytics } from "../analytics";
import { config } from "../config";
import { DebugConfigurationProvider, WorkspaceFolder, CancellationToken, DebugConfiguration, ProviderResult, commands } from "vscode";
import { FlutterLaunchRequestArguments, isWin } from "../debug/utils";
import { ProjectType, Sdks, isFlutterProject } from "../utils";
import { FlutterDeviceManager } from "../flutter/device_manager";
import { SdkCommands } from "../commands/sdk";

export class DebugConfigProvider implements DebugConfigurationProvider {
	private sdks: Sdks;
	private analytics: Analytics;
	private deviceManager: FlutterDeviceManager;

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
		// TODO: This cast feels nasty?
		this.setupDebugConfig(folder, debugConfig as any as FlutterLaunchRequestArguments, this.deviceManager && this.deviceManager.currentDevice ? this.deviceManager.currentDevice.id : null);

		if (isFlutterProject(folder))
			debugConfig.program = debugConfig.program || "${workspaceRoot}/lib/main.dart"; // Set Flutter default path.
		else if (!debugConfig.program) {
			// For Dart projects that don't have a program, we can't launch, so we perform this hack to get the launch.json
			// to open. Really we should somehow prompt the user for a file here (or if the current file is inside bin/test/tool
			// assume that it's good).
			debugConfig.type = null;
			commands.executeCommand("workbench.action.debug.configure");
		}

		return debugConfig;
	}

	private setupDebugConfig(folder: WorkspaceFolder | undefined, debugConfig: FlutterLaunchRequestArguments, deviceId: string) {
		this.analytics.logDebuggerStart(folder && folder.uri);

		const dartExec = isWin ? "dart.exe" : "dart";
		const flutterExec = isWin ? "flutter.bat" : "flutter";

		const conf = config.for(folder.uri);

		// Attach any properties that weren't explicitly set.
		debugConfig.type = debugConfig.type || "dart";
		debugConfig.request = debugConfig.request || "launch";
		debugConfig.cwd = debugConfig.cwd || "${workspaceRoot}";
		debugConfig.args = debugConfig.args || [];
		debugConfig.dartPath = debugConfig.dartPath || path.join(this.sdks.dart, "bin", dartExec);
		debugConfig.observatoryLogFile = debugConfig.observatoryLogFile || conf.observatoryLogFile;
		debugConfig.debugSdkLibraries = debugConfig.debugSdkLibraries || conf.debugSdkLibraries;
		debugConfig.debugExternalLibraries = debugConfig.debugExternalLibraries || conf.debugExternalLibraries;
		if (debugConfig.checkedMode === undefined)
			debugConfig.checkedMode = true;
		debugConfig.flutterPath = debugConfig.flutterPath || (this.sdks.flutter ? path.join(this.sdks.flutter, "bin", flutterExec) : null);
		debugConfig.flutterRunLogFile = debugConfig.flutterRunLogFile || conf.flutterRunLogFile;
		debugConfig.deviceId = debugConfig.deviceId || deviceId;
	}
}
