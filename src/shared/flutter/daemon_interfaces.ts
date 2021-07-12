export type PlatformType = "android" | "ios" | "linux" | "macos" | "fuchsia" | "windows" | "web" | string;
export type Category = "mobile" | "web" | "desktop" | string;

export interface Device {
	category: Category | undefined | null;
	emulator: boolean;
	emulatorId: string | undefined | null;
	ephemeral: boolean | undefined;
	id: string;
	name: string;
	platform: string;
	platformType: PlatformType | undefined | null;
	type: "device";
	coldBoot?: boolean;
}

export interface FlutterEmulator {
	id: string;
	name: string;
	category?: Category | undefined | null;
	platformType?: PlatformType | undefined | null;
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

export interface DaemonLog {
	error: boolean;
	log: string;
}

export interface ShowMessage {
	level: "info" | "warning" | "error";
	title: string;
	message: string;
}

export interface SupportedPlatformsResponse {
	platforms: PlatformType[];
}

export interface ServeDevToolsResponse {
	host: string | null;
	port: string | null;
}
