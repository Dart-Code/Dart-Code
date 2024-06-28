import * as path from "path";
import * as ws from "ws";
import { dartVMPath, tenMinutesInMs } from "../constants";
import { LogCategory } from "../enums";
import { DartSdks, IAmDisposable, Logger } from "../interfaces";
import { CategoryLogger } from "../logging";
import { PromiseCompleter, disposeAll } from "../utils";
import { UnknownNotification } from "./interfaces";
import { StdIOService } from "./stdio_service";
import { DtdRequest, DtdResponse, DtdResult, GetIDEWorkspaceRootsParams, GetIDEWorkspaceRootsResult, ReadFileAsStringParams, ReadFileAsStringResult, Service, SetIDEWorkspaceRootsParams, SetIDEWorkspaceRootsResult } from "./tooling_daemon_services";

export class DartToolingDaemon implements IAmDisposable {
	protected readonly disposables: IAmDisposable[] = [];
	private readonly logger: CategoryLogger;

	private readonly dtdProcess: DartToolingDaemonProcess;
	private connection: ConnectionInfo | undefined;
	private nextId = 1;
	private completers: { [key: string]: PromiseCompleter<DtdResult> } = {};

	private hasShownTerminatedError = false;
	private isShuttingDown = false;

	private connectedCompleter = new PromiseCompleter<ConnectionInfo>();
	public get connected() { return this.connectedCompleter.promise; }

	constructor(
		logger: Logger,
		sdks: DartSdks,
		maxLogLineLength: number | undefined,
		getToolEnv: () => any,
		exposeUrl: (url: string) => Promise<string>,
		private readonly promptToReloadExtension: (prompt?: string, buttonText?: string, offerLog?: boolean) => Promise<void>,
	) {
		this.logger = new CategoryLogger(logger, LogCategory.DartToolingDaemon);
		this.dtdProcess = new DartToolingDaemonProcess(this.logger, sdks, maxLogLineLength, getToolEnv, exposeUrl);
		this.disposables.push(this.dtdProcess);

		void this.dtdProcess.rawDtdUri.then(() => this.connect());
		void this.dtdProcess.processExit.then(() => this.handleClose());
	}

	/**
	 * This is the raw/original DTD URL. It is accessible from the extension host, but not necessarily
	 * from the client.
	 */
	public get rawDtdUri(): Promise<string> {
		return this.dtdProcess.rawDtdUri;
	}

	/**
	 * This is the an exposed version of the DTD URL that is accessible from the client, but not necessarily the
	 * extension host.
	 */
	public get publicDtdUri(): Promise<string> {
		return this.dtdProcess.publicDtdUri;
	}

	private async connect() {
		const dtdUri = await this.dtdProcess.rawDtdUri;
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
		this.connectedCompleter.resolve(this.connection!);
	}

	protected async sendWorkspaceFolders(workspaceFolderUris: string[]): Promise<void> {
		const connection = await this.connected;
		const secret = connection.dtdSecret;
		await this.send(Service.setIDEWorkspaceRoots, { secret, roots: workspaceFolderUris });
	}

	private handleData(data: string) {
		this.logTraffic(`<== ${data}\n`);
		const json: DtdResponse = JSON.parse(data);
		const id = json.id;
		const completer: PromiseCompleter<DtdResult> = this.completers[id];

		if (completer) {
			delete this.completers[id];

			if ("error" in json)
				completer.reject(json.error);
			else
				completer.resolve(json.result);
		}
	}

	public send(service: Service.setIDEWorkspaceRoots, params: SetIDEWorkspaceRootsParams): Promise<SetIDEWorkspaceRootsResult>;
	public send(service: Service.getIDEWorkspaceRoots, params: GetIDEWorkspaceRootsParams): Promise<GetIDEWorkspaceRootsResult>;
	public send(service: Service.readFileAsString, params: ReadFileAsStringParams): Promise<ReadFileAsStringResult>;
	public async send(service: Service, params: any): Promise<DtdResult> {
		if (!this.connection)
			return Promise.reject("DTD connection is unavailable");

		const id = `${this.nextId++}`;
		const completer = new PromiseCompleter<DtdResult>();
		this.completers[id] = completer;

		const json: DtdRequest = {
			id,
			jsonrpc: "2.0",
			method: service,
			params: params ?? {},
		};
		const str = JSON.stringify(json);
		this.logTraffic(`==> ${str}\n`);
		this.connection.socket.send(str);

		return completer.promise;
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

	private rawDtdUriCompleter = new PromiseCompleter<string>();
	private publicDtdUriCompleter = new PromiseCompleter<string>();
	private dtdSecretCompleter = new PromiseCompleter<string>();
	private processExitCompleter = new PromiseCompleter<void>();

	public hasTerminated = false;

	/**
	 * This is the raw/original DTD URL. It is accessible from the extension host, but not necessarily
	 * from the client.
	 */
	public get rawDtdUri(): Promise<string> {
		return this.rawDtdUriCompleter.promise;
	}

	/**
	 * This is the an exposed version of the DTD URL that is accessible from the client, but not necessarily the
	 * extension host.
	 */
	public get publicDtdUri(): Promise<string> {
		return this.publicDtdUriCompleter.promise;
	}

	public get dtdSecret(): Promise<string> {
		return this.dtdSecretCompleter.promise;
	}

	public get processExit(): Promise<void> {
		return this.processExitCompleter.promise;
	}

	constructor(
		logger: Logger,
		private readonly sdks: DartSdks,
		maxLogLineLength: number | undefined,
		getToolEnv: () => any,
		private readonly exposeUrl: (url: string) => Promise<string>,
	) {
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
					const dtdUri = json?.tooling_daemon_details?.uri as string;
					this.rawDtdUriCompleter.resolve(dtdUri);
					this.publicDtdUriCompleter.resolve(this.exposeUrl(dtdUri));
					this.dtdSecretCompleter.resolve(json?.tooling_daemon_details?.trusted_client_secret as string);
					this.hasReceivedConnectionInfo = true;
				}
			} catch { }
		}
	}
}

interface ConnectionInfo { socket: ws.WebSocket; dtdUri: string, dtdSecret: string }
