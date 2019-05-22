import * as child_process from "child_process";
import * as fs from "fs";
import { LogSeverity } from "../../shared/enums";
import { IAmDisposable } from "../debug/utils";
import { getLogHeader, logError, logInfo } from "../utils/log";
import { safeSpawn } from "../utils/processes";

// Reminder: This class is used in the debug adapter as well as the main Code process!

export abstract class StdIOService<T> implements IAmDisposable {
	private readonly disposables: IAmDisposable[] = [];
	public process?: child_process.ChildProcess;
	protected readonly additionalPidsToTerminate: number[] = [];
	private nextRequestID = 1;
	private readonly activeRequests: { [key: string]: [(result: any) => void, (error: any) => void, string] | "CANCELLED" } = {};
	private messageBuffer: string[] = [];
	private currentLogFile: string | undefined;
	private logStream?: fs.WriteStream;
	private readonly requestErrorSubscriptions: Array<(notification: any) => void> = [];
	private processExited = false;

	constructor(
		public readonly getLogFile: () => string | undefined,
		public readonly logger: (message: string, severity: LogSeverity) => void,
		public readonly maxLogLineLength: number | undefined,
		public messagesWrappedInBrackets: boolean = false,
		public readonly treatHandlingErrorsAsUnhandledMessages: boolean = false) {
		this.currentLogFile = getLogFile();
	}

	protected createProcess(workingDirectory: string | undefined, binPath: string, args: string[], envOverrides?: any) {
		this.logTraffic(`Spawning ${binPath} with args ${JSON.stringify(args)}`);
		if (workingDirectory)
			this.logTraffic(`..  in ${workingDirectory}`);
		if (envOverrides)
			this.logTraffic(`..  with ${JSON.stringify(envOverrides)}`);

		this.process = safeSpawn(workingDirectory, binPath, args, envOverrides);

		this.logTraffic(`    PID: ${process.pid}`);

		this.process.stdout.on("data", (data: Buffer) => {
			const message = data.toString();

			// Add this message to the buffer for processing.
			this.messageBuffer.push(message);

			// Kick off processing if we have a full message.
			if (message.indexOf("\n") >= 0)
				this.processMessageBuffer();
		});
		this.process.stderr.on("data", (data: Buffer) => {
			this.logTraffic(`${data.toString()}`, LogSeverity.Error);
		});
		this.process.on("exit", (data: Buffer) => {
			this.processExited = true;
		});
	}

	protected buildRequest<TReq>(id: number, method: string, params?: TReq): { id: string, method: string, params?: TReq } {
		return {
			id: id.toString(),
			method,
			params,
		};
	}

	protected sendRequest<TReq, TResp>(method: string, params?: TReq): Thenable<TResp> {
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
		let fullBuffer = this.messageBuffer.join("");
		this.messageBuffer = [];

		// If the message doesn't end with \n then put the last part back into the buffer.
		if (!fullBuffer.endsWith("\n")) {
			const lastNewline = fullBuffer.lastIndexOf("\n");
			const incompleteMessage = fullBuffer.substring(lastNewline + 1);
			fullBuffer = fullBuffer.substring(0, lastNewline);
			this.messageBuffer.push(incompleteMessage);
		}

		// Process the complete messages in the buffer.
		fullBuffer.split("\n").filter((m) => m.trim() !== "").forEach((m) => this.handleMessage(`${m}\n`));
	}

	protected abstract shouldHandleMessage(message: string): boolean;
	// tslint:disable-next-line:no-empty
	protected processUnhandledMessage(message: string): void { }

	public handleMessage(message: string): void {
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
				logError(`Unexpected non-JSON message, assuming normal stdout (${e})\n\n${e.stack}\n\n${message}`);
				this.processUnhandledMessage(message);
				return;
			} else {
				throw e;
			}
		}

		try {
			if (msg && this.isNotification(msg))
				this.handleNotification(msg as T);
			else if (msg && this.isResponse(msg))
				this.handleResponse(msg as UnknownResponse);
			else {
				logError(`Unexpected JSON message, assuming normal stdout : ${message}`);
				this.processUnhandledMessage(message);
			}
		} catch (e) {
			if (this.treatHandlingErrorsAsUnhandledMessages) {
				logError(`Failed to handle JSON message, assuming normal stdout (${e})\n\n${e.stack}\n\n${message}`);
				this.processUnhandledMessage(message);
			} else {
				throw e;
			}
		}
	}

	protected abstract handleNotification(evt: T): void;
	protected isNotification(msg: any): boolean { return !!msg.event; }
	protected isResponse(msg: any): boolean { return !!msg.id; }

	private handleResponse(evt: UnknownResponse) {
		const handler = this.activeRequests[evt.id];
		delete this.activeRequests[evt.id];

		if (handler === "CANCELLED") {
			logInfo(`Ignoring response to ${evt.id} because it was cancelled:\n\n${JSON.stringify(evt, undefined, 4)}`);
			return;
		} else if (!handler) {
			logError(`Unable to handle response with ID ${evt.id} because its handler is not available`);
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

	protected notify<T>(subscriptions: Array<(notification: T) => void>, notification: T) {
		subscriptions.slice().forEach((sub) => sub(notification));
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

	protected logTraffic(message: string, severity = LogSeverity.Info): void {
		this.logger(message, severity);

		const newLogFile = this.getLogFile();
		if (newLogFile !== this.currentLogFile && this.logStream) {
			this.logStream.end();
			this.logStream = undefined;
		}

		if (!newLogFile)
			return;

		this.currentLogFile = newLogFile;

		if (!this.logStream) {
			this.logStream = fs.createWriteStream(this.currentLogFile);
			this.logStream.write(getLogHeader());
		}
		this.logStream.write(`[${(new Date()).toLocaleTimeString()}]: `);
		if (this.maxLogLineLength && message.length > this.maxLogLineLength)
			this.logStream.write(message.substring(0, this.maxLogLineLength) + "…\r\n");
		else
			this.logStream.write(message.trim() + "\r\n");
	}

	public dispose() {
		if (this.logStream) {
			this.logStream.end();
			this.logStream = undefined;
		}

		for (const pid of this.additionalPidsToTerminate) {
			try {
				process.kill(pid);
			} catch (e) {
				// TODO: Logger knows the category!
				logError({ message: e.toString() });
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

		this.disposables.forEach((d) => d.dispose());
	}
}

export interface Request<T> {
	id: string;
	method: string;
	params: T;
}

export interface Response<T> {
	id: string;
	error: any;
	result: T;
}

export interface UnknownResponse extends Response<any> { }

export interface Notification<T> {
	event: string;
	params: T;
}

export interface UnknownNotification extends Notification<any> { }
