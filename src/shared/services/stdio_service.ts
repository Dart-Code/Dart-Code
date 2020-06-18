import * as fs from "fs";
import { IAmDisposable, Logger, SpawnedProcess } from "../../shared/interfaces";
import { Request, UnknownResponse } from "../../shared/services/interfaces";
import { safeSpawn } from "../processes";

// Reminder: This class is used in the debug adapter as well as the main Code process!

export abstract class StdIOService<T> implements IAmDisposable {
	private readonly disposables: IAmDisposable[] = [];
	public process?: SpawnedProcess;
	protected readonly additionalPidsToTerminate: number[] = [];
	private nextRequestID = 1;
	private readonly activeRequests: { [key: string]: [(result: any) => void, (error: any) => void, string] | "CANCELLED" } = {};
	private messageBuffers: Buffer[] = [];
	private openLogFile: string | undefined;
	private logStream?: fs.WriteStream;
	private readonly requestErrorSubscriptions: Array<(notification: any) => void> = [];
	private processExited = false;

	constructor(
		protected readonly logger: Logger,
		public readonly maxLogLineLength: number | undefined,
		public messagesWrappedInBrackets: boolean = false,
		public readonly treatHandlingErrorsAsUnhandledMessages: boolean = false,
		private logFile?: string) {
	}

	protected createProcess(workingDirectory: string | undefined, binPath: string, args: string[], env: { envOverrides?: { [key: string]: string | undefined }, toolEnv?: { [key: string]: string | undefined } }) {
		this.logTraffic(`Spawning ${binPath} with args ${JSON.stringify(args)}`);
		if (workingDirectory)
			this.logTraffic(`..  in ${workingDirectory}`);
		if (env.envOverrides || env.toolEnv)
			this.logTraffic(`..  with ${JSON.stringify(env)}`);

		this.process = safeSpawn(workingDirectory, binPath, args, env);

		this.logTraffic(`    PID: ${process.pid}`);

		this.process.stdout.on("data", (data: Buffer | string) => {
			// Add this message to the buffer for processing.
			this.messageBuffers.push(Buffer.isBuffer(data) ? data : Buffer.from(data));

			// Kick off processing if we have a full message.
			if (data.toString().indexOf("\n") >= 0)
				this.processMessageBuffer();
		});
		this.process.stderr.on("data", (data: Buffer | string) => {
			this.logTraffic(`${data.toString()}`, true);
		});
		this.process.on("exit", (code, signal) => {
			this.logTraffic(`Process terminated! ${code}, ${signal}`);
			this.processExited = true;
		});
		this.process.on("error", (error) => {
			this.logTraffic(`Process errored! ${error}`);
		});
	}

	protected buildRequest<TReq>(id: number, method: string, params?: TReq): { id: string, method: string, params?: TReq } {
		return {
			id: id.toString(),
			method,
			params,
		};
	}

	protected sendRequest<TReq, TResp>(method: string, params?: TReq): Promise<TResp> {
		// Generate an ID for this request so we can match up the response.
		const id = this.nextRequestID++;

		return new Promise<TResp>((resolve, reject) => {
			// Stash the callbacks so we can call them later.
			this.activeRequests[id.toString()] = [resolve, reject, method];

			const req = this.buildRequest(id, method, params);
			const json = this.messagesWrappedInBrackets
				? "[" + JSON.stringify(req) + "]\r\n"
				: JSON.stringify(req) + "\r\n";
			this.sendMessage(json);
		});
	}

	public cancelAllRequests() {
		Object.keys(this.activeRequests).forEach((key) => this.activeRequests[key] = "CANCELLED");
	}

	protected sendMessage<T>(json: string) {
		this.logTraffic(`==> ${json}`);
		if (this.process)
			this.process.stdin.write(json);
		else
			this.logTraffic(`  (not sent: no process)`);
	}

	protected processMessageBuffer() {
		let fullBuffer = Buffer.concat(this.messageBuffers);
		this.messageBuffers = [];

		// If the message doesn't end with \n then put the last part back into the buffer.
		const lastNewline = fullBuffer.lastIndexOf("\n");
		if (lastNewline !== fullBuffer.length - 1) {
			const incompleteMessage = fullBuffer.slice(lastNewline + 1);
			fullBuffer = fullBuffer.slice(0, lastNewline);
			this.messageBuffers.push(incompleteMessage);
		}

		// Process the complete messages in the buffer.
		fullBuffer.toString().split("\n").filter((m) => m.trim() !== "").forEach((m) => this.handleMessage(`${m}\n`));
	}

	protected abstract shouldHandleMessage(message: string): boolean;
	// tslint:disable-next-line:no-empty
	protected processUnhandledMessage(message: string): void { }

	public async handleMessage(message: string): Promise<void> {
		this.logTraffic(`<== ${message.trimRight()}\r\n`);

		if (!this.shouldHandleMessage(message.trim())) {
			this.processUnhandledMessage(message);
			return;
		}

		let msg: any;
		try {
			msg = JSON.parse(message);

			if (this.messagesWrappedInBrackets && msg && msg.length === 1)
				msg = msg[0];
		} catch (e) {
			if (this.treatHandlingErrorsAsUnhandledMessages) {
				this.logger.error(`Unexpected non-JSON message, assuming normal stdout (${e})\n\n${e.stack}\n\n${message}`);
				this.processUnhandledMessage(message);
				return;
			} else {
				throw e;
			}
		}

		try {
			if (msg && this.isNotification(msg))
				this.handleNotification(msg as T);
			else if (msg && this.isRequest(msg))
				await this.processServerRequest(msg as Request<any>);
			else if (msg && this.isResponse(msg))
				this.handleResponse(msg as UnknownResponse);
			else {
				this.logger.error(`Unexpected JSON message, assuming normal stdout : ${message}`);
				this.processUnhandledMessage(message);
			}
		} catch (e) {
			if (this.treatHandlingErrorsAsUnhandledMessages) {
				this.logger.error(`Failed to handle JSON message, assuming normal stdout (${e})\n\n${e.stack}\n\n${message}`);
				this.processUnhandledMessage(message);
			} else {
				throw e;
			}
		}
	}

	protected abstract handleNotification(evt: T): void;
	// tslint:disable-next-line: no-empty
	protected async handleRequest(method: string, args: any): Promise<any> { }
	protected isNotification(msg: any): boolean { return !!msg.event; }
	protected isRequest(msg: any): boolean { return !!msg.method && !!msg.id; }
	protected isResponse(msg: any): boolean { return !!msg.id; }

	private async processServerRequest(request: Request<any>) {
		let result: any;
		let error: any;
		try {
			result = await this.handleRequest(request.method, request.params);
		} catch (e) {
			error = e;
		}
		const resp = { id: request.id, result, error };
		const json = this.messagesWrappedInBrackets
			? "[" + JSON.stringify(resp) + "]\r\n"
			: JSON.stringify(resp) + "\r\n";
		this.sendMessage(json);
	}

	private handleResponse(evt: UnknownResponse) {
		const handler = this.activeRequests[evt.id];
		delete this.activeRequests[evt.id];

		if (handler === "CANCELLED") {
			this.logger.info(`Ignoring response to ${evt.id} because it was cancelled:\n\n${JSON.stringify(evt, undefined, 4)}`);
			return;
		} else if (!handler) {
			this.logger.error(`Unable to handle response with ID ${evt.id} because its handler is not available`);
			return;
		}
		const method: string = handler[2];
		const error = evt.error;

		if (error && error.code === "SERVER_ERROR") {
			error.method = method;
			this.notify(this.requestErrorSubscriptions, error);
		}

		if (error) {
			handler[1](error);
		} else {
			handler[0](evt.result);
		}
	}

	protected notify<T>(subscriptions: Array<(notification: T) => void>, notification: T): void {
		Promise.all(subscriptions.slice().map((sub) => sub(notification))).catch((e) => console.error(e));
	}

	protected subscribe<T>(subscriptions: Array<(notification: T) => void>, subscriber: (notification: T) => void): IAmDisposable {
		subscriptions.push(subscriber);
		const disposable = {
			dispose: () => {
				// Remove from the subscription list.
				let index = subscriptions.indexOf(subscriber);
				if (index >= 0) {
					subscriptions.splice(index, 1);
				}

				// Also remove from our disposables (else we'll leak it).
				index = this.disposables.indexOf(disposable);
				if (index >= 0) {
					this.disposables.splice(index, 1);
				}
			},
		};

		this.disposables.push(disposable);

		return disposable;
	}

	public registerForRequestError(subscriber: (notification: any) => void): IAmDisposable {
		return this.subscribe(this.requestErrorSubscriptions, subscriber);
	}

	protected logTraffic(message: string, isError = false): void {
		if (isError)
			this.logger.error(message);
		else
			this.logger.info(message);

		if (this.openLogFile !== this.logFile && this.logStream) {
			this.logStream.end();
			this.logStream = undefined;
			this.openLogFile = undefined;
		}

		if (!this.logFile)
			return;

		if (!this.logStream) {
			this.logStream = fs.createWriteStream(this.logFile);
			this.openLogFile = this.logFile;
		}
		this.logStream.write(`[${(new Date()).toLocaleTimeString()}]: `);
		if (this.maxLogLineLength && message.length > this.maxLogLineLength)
			this.logStream.write(message.substring(0, this.maxLogLineLength) + "…\r\n");
		else
			this.logStream.write(message.trim() + "\r\n");
	}

	public dispose() {
		for (const pid of this.additionalPidsToTerminate) {
			try {
				process.kill(pid);
			} catch (e) {
				// TODO: Logger knows the category!
				this.logger.error({ message: e.toString() });
			}
		}
		this.additionalPidsToTerminate.length = 0;
		try {
			if (!this.processExited && this.process && !this.process.killed)
				this.process.kill();
		} catch (e) {
			// This tends to throw a lot because the shell process quit when we terminated the related
			// process above, so just swallow the error.
		}
		this.process = undefined;

		this.disposables.forEach(async (d) => {
			try {
				return await d.dispose();
			} catch (e) {
				this.logger.error({ message: e.toString() });
			}
		});
		this.disposables.length = 0;

		// Clear log file so if any more log events come through later, we don't
		// create a new log file and overwrite what we had.
		this.logFile = undefined;

		if (this.logStream) {
			this.logStream.end();
			this.logStream = undefined;
			this.openLogFile = undefined;
		}
	}
}
