"use strict";

export interface Device {
	id: string;
	name: string;
	platform: string;
	emulator: boolean;
}

export interface AppStart {
	appId: string;
	deviceId: string;
	directory: string;
	supportsRestart?: boolean;
}

export interface AppEvent {
	appId: string;
}

export interface AppDebugPort extends AppEvent {
	port: number;
	wsUri?: string;
	baseUri?: string;
}
