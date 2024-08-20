/* eslint-disable @typescript-eslint/unified-signatures */
import * as path from "path";
import * as ws from "ws";
import { dartVMPath, tenMinutesInMs } from "../constants";
import { LogCategory } from "../enums";
import { DartSdks, IAmDisposable, Logger } from "../interfaces";
import { CategoryLogger } from "../logging";
import { PromiseCompleter, PromiseOr, disposeAll } from "../utils";
import { UnknownNotification } from "./interfaces";
import { StdIOService } from "./stdio_service";
import { DebugSessionChangedEvent, DebugSessionStartedEvent, DebugSessionStoppedEvent, DeviceAddedEvent, DeviceChangedEvent, DeviceRemovedEvent, DeviceSelectedEvent, DtdMessage, DtdRequest, DtdResponse, DtdResult, EnablePlatformTypeParams, Event, EventKind, GetDebugSessionsResult, GetDevicesResult, GetIDEWorkspaceRootsParams, GetIDEWorkspaceRootsResult, HotReloadParams, HotRestartParams, OpenDevToolsPageParams, ReadFileAsStringParams, ReadFileAsStringResult, RegisterServiceParams, RegisterServiceResult, SelectDeviceParams, Service, ServiceMethod, SetIDEWorkspaceRootsParams, SetIDEWorkspaceRootsResult, Stream, SuccessResult } from "./tooling_daemon_services";

export class DartToolingDaemon implements IAmDisposable {
	protected readonly disposables: IAmDisposable[] = [];
	private readonly logger: CategoryLogger;

	private readonly dtdProcess: DartToolingDaemonProcess;
	private connection: ConnectionInfo | undefined;
	private nextId = 1;
	private completers: { [key: string]: PromiseCompleter<DtdResult> } = {};
	private serviceHandlers: { [key: string]: (params?: object) => PromiseOr<DtdResult> } = {};

	private hasShownTerminatedError = false;
	private isShuttingDown = false;

	private connectedCompleter = new PromiseCompleter<ConnectionInfo | undefined>();
	public get connected() { return this.connectedCompleter.promise; }

	constructor(
		logger: Logger,
		sdks: DartSdks,
		maxLogLineLength: number | undefined,
		getToolEnv: () => any,
		private readonly promptToReloadExtension: (prompt?: string, buttonText?: string, offerLog?: boolean) => Promise<void>,
	) {
		this.logger = new CategoryLogger(logger, LogCategory.DartToolingDaemon);
		this.dtdProcess = new DartToolingDaemonProcess(this.logger, sdks, maxLogLineLength, getToolEnv);
		this.disposables.push(this.dtdProcess);

		void this.dtdProcess.dtdUri.then(() => this.connect());
		void this.dtdProcess.processExit.then(() => this.handleClose());
	}

	public get dtdUri(): Promise<string | undefined> {
		return this.dtdProcess.dtdUri;
	}

	private async connect() {
		const dtdUri = await this.dtdProcess.dtdUri;
		if (!dtdUri)
			return;
		const dtdSecret = await this.dtdProcess.dtdSecret;

		this.logger.info(`Connecting to DTD at ${dtdUri}...`);
		const socket = new ws.WebSocket(dtdUri, { followRedirects: true });
		socket.on("open", () => this.handleOpen());
		socket.on("message", (data) => this.handleData(data.toString()));
		socket.on("close", () => this.handleClose());
		socket.on("error", (e) => this.handleError(e));

		this.connection = { socket, dtdUri, dtdSecret };
	}

	private handleOpen() {
		this.logger.info(`Connected to DTD`);
		this.connectedCompleter.resolve(this.connection);
	}

	protected async sendWorkspaceFolders(workspaceFolderUris: string[]): Promise<void> {
		const connection = await this.connected;
		if (connection) {
			const secret = connection.dtdSecret;
			await this.callMethod(ServiceMethod.setIDEWorkspaceRoots, { secret, roots: workspaceFolderUris });
		}
	}

	private async handleData(data: string) {
		this.logTraffic(`<== ${data}\n`);
		const json = JSON.parse(data) as DtdMessage;
		const id = json.id;
		const method = json.method;

		if (id !== undefined && method) {
			const request = json as DtdRequest;
			// Handle service request.
			const serviceHandler = this.serviceHandlers[method];
			if (serviceHandler) {
				const result = await serviceHandler(request.params);
				await this.send({
					id,
					jsonrpc: "2.0",
					result,
				});
			}

		} else if (id) {
			// Handle response.
			const completer: PromiseCompleter<DtdResult> = this.completers[id];
			const response = json as DtdResponse;

			if (completer) {
				delete this.completers[id];

				if ("error" in response)
					completer.reject(response.error);
				else
					completer.resolve(response.result);
			}
		}
	}

	public async registerService(service: Service.Editor, method: "getDevices", capabilities: object | undefined, f: () => PromiseOr<DtdResult & GetDevicesResult>): Promise<void>;
	public async registerService(service: Service.Editor, method: "selectDevice", capabilities: object | undefined, f: (params: SelectDeviceParams) => PromiseOr<DtdResult & SuccessResult>): Promise<void>;
	public async registerService(service: Service.Editor, method: "enablePlatformType", capabilities: object | undefined, f: (params: EnablePlatformTypeParams) => PromiseOr<DtdResult & SuccessResult>): Promise<void>;
	public async registerService(service: Service.Editor, method: "getDebugSessions", capabilities: object | undefined, f: () => PromiseOr<DtdResult & GetDebugSessionsResult>): Promise<void>;
	public async registerService(service: Service.Editor, method: "hotReload", capabilities: object | undefined, f: (params: HotReloadParams) => PromiseOr<DtdResult & SuccessResult>): Promise<void>;
	public async registerService(service: Service.Editor, method: "hotRestart", capabilities: object | undefined, f: (params: HotRestartParams) => PromiseOr<DtdResult & SuccessResult>): Promise<void>;
	public async registerService(service: Service.Editor, method: "openDevToolsPage", capabilities: object | undefined, f: (params: OpenDevToolsPageParams) => PromiseOr<DtdResult & SuccessResult>): Promise<void>;
	public async registerService(service: Service, method: string, capabilities: object | undefined, f: (params: any) => PromiseOr<DtdResult>): Promise<void> {
		const serviceName = Service[service];
		const resp = await this.callMethod(ServiceMethod.registerService, { service: serviceName, method, capabilities });
		if (resp.type !== "Success") {
			throw new Error(`Failed to register service ${serviceName}.${method}: ${resp.type}`);
		}

		this.serviceHandlers[`${serviceName}.${method}`] = f;
	}

	public callMethod(service: ServiceMethod.registerService, params: RegisterServiceParams): Promise<RegisterServiceResult>;
	public callMethod(service: ServiceMethod.setIDEWorkspaceRoots, params: SetIDEWorkspaceRootsParams): Promise<SetIDEWorkspaceRootsResult>;
	public callMethod(service: ServiceMethod.getIDEWorkspaceRoots, params: GetIDEWorkspaceRootsParams): Promise<GetIDEWorkspaceRootsResult>;
	public callMethod(service: ServiceMethod.readFileAsString, params: ReadFileAsStringParams): Promise<ReadFileAsStringResult>;
	public callMethod(service: string, params?: unknown): Promise<DtdResult>;
	public async callMethod(method: ServiceMethod, params?: unknown): Promise<DtdResult> {
		if (!this.connection)
			return Promise.reject("DTD connection is unavailable");

		const id = `${this.nextId++}`;
		const completer = new PromiseCompleter<DtdResult>();
		this.completers[id] = completer;

		await this.send({
			id,
			jsonrpc: "2.0",
			method,
			params,
		});

		return completer.promise;
	}

	public sendEvent(stream: Stream.Editor, params: DeviceAddedEvent | DeviceRemovedEvent | DeviceChangedEvent | DeviceSelectedEvent): void;
	public sendEvent(stream: Stream.Editor, params: DebugSessionStartedEvent | DebugSessionStoppedEvent | DebugSessionChangedEvent): void;
	public sendEvent(stream: Stream, params: Event): void {
		if (!this.connection)
			throw Error("DTD connection is unavailable");

		void this.send({
			jsonrpc: "2.0",
			method: "postEvent",
			params: {
				eventData: { ...params, kind: undefined },
				eventKind: EventKind[params.kind],
				streamId: Stream[stream],
			},
		});
	}

	private send(json: DtdMessage) {
		if (!this.connection)
			return Promise.reject("DTD connection is unavailable");

		const str = JSON.stringify(json);
		this.logTraffic(`==> ${str}\n`);
		this.connection.socket.send(str);
	}

	protected handleClose() {
		this.logger.info(`DTD connection closed`);
		if (!this.isShuttingDown && !this.hasShownTerminatedError) {
			const which = this.dtdProcess.hasTerminated ? "process" : "connection";
			this.showTerminatedError(which, this.dtdProcess.hasReceivedConnectionInfo ? "has terminated" : "failed to start");
		}

		this.dispose();
	}

	private handleError(e: Error) {
		this.logger.error(`${e}`);
	}

	private logTraffic(message: string) {
		this.logger.info(message);
	}

	private lastShownTerminatedError: number | undefined;
	private readonly noRepeatTerminatedErrorThresholdMs = tenMinutesInMs;
	private showTerminatedError(which: "connection" | "process", message: string) {
		// Don't show this notification if we've shown it recently.
		if (this.lastShownTerminatedError && Date.now() - this.lastShownTerminatedError < this.noRepeatTerminatedErrorThresholdMs)
			return;

		this.lastShownTerminatedError = Date.now();

		// This flag is set here, but checked in handleUncleanExit because explicit calls
		// here can override hasShownTerminationError, for example to show the error when
		// something tries to interact with the API (`notifyRequestAfterExit`).
		this.hasShownTerminatedError = true;
		void this.promptToReloadExtension(`The Dart Tooling Daemon ${which} ${message}.`, undefined, true);
	}

	public dispose(): any {
		this.isShuttingDown = true;
		try {
			this.connection?.socket?.close();
			this.connection = undefined;
		} catch { }

		disposeAll(this.disposables);
	}
}

class DartToolingDaemonProcess extends StdIOService<UnknownNotification> {
	public hasReceivedConnectionInfo = false;

	private dtdUriCompleter = new PromiseCompleter<string | undefined>();
	private dtdSecretCompleter = new PromiseCompleter<string>();
	private processExitCompleter = new PromiseCompleter<void>();

	public hasTerminated = false;

	public get dtdUri(): Promise<string | undefined> {
		return this.dtdUriCompleter.promise;
	}

	public get dtdSecret(): Promise<string> {
		return this.dtdSecretCompleter.promise;
	}

	public get processExit(): Promise<void> {
		return this.processExitCompleter.promise;
	}

	constructor(logger: Logger, private readonly sdks: DartSdks, maxLogLineLength: number | undefined, getToolEnv: () => any) {
		super(logger, maxLogLineLength, true, true);

		const executable = path.join(this.sdks.dart, dartVMPath);
		const daemonArgs = [
			"tooling-daemon",
			"--machine",
		];

		this.createProcess(undefined, executable, daemonArgs, { toolEnv: getToolEnv() });
	}

	protected handleExit(code: number | null, signal: NodeJS.Signals | null) {
		this.hasTerminated = true;
		super.handleExit(code, signal);
		this.processExitCompleter.resolve();
		this.dtdUriCompleter.resolve(undefined);
	}

	protected shouldHandleMessage(_message: string): boolean {
		// DTD only emits one thing we care about but it's not in the same format
		// as our other things, so we treat every message as unhandled and extract
		// the info in processUnhandledMessage.
		return false;
	}

	protected async handleNotification(_evt: UnknownNotification): Promise<void> {
		// We never get here because shouldHandleMessage is always false.
	}

	protected async processUnhandledMessage(message: string): Promise<void> {
		message = message.trim();
		if (!this.hasReceivedConnectionInfo && message.startsWith("{") && message.endsWith("}")) {
			try {
				const json = JSON.parse(message);
				if (json?.tooling_daemon_details?.uri && json?.tooling_daemon_details?.trusted_client_secret) {
					this.dtdUriCompleter.resolve(json?.tooling_daemon_details?.uri as string);
					this.dtdSecretCompleter.resolve(json?.tooling_daemon_details?.trusted_client_secret as string);
					this.hasReceivedConnectionInfo = true;
				}
			} catch { }
		}
	}
}

interface ConnectionInfo { socket: ws.WebSocket; dtdUri: string, dtdSecret: string }
