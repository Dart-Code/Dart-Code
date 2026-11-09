/* eslint-disable @typescript-eslint/unified-signatures */
import * as path from "path";
import * as ws from "ws";
import { DartCapabilities } from "../capabilities/dart";
import { dartVMPath, ExtensionRestartReason, fiveSecondsInMs, tenMinutesInMs } from "../constants";
import { LogCategory } from "../enums";
import { EventsEmitter } from "../events";
import { DartSdks, IAmDisposable, Logger } from "../interfaces";
import { CategoryLogger } from "../logging";
import { disposeAll, PromiseCompleter, PromiseOr } from "../utils";
import { attachPing } from "../utils/ws";
import { UnknownNotification } from "./interfaces";
import { ProcessExitCodes, StdIOService } from "./stdio_service";
import { ActiveLocation, ActiveLocationChangedEvent, DebugSessionChangedEvent, DebugSessionStartedEvent, DebugSessionStoppedEvent, DeviceAddedEvent, DeviceChangedEvent, DeviceRemovedEvent, DeviceSelectedEvent, DtdError, DtdMessage, DtdNotification, DtdRequest, DtdResponse, DtdResult, EnablePlatformTypeParams, Event, EventKind, GetDebugSessionsResult, GetDevicesResult, GetIDEWorkspaceRootsParams, GetIDEWorkspaceRootsResult, GetVmServicesResult, HotReloadParams, HotRestartParams, NavigateToCodeParams, OpenDevToolsPageParams, ReadFileAsStringParams, ReadFileAsStringResult, RegisterServiceParams, RegisterServiceResult, RegisterVmServiceParams, RegisterVmServiceResult, SelectDeviceParams, Service, ServiceMethod, ServiceRegisteredEventData, ServiceUnregisteredEventData, SetIDEWorkspaceRootsParams, SetIDEWorkspaceRootsResult, Stream, SuccessResult, UnregisterVmServiceParams, UnregisterVmServiceResult } from "./tooling_daemon_services";

export class DartToolingDaemon implements IAmDisposable {
	protected readonly disposables: IAmDisposable[] = [];
	protected readonly logger: CategoryLogger;

	private readonly dtdProcess: DartToolingDaemonProcess;
	protected connection: ConnectionInfo | undefined;
	private nextId = 1;
	private completers: Record<string, PromiseCompleter<DtdResult>> = {};
	private serviceHandlers: Record<string, (params?: object) => PromiseOr<DtdResult>> = {};

	private hasShownTerminatedError = false;
	protected isShuttingDown = false;

	protected connectedCompleter = new PromiseCompleter<ConnectionInfo | undefined>();
	public get connected() { return this.connectedCompleter.promise; }

	private readonly notificationsEmitters: Record<string, EventsEmitter<unknown>> = {};

	/// The set of services that have been seen registered over the Services stream
	/// but not yet unregistered.
	public readonly registeredServiceMethods = new Set<string>();

	constructor(
		logger: Logger,
		sdks: DartSdks,
		protected readonly dartCapabilities: DartCapabilities,
		workingDirectory: string | undefined,
		additionalArgs: string[],
		maxLogLineLength: number | undefined,
		getToolEnv: () => Record<string, string>,
		private readonly promptToReloadExtension: (logger: Logger, options: { prompt?: string; buttonText?: string; offerLog?: boolean; specificLog?: string; useError?: boolean; restartReason: ExtensionRestartReason }) => Promise<void>,
	) {
		this.logger = new CategoryLogger(logger, LogCategory.DartToolingDaemon);
		this.dtdProcess = new DartToolingDaemonProcess(this.logger, sdks, workingDirectory, additionalArgs, maxLogLineLength, getToolEnv);
		this.disposables.push(this.dtdProcess);

		void this.dtdProcess.dtdUri.then(() => this.connect());
		void this.dtdProcess.processExit.then((codes) => this.handleProcessExit(codes));
	}

	public get dtdUri(): Promise<string | undefined> {
		return this.dtdProcess.dtdUri;
	}

	private async connect() {
		const dtdUri = await this.dtdProcess.dtdUri;
		if (!dtdUri || this.isShuttingDown)
			return;
		const dtdSecret = await this.dtdProcess.dtdSecret;
		if (this.isShuttingDown)
			return;

		this.logger.info(`Connecting to DTD at ${dtdUri}...`);
		const socket = new ws.WebSocket(dtdUri, { followRedirects: true });
		attachPing(socket);
		socket.on("open", () => this.handleOpen());
		socket.on("message", (data) => {
			// handleData() is async and its promise is not observed by the
			// socket; catch failures (for example malformed messages or a
			// throwing notification listener) so they are logged rather than
			// left as unhandled rejections.
			// eslint-disable-next-line @typescript-eslint/no-base-to-string
			void this.handleData(data.toString()).catch((e) => this.logger.error(`Failed handling DTD message: ${String(e)}`));
		});
		socket.on("close", () => this.handleWebSocketClose());
		socket.on("error", (e) => this.handleError(e));

		this.connection = { socket, dtdUri, dtdSecret };
	}

	protected handleOpen(): void {
		this.logger.info(`Connected to DTD`);
		this.connectedCompleter.resolve(this.connection);

		this.onServiceRegistered((e) => {
			const serviceMethod = e.service ? `${e.service}.${e.method}` : e.method;
			this.registeredServiceMethods.add(serviceMethod);
		});
		this.onServiceUnregistered((e) => {
			const serviceMethod = e.service ? `${e.service}.${e.method}` : e.method;
			this.registeredServiceMethods.delete(serviceMethod);
		});
	}

	protected async sendWorkspaceFolders(workspaceFolderUris: string[]): Promise<void> {
		// `await this.connected` resolves to the initial connection object even
		// if the socket has since closed, so check the live connection instead.
		await this.connected;
		if (this.connection && !this.isShuttingDown) {
			const secret = this.connection.dtdSecret;
			await this.tryCallMethod(ServiceMethod.setIDEWorkspaceRoots, { secret, roots: workspaceFolderUris });
		}
	}

	protected async sendActiveLocation(activeLocation: ActiveLocation): Promise<void> {
		// `await this.connected` resolves to the initial connection object even
		// if the socket has since closed, so check the live connection instead.
		await this.connected;
		if (this.hasOpenSocket && !this.isShuttingDown)
			this.sendEvent(Stream.Editor, { kind: EventKind.activeLocationChanged, ...activeLocation });
	}

	private async handleData(data: string) {
		this.logTraffic(`<== ${data}\n`);
		const json = JSON.parse(data) as DtdMessage;
		const id = json.id;
		const method = json.method;

		if (method === "streamNotify") {
			const notification = json as DtdNotification;
			this.notificationsEmitters[notification.params?.streamId]?.fire(notification.params.eventKind, notification.params.eventData);

		} else if (id !== undefined && method) {
			const request = json as DtdRequest;
			// Handle service request.
			const serviceHandler = this.serviceHandlers[method];
			if (serviceHandler) {
				try {
					const result = await serviceHandler(request.params);
					this.send({
						id,
						jsonrpc: "2.0",
						result,
					});
				} catch (e: unknown) {
					const error = this.asDtdError(e);
					this.logger.error(`Failed handling service request ${method}: ${error.message}`);
					try {
						this.send({
							id,
							jsonrpc: "2.0",
							error,
						});
					} catch {
						// The connection dropped while the request was being
						// handled, so the error response can't be sent either.
					}
				}
			}

		} else if (id) {
			// Handle response.
			const completer: PromiseCompleter<DtdResult> = this.completers[id];
			const response = json as DtdResponse;

			if (completer) {
				delete this.completers[id];

				if ("error" in response)
					completer.reject(new DtdError(response.error.code, response.error.message, response.error.data));
				else
					completer.resolve(response.result);
			}
		}
	}

	public onNotification<T = unknown>(stream: string, eventKind: string, listener: (e: T) => unknown, thisArgs?: unknown): IAmDisposable {
		if (!this.notificationsEmitters[stream])
			this.notificationsEmitters[stream] = new EventsEmitter();

		return this.notificationsEmitters[stream].listen(eventKind, listener as (e: unknown) => unknown, thisArgs);
	}

	public onServiceRegistered(listener: (e: ServiceRegisteredEventData) => unknown, thisArgs?: unknown): IAmDisposable {
		return this.onNotification("Service", "ServiceRegistered", (e) => void listener(e as ServiceRegisteredEventData), thisArgs);
	}

	public onServiceUnregistered(listener: (e: ServiceUnregisteredEventData) => unknown, thisArgs?: unknown): IAmDisposable {
		return this.onNotification("Service", "ServiceUnregistered", (e) => void listener(e as ServiceUnregisteredEventData), thisArgs);
	}

	public async registerService(service: Service.Editor, method: "getActiveLocation", capabilities: object | undefined, f: () => PromiseOr<DtdResult & ActiveLocation>): Promise<void>;
	public async registerService(service: Service.Editor, method: "getDevices", capabilities: object | undefined, f: () => PromiseOr<DtdResult & GetDevicesResult>): Promise<void>;
	public async registerService(service: Service.Editor, method: "selectDevice", capabilities: object | undefined, f: (params: SelectDeviceParams) => PromiseOr<DtdResult & SuccessResult>): Promise<void>;
	public async registerService(service: Service.Editor, method: "enablePlatformType", capabilities: object | undefined, f: (params: EnablePlatformTypeParams) => PromiseOr<DtdResult & SuccessResult>): Promise<void>;
	public async registerService(service: Service.Editor, method: "getDebugSessions", capabilities: object | undefined, f: () => PromiseOr<DtdResult & GetDebugSessionsResult>): Promise<void>;
	public async registerService(service: Service.Editor, method: "hotReload", capabilities: object | undefined, f: (params: HotReloadParams) => PromiseOr<DtdResult & SuccessResult>): Promise<void>;
	public async registerService(service: Service.Editor, method: "hotRestart", capabilities: object | undefined, f: (params: HotRestartParams) => PromiseOr<DtdResult & SuccessResult>): Promise<void>;
	public async registerService(service: Service.Editor, method: "openDevToolsPage", capabilities: object | undefined, f: (params: OpenDevToolsPageParams) => PromiseOr<DtdResult & SuccessResult>): Promise<void>;
	public async registerService(service: Service.Editor, method: "navigateToCode", capabilities: object | undefined, f: (params: NavigateToCodeParams) => PromiseOr<DtdResult & SuccessResult>): Promise<void>;
	public async registerService<T>(service: Service, method: string, capabilities: object | undefined, f: (params: T) => PromiseOr<DtdResult>): Promise<void> {
		const serviceName = Service[service];
		const resp = await this.callMethod(ServiceMethod.registerService, { service: serviceName, method, capabilities });
		if (resp.type !== "Success") {
			throw new Error(`Failed to register service ${serviceName}.${method}: ${String(resp.type)}`);
		}

		this.serviceHandlers[`${serviceName}.${method}`] = f as (params?: object) => PromiseOr<DtdResult>;
	}

	public callMethod(service: ServiceMethod.registerService, params: RegisterServiceParams): Promise<RegisterServiceResult>;
	public callMethod(service: ServiceMethod.setIDEWorkspaceRoots, params: SetIDEWorkspaceRootsParams): Promise<SetIDEWorkspaceRootsResult>;
	public callMethod(service: ServiceMethod.getIDEWorkspaceRoots, params: GetIDEWorkspaceRootsParams): Promise<GetIDEWorkspaceRootsResult>;
	public callMethod(service: ServiceMethod.readFileAsString, params: ReadFileAsStringParams): Promise<ReadFileAsStringResult>;
	public callMethod(service: ServiceMethod.registerVmService, params: RegisterVmServiceParams): Promise<RegisterVmServiceResult>;
	public callMethod(service: ServiceMethod.unregisterVmService, params: UnregisterVmServiceParams): Promise<UnregisterVmServiceResult>;
	public callMethod(service: ServiceMethod.getVmServices): Promise<GetVmServicesResult>;
	public callMethod(service: ServiceMethod.streamListen, params: { streamId: string }): Promise<DtdResult>;
	public callMethod(service: ServiceMethod.streamCancel, params: { streamId: string }): Promise<DtdResult>;
	public callMethod(service: ServiceMethod.editorGetActiveLocation): Promise<DtdResult & ActiveLocation>;
	public callMethod(service: ServiceMethod.editorNavigateToCode, params: NavigateToCodeParams): Promise<DtdResult & SuccessResult>;
	public callMethod(service: ServiceMethod, params?: unknown): Promise<DtdResult>;

	/**
	 * Calls a DTD service method.
	 *
	 * The returned promise rejects if the connection is unavailable or the
	 * request otherwise fails. Fire-and-forget callers should use
	 * [tryCallMethod], which logs errors instead of rejecting.
	 */
	public async callMethod(method: ServiceMethod, params?: unknown): Promise<DtdResult> {
		if (this.isShuttingDown || !this.hasOpenSocket)
			return Promise.reject(new Error(`Unable to call ${method}, DTD connection is unavailable`));

		const id = `${this.nextId++}`;
		const completer = new PromiseCompleter<DtdResult>();
		this.completers[id] = completer;

		try {
			this.send({
				id,
				jsonrpc: "2.0",
				method,
				params,
			});
		} catch (e) {
			delete this.completers[id];
			throw e;
		}

		return completer.promise;
	}

	/**
	 * Calls a DTD service method, logging any error (unless shutting down) and
	 * returning `undefined` instead of rejecting.
	 */
	public async tryCallMethod(method: ServiceMethod, params?: unknown): Promise<DtdResult | undefined> {
		try {
			return await this.callMethod(method, params);
		} catch (e) {
			if (!this.isShuttingDown)
				this.logger.error(`Failed to call ${method}: ${String(e)}`);
			return undefined;
		}
	}

	public async streamListen(streamId: string): Promise<DtdResult> {
		return this.callMethod(ServiceMethod.streamListen, { streamId });
	}

	public async streamCancel(streamId: string): Promise<DtdResult> {
		return this.callMethod(ServiceMethod.streamCancel, { streamId });
	}

	public sendEvent(stream: Stream.Editor, params: DeviceAddedEvent | DeviceRemovedEvent | DeviceChangedEvent | DeviceSelectedEvent): void;
	public sendEvent(stream: Stream.Editor, params: DebugSessionStartedEvent | DebugSessionStoppedEvent | DebugSessionChangedEvent): void;
	public sendEvent(stream: Stream.Editor, params: ActiveLocationChangedEvent): void;
	public sendEvent(stream: Stream, params: Event): void {
		if (!this.hasOpenSocket) {
			// During shutdown it's expected that events can't be sent (for example an
			// async event handler that was in-flight when we were disposed), so just
			// drop them. Otherwise this is an unexpected failure that should be
			// surfaced.
			if (this.isShuttingDown) {
				this.logger.info(`Unable to send event to ${stream}, DTD connection is unavailable`);
				return;
			}
			throw new Error(`Unable to send event to ${stream}, DTD connection is unavailable`);
		}

		this.send({
			jsonrpc: "2.0",
			method: "postEvent",
			params: {
				eventData: { ...params, kind: undefined },
				eventKind: EventKind[params.kind],
				streamId: Stream[stream],
			},
		});
	}

	private asDtdError(error: unknown): { code: number; message: string } {
		const code = (error as { code?: unknown } | undefined)?.code;
		const message = (error as { message?: unknown } | undefined)?.message;

		return {
			code: typeof code === "number" ? code : -32000,
			message: typeof message === "string" ? message : error?.toString() ?? "Unknown error",
		};
	}

	private get hasOpenSocket(): boolean {
		return this.connection?.socket.readyState === ws.WebSocket.OPEN;
	}

	private send(json: DtdMessage): void {
		if (this.isShuttingDown)
			return;
		const socket = this.connection?.socket;
		if (socket?.readyState !== ws.WebSocket.OPEN)
			throw new Error("Unable to send message, DTD connection is unavailable");

		const str = JSON.stringify(json);
		this.logTraffic(`==> ${str}\n`);
		socket.send(str);
	}

	protected handleProcessExit(codes: ProcessExitCodes) {
		this.logger.info(`DTD process exited (${codes.code}, ${codes.signal})`);
		if (!this.isShuttingDown && !this.hasShownTerminatedError) {
			this.showTerminatedError("process", this.dtdProcess.hasReceivedConnectionInfo ? "has terminated" : "failed to start");
		}

		this.dispose();
	}

	protected handleWebSocketClose() {
		this.logger.info(`DTD WebSocket connection closed`);
		// No more responses can arrive on this socket, so clear it and reject any
		// pending requests rather than leaving their callers hanging. Settling
		// `connected` also unblocks callers that were still waiting for it (for
		// example if the socket never reached the open state).
		this.connection = undefined;
		this.connectedCompleter.resolve(undefined);
		this.rejectPendingRequests();
		// Delay this for a few seconds so if the process terminates, we show that one instead (since it's the most
		// significant).
		setTimeout(() => {
			if (!this.isShuttingDown && !this.hasShownTerminatedError) {
				this.showTerminatedError("connection", "was closed");
			}
		}, fiveSecondsInMs).unref();

		// Don't dispose just because the web socket closed, because if the process is in the process of terminating, we want
		// to log that, and not have terminated the process ourselves.
		// this.dispose();
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
		void this.promptToReloadExtension(this.logger, {
			prompt: `The Dart Tooling Daemon ${which} ${message}.`,
			offerLog: true,
			restartReason: ExtensionRestartReason.ToolingDaemonTerminated
		});
	}

	private rejectPendingRequests() {
		for (const completer of Object.values(this.completers))
			completer.reject(new Error("Unable to send message, DTD connection is unavailable"));
		this.completers = {};
	}

	public dispose(): void {
		this.isShuttingDown = true;
		this.connectedCompleter.resolve(undefined);
		this.rejectPendingRequests();
		// Clear the connection before closing the socket, because close() can
		// throw (for example on a socket that is still CONNECTING).
		const socket = this.connection?.socket;
		this.connection = undefined;
		try {
			socket?.close();
		} catch { }

		disposeAll(this.disposables);
	}
}

class DartToolingDaemonProcess extends StdIOService<UnknownNotification> {
	public hasReceivedConnectionInfo = false;

	private dtdUriCompleter = new PromiseCompleter<string | undefined>();
	private dtdSecretCompleter = new PromiseCompleter<string>();

	public hasTerminated = false;

	public get dtdUri(): Promise<string | undefined> {
		return this.dtdUriCompleter.promise;
	}

	public get dtdSecret(): Promise<string> {
		return this.dtdSecretCompleter.promise;
	}

	constructor(logger: Logger, private readonly sdks: DartSdks, workingDirectory: string | undefined, additionalArgs: string[], maxLogLineLength: number | undefined, getToolEnv: () => Record<string, string>) {
		super(logger, maxLogLineLength, true, true);

		const executable = path.join(this.sdks.dart, dartVMPath);
		const daemonArgs = [
			"tooling-daemon",
			"--machine",
			...additionalArgs,
		];

		this.createProcess(workingDirectory, executable, daemonArgs, { toolEnv: getToolEnv() });
	}

	protected handleExit(code: number | null, signal: NodeJS.Signals | null) {
		this.hasTerminated = true;
		super.handleExit(code, signal);
		this.dtdUriCompleter.resolve(undefined);
	}

	protected shouldHandleMessage(_message: string): boolean {
		// DTD only emits one thing we care about but it's not in the same format
		// as our other things, so we treat every message as unhandled and extract
		// the info in processUnhandledMessage.
		return false;
	}

	protected handleNotification(_evt: UnknownNotification): void {
		// We never get here because shouldHandleMessage is always false.
	}

	protected processUnhandledMessage(message: string): void {
		message = message.trim();
		if (!this.hasReceivedConnectionInfo && message.startsWith("{") && message.endsWith("}")) {
			try {
				const json = JSON.parse(message) as { tooling_daemon_details?: { uri?: string; trusted_client_secret?: string } } | undefined;
				if (json?.tooling_daemon_details?.uri && json?.tooling_daemon_details?.trusted_client_secret) {
					this.dtdUriCompleter.resolve(json.tooling_daemon_details.uri);
					this.dtdSecretCompleter.resolve(json.tooling_daemon_details.trusted_client_secret);
					this.hasReceivedConnectionInfo = true;
				}
			} catch { }
		}
	}
}

interface ConnectionInfo { socket: ws.WebSocket; dtdUri: string, dtdSecret: string }
