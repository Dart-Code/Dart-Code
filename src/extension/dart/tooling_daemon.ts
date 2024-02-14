import * as path from "path";
import { workspace } from "vscode";
import * as ws from "ws";
import { dartVMPath, tenMinutesInMs } from "../../shared/constants";
import { LogCategory } from "../../shared/enums";
import { DartSdks, IAmDisposable, Logger } from "../../shared/interfaces";
import { CategoryLogger } from "../../shared/logging";
import { UnknownNotification } from "../../shared/services/interfaces";
import { StdIOService } from "../../shared/services/stdio_service";
import { PromiseCompleter, disposeAll } from "../../shared/utils";
import { config } from "../config";
import { promptToReloadExtension } from "../utils";
import { getToolEnv } from "../utils/processes";
import { DtdRequest, DtdResponse, DtdResult, Service, SetIDEWorkspaceRootsParams, SetIDEWorkspaceRootsResult } from "./tooling_daemon_services";

export class DartToolingDaemon implements IAmDisposable {
	protected readonly disposables: IAmDisposable[] = [];
	private readonly logger: CategoryLogger;

	private readonly dtdProcess: DartToolingDaemonProcess;
	private connection: { socket: ws.WebSocket; dtdUri: string, dtdSecret: string } | undefined;
	private nextId = 1;
	private completers: { [key: string]: PromiseCompleter<DtdResult> } = {};

	private hasShownTerminatedError = false;
	private isShuttingDown = false;

	constructor(logger: Logger, private readonly sdks: DartSdks) {
		this.logger = new CategoryLogger(logger, LogCategory.DartToolingDaemon);
		this.dtdProcess = new DartToolingDaemonProcess(this.logger, sdks);
		this.disposables.push(this.dtdProcess);

		void this.dtdProcess.dtdUri.then(() => this.connect());
		void this.dtdProcess.processExit.then(() => this.handleClose());
	}

	private async connect() {
		const dtdUri = await this.dtdProcess.dtdUri;
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

		workspace.onDidChangeWorkspaceFolders(() => this.sendWorkspaceFolders());
		this.sendWorkspaceFolders(); // Send initial.
	}

	private sendWorkspaceFolders() {
		if (!this.connection)
			return;

		const secret = this.connection.dtdSecret;
		const roots = workspace.workspaceFolders?.map((wf) => wf.uri.toString()) ?? [];
		void this.send(Service.setIDEWorkspaceRoots, { secret, roots });
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
				completer.resolve(json);
		}
	}

	public send(service: Service.setIDEWorkspaceRoots, params: SetIDEWorkspaceRootsParams): Promise<SetIDEWorkspaceRootsResult>;
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
			params: params || {},
		};
		const str = JSON.stringify(json);
		this.logTraffic(`==> ${str}\n`);
		this.connection.socket.send(str);

		return completer.promise;
	}


	private handleClose() {
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
		void promptToReloadExtension(`The Dart Tooling Daemon ${which} ${message}.`, undefined, true);
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

	private dtdUriCompleter = new PromiseCompleter<string>();
	private dtdSecretCompleter = new PromiseCompleter<string>();
	private processExitCompleter = new PromiseCompleter<void>();

	public hasTerminated = false;

	public get dtdUri(): Promise<string> {
		return this.dtdUriCompleter.promise;
	}

	public get dtdSecret(): Promise<string> {
		return this.dtdSecretCompleter.promise;
	}

	public get processExit(): Promise<void> {
		return this.processExitCompleter.promise;
	}

	constructor(logger: Logger, private readonly sdks: DartSdks) {
		super(logger, config.maxLogLineLength, true, true);

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
					this.dtdUriCompleter.resolve(json?.tooling_daemon_details?.uri as string);
					this.dtdSecretCompleter.resolve(json?.tooling_daemon_details?.trusted_client_secret as string);
					this.hasReceivedConnectionInfo = true;
				}
			} catch { }
		}
	}
}

