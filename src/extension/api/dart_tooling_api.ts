import * as vs from "vscode";
import { restartReasonManual } from "../../shared/constants";
import { DebuggerType } from "../../shared/enums";
import { Device } from "../../shared/flutter/daemon_interfaces";
import { IAmDisposable } from "../../shared/interfaces";
import { disposeAll, nullToUndefined } from "../../shared/utils";
import { FlutterDeviceManager } from "../../shared/vscode/device_manager";
import { debugSessions, debugSessionsChanged } from "../commands/debug";
import { DartDebugSessionInformation } from "../utils/vscode/debug";
import { VsCodeApi, VsCodeCapabilities, VsCodeDebugSession, VsCodeDebugSessionsEvent, VsCodeDevice, VsCodeDevicesEvent } from "./interface";

const apiDebugMode = false;

export class DartApi implements IAmDisposable {
	protected readonly disposables: vs.Disposable[] = [];
	private apis: { [key: string]: ToolApi } = {};

	constructor(readonly commandSource: string, onReceiveMessage: vs.Event<any>, private readonly post: (message: any) => void, private readonly deviceManager: FlutterDeviceManager | undefined) {
		const addApi = (api: ToolApi) => this.apis[api.apiName] = api;
		addApi(new VsCodeApiHandler(this, commandSource, deviceManager));

		this.disposables.push(onReceiveMessage(this.handleMessage, this));
	}

	public postMessage(message: any): void {
		this.post({ jsonrpc: "2.0", ...message });
	}

	private async handleMessage(message: any): Promise<void> {
		if (apiDebugMode)
			console.log(`VS CODE GOT: ${JSON.stringify(message)}`);

		const method = message.method;
		if (typeof method !== "string") return;

		const apiName = method.split(".")[0];
		const methodName = method.substring(apiName.length + 1);
		const handler = this.apis[apiName];
		if (!handler) {
			if (message.id) {
				this.postMessage({ id: message.id, error: "No handler for '${apiName}' API" });
			}
			return;
		}

		try {
			const result = await handler.handleRequest(methodName, message.params);
			if (message.id !== undefined) {
				this.postMessage({ id: message.id, result: result ?? null });
			}
		} catch (e) {
			if (message.id !== undefined) {
				this.postMessage({ id: message.id, error: `${e}` });
			}
		}
	}

	public dispose(): any {
		disposeAll(this.disposables);
		disposeAll(Object.values(this.apis));
	}
}

abstract class ToolApi {
	protected readonly disposables: vs.Disposable[] = [];
	abstract apiName: string;

	constructor(private readonly dartApi: DartApi) { }

	abstract handleRequest(method: string, params: any): Promise<any>;

	public sendEvent(method: string, params: any) {
		this.dartApi.postMessage({ method: `${this.apiName}.${method}`, params });
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

class VsCodeApiHandler extends ToolApi {
	private readonly api: VsCodeApi;
	constructor(dartApi: DartApi, commandSource: string, deviceManager: FlutterDeviceManager | undefined) {
		super(dartApi);
		const api = this.api = new VsCodeApiImpl(commandSource, deviceManager);
		this.disposables.push(api.devicesChanged((e) => this.sendEvent("devicesChanged", e)));
		this.disposables.push(api.debugSessionsChanged((e) => this.sendEvent("debugSessionsChanged", e)));
	}

	readonly apiName = "vsCode";

	public async handleRequest(method: string, params: any): Promise<any> {
		if (method === "getCapabilities") {
			return this.api.capabilities;
		} else if (method === "initialize") {
			return await this.api.initialize();
		} else if (method === "selectDevice") {
			return this.api.selectDevice(params.id as string);
		} else if (method === "openDevToolsPage") {
			return this.api.openDevToolsPage(params.debugSessionId as string, params.page as string);
		} else if (method === "hotReload") {
			return this.api.hotReload(params.debugSessionId as string);
		} else if (method === "hotRestart") {
			return this.api.hotRestart(params.debugSessionId as string);
		} else if (method === "executeCommand") {
			return await this.api.executeCommand(params.command as string, params.arguments as object[] | undefined);
		}
	}
}

class VsCodeApiImpl implements VsCodeApi, IAmDisposable {
	protected readonly devicesChangedEmitter = new vs.EventEmitter<VsCodeDevicesEvent>();
	public readonly devicesChanged = this.devicesChangedEmitter.event;
	protected readonly debugSessionsChangedEmitter = new vs.EventEmitter<VsCodeDebugSessionsEvent>();
	public readonly debugSessionsChanged = this.debugSessionsChangedEmitter.event;
	protected readonly disposables: vs.Disposable[] = [];

	constructor(private readonly commandSource: string, private readonly deviceManager: FlutterDeviceManager | undefined) {
		if (deviceManager) {
			this.disposables.push(deviceManager?.onCurrentDeviceChanged(this.onDevicesChanged, this));
			this.disposables.push(deviceManager?.onDevicesChanged(this.onDevicesChanged, this));
			this.disposables.push(debugSessionsChanged(this.onDebugSessionsChanged, this));
		}
	}

	readonly capabilities: VsCodeCapabilities = {
		executeCommand: true,
		hotReload: true,
		hotRestart: true,
		openDevToolsPage: true,
		selectDevice: true,
	};

	public async initialize() {
		// Trigger initial events to get the client the existing data from before they
		// started listening.
		this.onDevicesChanged();
		this.onDebugSessionsChanged();
	}

	public async executeCommand(command: string, args?: object[] | undefined): Promise<object | undefined> {
		return await vs.commands.executeCommand(command, { commandSource: this.commandSource, ...args });
	}

	public async selectDevice(id: string): Promise<boolean> {
		return this.deviceManager?.selectDeviceById(id) ?? false;
	}

	public async openDevToolsPage(debugSessionId: string, pageId: string): Promise<void> {
		return vs.commands.executeCommand("dart.openDevTools", { debugSessionId, pageId, commandSource: this.commandSource });
	}

	public async hotReload(debugSessionId: string): Promise<void> {
		const session = debugSessions.find((s) => s.session.id === debugSessionId);
		if (!session)
			return;

		await session.session.customRequest("hotReload", { reason: restartReasonManual });
	}

	public async hotRestart(debugSessionId: string): Promise<void> {
		const session = debugSessions.find((s) => s.session.id === debugSessionId);
		if (!session)
			return;

		await session.session.customRequest("hotRestart", { reason: restartReasonManual });
	}

	private onDevicesChanged(): any {
		this.devicesChangedEmitter.fire(
			{
				devices: this.deviceManager?.getDevicesSortedByName().map((d) => this.asApiDevice(d)) ?? [],
				selectedDeviceId: this.deviceManager?.currentDevice?.id,
			},
		);
	}

	private onDebugSessionsChanged(): any {
		this.debugSessionsChangedEmitter.fire(
			{
				sessions: debugSessions.map((d) => this.asApiDebugSession(d)),
			},
		);
	}

	private asApiDevice(device: Device): VsCodeDevice {
		return {
			category: nullToUndefined(device.category),
			emulator: !!device.emulator,
			emulatorId: nullToUndefined(device.emulatorId),
			ephemeral: !!device.ephemeral,
			id: device.id,
			name: device.name,
			platform: device.platform,
			platformType: nullToUndefined(device.platformType),
		};
	}

	private asApiDebugSession(session: DartDebugSessionInformation): VsCodeDebugSession {
		return {
			debuggerType: DebuggerType[session.debuggerType],
			flutterDeviceId: session.flutterDeviceId,
			flutterMode: session.flutterMode,
			id: session.session.id,
			name: session.session.name,
			vmServiceUri: session.vmServiceUri,
		};
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
