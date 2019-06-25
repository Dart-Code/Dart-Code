import { DebugSession, DebugSessionCustomEvent } from "vscode";
import { DaemonCapabilities } from "./capabilities/flutter";
import { FlutterService, FlutterServiceExtension, LogCategory, LogSeverity } from "./enums";
import * as f from "./flutter/daemon_interfaces";
import { UnknownResponse } from "./services/interfaces";

export interface DebugCommandHandler {
	flutterExtensions: {
		serviceIsRegistered(service: FlutterService): boolean;
		serviceExtensionIsLoaded(extension: FlutterServiceExtension): boolean;
	};
	handleDebugSessionStart(session: DebugSession): void;
	handleDebugSessionEnd(session: DebugSession): void;
	handleDebugSessionCustomEvent(e: DebugSessionCustomEvent): void;
}

export interface Sdks {
	readonly dart?: string;
	readonly dartVersion?: string;
	readonly flutter?: string;
	readonly flutterVersion?: string;
	readonly dartSdkIsFromFlutter: boolean;
}

export interface StagehandTemplate {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly categories: string[];
	readonly entrypoint: string;
}

export interface Logger {
	info(message: string, category?: LogCategory): void;
	warn(message: SomeError, category?: LogCategory): void;
	error(error: SomeError, category?: LogCategory): void;
}

export type SomeError = string | Error | undefined | { message: string };

export interface LogMessage {
	readonly message: string;
	readonly severity: LogSeverity;
	readonly category: LogCategory;
}

export interface IAmDisposable {
	dispose(): void | Promise<void>;
}

export interface IFlutterDaemon extends IAmDisposable {
	capabilities: DaemonCapabilities;

	deviceEnable(): Thenable<UnknownResponse>;
	getEmulators(): Thenable<f.Emulator[]>;
	launchEmulator(emulatorId: string): Thenable<void>;
	createEmulator(name?: string): Thenable<{ success: boolean, emulatorName: string, error: string }>;
	getSupportedPlatforms(projectRoot: string): Thenable<f.SupportedPlatformsResponse>;

	registerForDaemonConnected(subscriber: (notification: f.DaemonConnected) => void): IAmDisposable;
	registerForDeviceAdded(subscriber: (notification: f.Device) => void): IAmDisposable;
	registerForDeviceRemoved(subscriber: (notification: f.Device) => void): IAmDisposable;
	registerForDaemonLogMessage(subscriber: (notification: f.DaemonLogMessage) => void): IAmDisposable;
	registerForDaemonLog(subscriber: (notification: f.DaemonLog) => void): IAmDisposable;
	registerForDaemonShowMessage(subscriber: (notification: f.ShowMessage) => void): IAmDisposable;
}
