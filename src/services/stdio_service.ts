"use strict";

import { Disposable } from "vscode";
import * as child_process from "child_process";
import * as fs from "fs";

// Reminder: This class is used in the debug adapter as well as the main Code process!

export abstract class StdIOService implements Disposable {
	public process: child_process.ChildProcess;
	protected messagesWrappedInBrackets = false;
	private nextRequestID = 1;
	private activeRequests: { [key: string]: [(result: any) => void, (error: any) => void, string] } = {};
	private messageBuffer: string[] = [];
	private logFile: string;
	private logStream: fs.WriteStream;
	private requestErrorSubscriptions: Array<(notification: any) => void> = [];

	constructor(logFile: string, wrappedMessages: boolean = false) {
		this.logFile = logFile;
		this.messagesWrappedInBrackets = wrappedMessages;
	}

	protected createProcess(workingDirectory: string, binPath: string, args: string[], env: any) {
		this.logTraffic(`Spawning ${binPath} with args ${JSON.stringify(args)}`);
		if (workingDirectory)
			this.logTraffic(`..  in ${workingDirectory}`);
		if (env)
			this.logTraffic(`..  in ${JSON.stringify(env)}`);

		this.process = child_process.spawn(binPath, args, { cwd: workingDirectory, env });

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
			console.error(`Unexpected non-JSON message, assuming normal stdout (${e}): ${message}`);
			this.processUnhandledMessage(message);
			return;
		}

		try {
			if (msg && msg.event)
				this.handleNotification(msg as UnknownNotification);
			else if (msg && msg.id)
				this.handleResponse(msg as UnknownResponse);
			else {
				console.error(`Unexpected JSON message, assuming normal stdout : ${message}`);
				this.processUnhandledMessage(message);
			}
		} catch (e) {
			console.error(`Failed to handle JSON message, assuming normal stdout (${e}): ${message}`);
			this.processUnhandledMessage(message);
		}
	}

	protected abstract handleNotification(evt: UnknownNotification): void;

	private handleResponse(evt: UnknownResponse) {
		const handler = this.activeRequests[evt.id];
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
		return {
			dispose: () => {
				const index = subscriptions.indexOf(subscriber);
				if (index >= 0) {
					subscriptions.splice(index, 1);
				}
			},
		};
	}

	public registerForRequestError(subscriber: (notification: any) => void): Disposable {
		return this.subscribe(this.requestErrorSubscriptions, subscriber);
	}

	protected logTraffic(message: string): void {
		const max: number = 2000;

		if (this.logFile) {
			if (!this.logStream)
				this.logStream = fs.createWriteStream(this.logFile);
			this.logStream.write(`[${(new Date()).toLocaleTimeString()}]: `);
			if (message.length > max)
				this.logStream.write(message.substring(0, max) + "…\r\n");
			else
				this.logStream.write(message.trim() + "\r\n");
		} else if (!this.logFile && this.logStream) {
			// Turn off logging.
			this.logStream.close();
			this.logStream = null;
		}
	}

	public dispose() {
		if (this.logStream) {
			this.logStream.close();
			this.logStream = null;
		}

		this.process.kill();
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
