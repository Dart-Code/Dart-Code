"use strict";

import * as path from "path";
import { analytics } from "../analytics";
import { config } from "../config";
import { DebugConfigurationProvider, WorkspaceFolder, CancellationToken, DebugConfiguration, ProviderResult } from "vscode";
import { FlutterLaunchRequestArguments, isWin } from "../debug/utils";
import { sdks, ProjectType } from "../utils";
import { FlutterDeviceManager } from "../flutter/device_manager";
import { SdkCommands } from "../commands/sdk";

export const DART_CLI_DEBUG_TYPE = "dart-cli";
export const FLUTTER_DEBUG_TYPE = "flutter";

export class DebugConfigProvider implements DebugConfigurationProvider {
	private debugType: String;
	private deviceManager: FlutterDeviceManager;

	constructor(debugType: String, deviceManager: FlutterDeviceManager) {
		this.debugType = debugType;
		this.deviceManager = deviceManager;
	}

	// TODO: This file has two ways of knowing whether it's a Flutter debug session - this.debugType and util.isFlutterProject.
	// Hopefully these will always match, but since a user can edit launch.json it's not guaranteed. We should probably
	// do something to consolidate these and/or reject when the launch config doesn't match the proejct type.

	provideDebugConfigurations(folder: WorkspaceFolder | undefined, token?: CancellationToken): ProviderResult<DebugConfiguration[]> {
		if (this.debugType == DART_CLI_DEBUG_TYPE)
			return [{
				"name": "Dart command line",
				"type": "dart-cli",
				"request": "launch",
				"program": "${workspaceRoot}/bin/main.dart"
			}];
		else if (this.debugType == FLUTTER_DEBUG_TYPE)
			return [{
				"name": "Flutter mobile app",
				"type": "flutter",
				"request": "launch"
			}];
	}

	resolveDebugConfiguration(folder: WorkspaceFolder | undefined, debugConfig: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {
		// TODO: This cast feels nasty?
		this.setupDebugConfig(folder, <FlutterLaunchRequestArguments><any>debugConfig, this.deviceManager && this.deviceManager.currentDevice ? this.deviceManager.currentDevice.id : null);

		if (sdks.projectType == ProjectType.Flutter)
			debugConfig.program = debugConfig.program || "${workspaceRoot}/lib/main.dart"; // Set Flutter default path.

		return debugConfig;
	}

	private setupDebugConfig(folder: WorkspaceFolder | undefined, debugConfig: FlutterLaunchRequestArguments, deviceId: string) {
		analytics.logDebuggerStart(folder && folder.uri);

		const dartExec = isWin ? "dart.exe" : "dart";
		const flutterExec = isWin ? "flutter.bat" : "flutter";

		const conf = config.for(folder.uri);

		// Attach any properties that weren't explicitly set.
		debugConfig.cwd = debugConfig.cwd || "${workspaceRoot}";
		debugConfig.args = debugConfig.args || [];
		debugConfig.dartPath = debugConfig.dartPath || path.join(sdks.dart, "bin", dartExec);
		debugConfig.observatoryLogFile = debugConfig.observatoryLogFile || conf.observatoryLogFile;
		debugConfig.debugSdkLibraries = debugConfig.debugSdkLibraries || conf.debugSdkLibraries;
		debugConfig.debugExternalLibraries = debugConfig.debugExternalLibraries || conf.debugExternalLibraries;
		if (debugConfig.checkedMode === undefined)
			debugConfig.checkedMode = true;
		debugConfig.flutterPath = debugConfig.flutterPath || (sdks.flutter ? path.join(sdks.flutter, "bin", flutterExec) : null);
		debugConfig.flutterRunLogFile = debugConfig.flutterRunLogFile || conf.flutterRunLogFile;
		debugConfig.deviceId = debugConfig.deviceId || deviceId;
	}
}
