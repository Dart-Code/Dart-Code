import { DebugSession, DebugSessionCustomEvent } from "vscode";
import { FlutterService, FlutterServiceExtension, LogCategory, LogSeverity } from "./enums";

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
	logInfo(message: string, category?: LogCategory): void;
	logWarn(message: SomeError, category?: LogCategory): void;
	logError(error: SomeError, category?: LogCategory): void;
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
