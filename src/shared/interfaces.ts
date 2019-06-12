import { DebugSession, DebugSessionCustomEvent } from "vscode";
import { FlutterService, FlutterServiceExtension } from "./enums";

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
	dart?: string;
	dartVersion?: string;
	flutter?: string;
	flutterVersion?: string;
	dartSdkIsFromFlutter: boolean;
}

export interface StagehandTemplate {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly categories: string[];
	readonly entrypoint: string;
}
