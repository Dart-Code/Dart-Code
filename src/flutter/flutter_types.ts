export interface Device {
	id: string;
	name: string;
	platform: string;
	emulator: boolean;
}

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
}
