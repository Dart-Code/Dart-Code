export interface DaemonConnected {
	version: string;
	pid: number;
}

export interface AppStart extends AppEvent {
	deviceId: string;
	directory: string;
	supportsRestart?: boolean;
}

export interface AppEvent {
	appId: string;
}

export interface AppDebugPort extends AppEvent {
	wsUri: string;
	baseUri?: string;
}

export interface AppProgress extends AppEvent {
	message?: string;
	finished?: boolean;
	id: number;
	progressId: string;
}

export interface AppWebLaunchUrl extends AppEvent {
	url: string;
	launched: boolean;
}

export interface DaemonLogMessage {
	level: "info" | "warning" | "error";
	message: string;
	stackTrace?: string;
}

export interface AppLog {
	error: boolean;
	log: string;
}
