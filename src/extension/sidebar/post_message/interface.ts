/// This class defines the API exposed  that is used by external tools such as
/// DevTools. The interface must match what is defined for use by those tools.
///
/// All changes to this file should be backwards-compatible and use
/// `VsCodeCapabilities` to advertise which capabilities are available and
/// handle any changes in behaviour.

import { Event } from "../../../shared/events";

export interface VsCodeApi {
	capabilities: VsCodeCapabilities;
	initialize(): Promise<void>;
	devicesChanged: Event<VsCodeDevicesEvent>;
	debugSessionsChanged: Event<VsCodeDebugSessionsEvent>;
	executeCommand(command: string, args?: object[]): Promise<object | undefined>;
	selectDevice(id: string | undefined): Promise<boolean>;
	enablePlatformType(platformType: string): Promise<boolean>;
	openDevToolsPage(
		debugSessionId: string | undefined,
		pageId: string | undefined,
		forceExternal: boolean | undefined,
		requiresDebugSession: boolean | undefined,
		prefersDebugSession: boolean | undefined,
	): Promise<void>;
	hotReload(debugSessionId: string): Promise<void>;
	hotRestart(debugSessionId: string): Promise<void>;
}

export interface VsCodeDevice {
	id: string;
	name: string;
	rawDeviceName: string;
	category: string | undefined;
	emulator: boolean;
	emulatorId: string | undefined;
	ephemeral: boolean;
	platform: string;
	platformType: string | undefined;
}

export interface VsCodeDevicesEvent {
	selectedDeviceId: string | undefined;
	devices: VsCodeDevice[]
	unsupportedDevices: VsCodeDevice[]
}

export interface VsCodeCapabilities {
	executeCommand: boolean;
	openDevToolsPage: boolean;
	openDevToolsExternally: boolean;
	openDevToolsWithOptionalDebugSessionFlags: boolean;
	selectDevice: boolean;
	hotReload: boolean;
	hotRestart: boolean;
}

export interface VsCodeDebugSessionsEvent {
	sessions: VsCodeDebugSession[]
}

export interface VsCodeDebugSession {
	debuggerType: string | undefined;
	flutterDeviceId: string | undefined;
	flutterMode: string | undefined;
	id: string;
	name: string;
	projectRootPath: string | undefined;
	vmServiceUri: string | undefined;
}
