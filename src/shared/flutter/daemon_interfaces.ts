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

export interface DaemonLogMessage {
	level: "info" | "warning" | "error";
	message: string;
	stackTrace?: string;
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
	platforms?: PlatformType[]; // Legacy, removed in https://github.com/flutter/flutter/issues/140473
	platformTypes: Record<PlatformType, { isSupported: boolean }> | undefined; // Supported since 2023
}

export interface ServeDevToolsResponse {
	host: string | null;
	port: string | null;
}
