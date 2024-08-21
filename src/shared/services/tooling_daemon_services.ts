export interface DtdResult { type: string }
export interface DtdError {
	code: number,
	message: string,
	data: any,
}
export type DtdSuccess = DtdResult & { type: "Success" };
export interface DtdMessage { jsonrpc: "2.0", id?: string, method?: string, result?: DtdResult, error?: DtdError, params?: unknown }
export type DtdResponse = DtdMessage & ({ result: DtdResult } | { error: DtdError });

export interface DtdRequest {
	jsonrpc: "2.0",
	id: string;
	method: string;
	params?: object;
}

export interface DtdNotification {
	jsonrpc: "2.0",
	id: string;
	method: "streamNotify";
	params: {
		streamId: string,
		eventKind: string,
		eventData: ServiceRegisteredEventData | ServiceUnregisteredEventData | any,
	};
}

export interface ServiceRegisteredEventData {
	service: string,
	method: string,
	capabilities?: any,
}

export interface ServiceUnregisteredEventData {
	service: string,
	method: string,
}

export enum Service {
	Editor,
}

export enum Stream {
	Editor,
	Service,
	Lsp,
}

export enum ServiceMethod {
	registerService = "registerService",
	setIDEWorkspaceRoots = "FileSystem.setIDEWorkspaceRoots",
	getIDEWorkspaceRoots = "FileSystem.getIDEWorkspaceRoots",
	readFileAsString = "FileSystem.readFileAsString",
	streamListen = "streamListen",
	streamCancel = "streamCancel",
}

export interface RegisterServiceParams {
	service: string;
	method: string;
	capabilities?: object;
}
export type RegisterServiceResult = DtdSuccess;

export interface SetIDEWorkspaceRootsParams {
	secret: string;
	roots: string[];
}
export type SetIDEWorkspaceRootsResult = DtdSuccess;

export type GetIDEWorkspaceRootsParams = void;
export interface GetIDEWorkspaceRootsResult {
	type: "IDEWorkspaceRoots",
	ideWorkspaceRoots: string[];
}

export interface ReadFileAsStringParams {
	uri: string;
}
export interface ReadFileAsStringResult {
	type: "FileContent",
	content: string;
}


export interface GetDevicesResult {
	type: "GetDevicesResult";
	devices: EditorDevice[];
	selectedDeviceId?: string;
}

export interface GetDebugSessionsResult {
	type: "GetDebugSessionsResult";
	debugSessions: EditorDebugSession[];
}

export interface SelectDeviceParams {
	deviceId?: string;
}

export interface EnablePlatformTypeParams {
	platformType: string;
}

export interface HotReloadParams {
	debugSessionId: string;
}

export interface HotRestartParams {
	debugSessionId: string;
}

export interface OpenDevToolsPageParams {
	debugSessionId?: string;
	page?: string;
	forceExternal?: boolean;
	requiresDebugSession?: boolean;
	prefersDebugSession?: boolean;
}

export interface SuccessResult {
	type: "Success";
}

export interface EditorDevice {
	id: string;
	name: string;
	category?: string;
	emulator: boolean;
	emulatorId?: string;
	ephemeral: boolean;
	platform: string;
	platformType?: string;
	supported: boolean;
	rawDeviceName?: string;
}

export interface EditorDebugSession {
	id: string;
	name: string;
	vmServiceUri?: string;
	flutterMode?: string;
	flutterDeviceId?: string;
	debuggerType?: string;
	projectRootPath?: string;
}

export enum EventKind {
	deviceAdded,
	deviceRemoved,
	deviceChanged,
	deviceSelected,
	debugSessionStarted,
	debugSessionChanged,
	debugSessionStopped,
}

export interface Event {
	kind: EventKind;
	[key: string]: any;
}

export interface DeviceAddedEvent extends Event {
	kind: EventKind.deviceAdded;
	device: EditorDevice;
}

export interface DeviceChangedEvent extends Event {
	kind: EventKind.deviceChanged;
	device: EditorDevice;
}

export interface DeviceRemovedEvent extends Event {
	kind: EventKind.deviceRemoved;
	deviceId: string;
}

export interface DeviceSelectedEvent extends Event {
	kind: EventKind.deviceSelected;
	deviceId?: string;
}

export interface DebugSessionStartedEvent extends Event {
	kind: EventKind.debugSessionStarted;
	debugSession: EditorDebugSession;
}

export interface DebugSessionChangedEvent extends Event {
	kind: EventKind.debugSessionChanged;
	debugSession: EditorDebugSession;
}

export interface DebugSessionStoppedEvent extends Event {
	kind: EventKind.debugSessionStopped;
	debugSessionId: string;
}
