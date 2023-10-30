/// This class defines the API exposed  that is used by external tools such as
/// DevTools. The interface must match what is defined for use by those tools.
///
/// All changes to this file should be backwards-compatible and use
/// `VsCodeCapabilities` to advertise which capabilities are available and
/// handle any changes in behaviour.

import { Event } from "../../shared/events";

export interface VsCodeApi {
	capabilities: VsCodeCapabilities;
	initialize(): Promise<void>;
	devicesChanged: Event<VsCodeDevicesEvent>;
	debugSessionsChanged: Event<VsCodeDebugSessionsEvent>;
	executeCommand(command: string, args?: object[]): Promise<object | undefined>;
	selectDevice(id: string): Promise<boolean>;
	openDevToolsPage(debugSessionId: string, page: string): Promise<void>;
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
}

export interface VsCodeCapabilities {
	executeCommand: boolean;
	openDevToolsPage: boolean;
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
	vmServiceUri: string | undefined;
}
