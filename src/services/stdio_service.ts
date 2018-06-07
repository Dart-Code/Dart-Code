import * as child_process from "child_process";
import * as fs from "fs";
import { Disposable } from "vscode";
import { safeSpawn } from "../debug/utils";
import { logError } from "../utils";

// Reminder: This class is used in the debug adapter as well as the main Code process!

export abstract class StdIOService<T> implements Disposable {
	private disposables: Disposable[] = [];
	public process: child_process.ChildProcess;
	protected additionalPidsToTerminate: number[] = [];
	private nextRequestID = 1;
	private activeRequests: { [key: string]: [(result: any) => void, (error: any) => void, string] } = {};
	private messageBuffer: string[] = [];
	private currentLogFile: string;
	private logStream: fs.WriteStream;
	private requestErrorSubscriptions: Array<(notification: any) => void> = [];

	constructor(
		public readonly getLogFile: () => string,
		public readonly logger: (message: string) => void,
		public messagesWrappedInBrackets: boolean = false,
		public readonly treatHandlingErrorsAsUnhandledMessages: boolean = false) {
		this.currentLogFile = getLogFile();
	}

	protected createProcess(workingDirectory: string, binPath: string, args: string[]) {
		this.logTraffic(`Spawning ${binPath} with args ${JSON.stringify(args)}`);
		if (workingDirectory)
			this.logTraffic(`..  in ${workingDirectory}`);

		this.process = safeSpawn(workingDirectory, binPath, args);

		this.process.stdout.on("data", (data: Buffer) => {
			const message = data.toString();

			// Add this message to the buffer for processing.
			this.messageBuffer.push(message);

			// Kick off processing if we have a full message.
			if (message.indexOf("\n") >= 0)
				this.processMessageBuffer();
		});
		this.process.stderr.on("data", (data: Buffer) => {
			this.logTraffic(`ERR ${data.toString()}`);
		});
	}

	protected sendRequest<TReq, TResp>(method: string, params?: TReq): Thenable<TResp> {
		// Generate an ID for this request so we can match up the response.
		const id = this.nextRequestID++;

		return new Promise<TResp>((resolve, reject) => {
			// Stash the callbacks so we can call them later.
			this.activeRequests[id.toString()] = [resolve, reject, method];

			const req = {
				id: id.toString(),
				method,
				params,
			};
			const json = this.messagesWrappedInBrackets
				? "[" + JSON.stringify(req) + "]\r\n"
				: JSON.stringify(req) + "\r\n";
			this.sendMessage(json);
		});
	}

	protected sendMessage<T>(json: string) {
		this.logTraffic(`==> ${json}`);
		this.process.stdin.write(json);
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
		fullBuffer.split("\n").filter((m) => m.trim() !== "").forEach((m) => this.handleMessage(m));
	}

	protected abstract shouldHandleMessage(message: string): boolean;
	// tslint:disable-next-line:no-empty
	protected processUnhandledMessage(message: string): void { }

	public handleMessage(message: string): void {
		message = message.trim();
		this.logTraffic(`<== ${message}\r\n`);

		if (!this.shouldHandleMessage(message)) {
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
				console.error(`Unexpected non-JSON message, assuming normal stdout (${e})\n\n${e.stack}\n\n${message}`);
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
				console.error(`Unexpected JSON message, assuming normal stdout : ${message}`);
				this.processUnhandledMessage(message);
			}
		} catch (e) {
			if (this.treatHandlingErrorsAsUnhandledMessages) {
				console.error(`Failed to handle JSON message, assuming normal stdout (${e})\n\n${e.stack}\n\n${message}`);
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

	protected subscribe<T>(subscriptions: Array<(notification: T) => void>, subscriber: (notification: T) => void): Disposable {
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

	public registerForRequestError(subscriber: (notification: any) => void): Disposable {
		return this.subscribe(this.requestErrorSubscriptions, subscriber);
	}

	protected logTraffic(message: string): void {
		this.logger(message);
		const max: number = 2000;

		const newLogFile = this.getLogFile();
		if (newLogFile !== this.currentLogFile && this.logStream) {
			this.logStream.end();
			this.logStream = null;
		}

		if (!newLogFile)
			return;

		this.currentLogFile = newLogFile;

		if (!this.logStream)
			this.logStream = fs.createWriteStream(this.currentLogFile);
		this.logStream.write(`[${(new Date()).toLocaleTimeString()}]: `);
		if (message.length > max)
			this.logStream.write(message.substring(0, max) + "…\r\n");
		else
			this.logStream.write(message.trim() + "\r\n");
	}

	public dispose() {
		if (this.logStream) {
			this.logStream.end();
			this.logStream = null;
		}

		for (const pid of this.additionalPidsToTerminate) {
			try {
				process.kill(pid);
			} catch (e) {
				logError({ message: e.toString() });
			}
		}
		this.additionalPidsToTerminate.length = 0;
		try {
			this.process.kill();
		} catch (e) {
			// This tends to throw a lot because the shell process quit when we terminated the related
			// process above, so just swallow the error.
		}
		this.process = null;

		this.disposables.forEach((d) => d.dispose());
	}
}

export class Request<T> {
	public id: string;
	public method: string;
	public params: T;
}

export class Response<T> {
	public id: string;
	public error: any;
	public result: T;
}

export class UnknownResponse extends Response<any> { }

export class Notification<T> {
	public event: string;
	public params: T;
}

export class UnknownNotification extends Notification<any> { }
