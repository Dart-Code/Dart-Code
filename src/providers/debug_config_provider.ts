"use strict";

import * as path from "path";
import { Analytics } from "../analytics";
import { config } from "../config";
import { DebugConfigurationProvider, WorkspaceFolder, CancellationToken, DebugConfiguration, ProviderResult, commands } from "vscode";
import { FlutterLaunchRequestArguments, isWin } from "../debug/utils";
import { ProjectType, Sdks } from "../utils";
import { FlutterDeviceManager } from "../flutter/device_manager";
import { SdkCommands } from "../commands/sdk";

export const DART_CLI_DEBUG_TYPE = "dart-cli";
export const FLUTTER_DEBUG_TYPE = "flutter";

export class DebugConfigProvider implements DebugConfigurationProvider {
	private sdks: Sdks;
	private analytics: Analytics;
	private debugType: string;
	private deviceManager: FlutterDeviceManager;

	constructor(sdks: Sdks, analytics: Analytics, debugType: string, deviceManager: FlutterDeviceManager) {
		this.sdks = sdks;
		this.analytics = analytics;
		this.debugType = debugType;
		this.deviceManager = deviceManager;
	}

	// TODO: This file has two ways of knowing whether it's a Flutter debug session - this.debugType and util.isFlutterProject.
	// Hopefully these will always match, but since a user can edit launch.json it's not guaranteed. We should probably
	// do something to consolidate these and/or reject when the launch config doesn't match the proejct type.

	public provideDebugConfigurations(folder: WorkspaceFolder | undefined, token?: CancellationToken): ProviderResult<DebugConfiguration[]> {
		if (this.debugType === DART_CLI_DEBUG_TYPE)
			return [{
				name: "Dart command line",
				program: "${workspaceRoot}/bin/main.dart",
				request: "launch",
				type: "dart-cli",
			}];
		else if (this.debugType === FLUTTER_DEBUG_TYPE)
			return [{
				name: "Flutter mobile app",
				request: "launch",
				type: "flutter",
			}];
	}

	public resolveDebugConfiguration(folder: WorkspaceFolder | undefined, debugConfig: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {
		// TODO: This cast feels nasty?
		this.setupDebugConfig(folder, debugConfig as any as FlutterLaunchRequestArguments, this.deviceManager && this.deviceManager.currentDevice ? this.deviceManager.currentDevice.id : null);

		if (this.sdks.projectType === ProjectType.Flutter)
			debugConfig.program = debugConfig.program || "${workspaceRoot}/lib/main.dart"; // Set Flutter default path.

		if (!debugConfig.type) {
			// Workaround for https://github.com/Microsoft/vscode/issues/43133
			// In Code 1.20, launch.json no longer opens automatically when we return from this
			// methods, it just launches the debugger. There are two issues with this:
			// 1. We don't know the launch script (for Dart, at least)
			// 2. It doesn't write a launch.json, so the user is asked for Dart/Flutter each time
			// As a workaround, when type is null (which is a bug we will fix) we force the launch.json
			// to open, which avoids the extra prompts in future. Unfortuantely this results in two
			// prompts of the debug type (environment?) selection but it's the best we have until
			// the bug above is fixed.
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
