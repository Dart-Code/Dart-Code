"use strict";

import { Disposable } from "vscode";
import * as child_process from "child_process";
import * as fs from "fs";

// Reminder: This class is used in the debug adapter as well as the main Code process!

export abstract class StdIOService implements Disposable {
	protected process: child_process.ChildProcess;
	private nextRequestID = 1;
	private activeRequests: { [key: string]: [(result: any) => void, (error: any) => void, string] } = {};
	private messageBuffer: string[] = [];
	private logFile: string;
	private logStream: fs.WriteStream;
	private requestErrorSubscriptions: ((notification: any) => void)[] = [];

	constructor(logFile: string) {
		this.logFile = logFile;
	}

	protected createProcess(binPath: string, args: string[]) {
		this.process = child_process.spawn(binPath, args);

		this.process.stdout.on("data", (data: Buffer) => {
			let message = data.toString();

			// Add this message to the buffer for processing.
			this.messageBuffer.push(message);

			// Kick off processing if we have a full message.
			if (message.indexOf("\n") >= 0)
				this.processMessageBuffer();
		});
	}

	protected sendRequest<TReq, TResp>(method: string, params?: TReq): Thenable<TResp> {
		// Generate an ID for this request so we can match up the response.
		let id = this.nextRequestID++;

		return new Promise<TResp>((resolve, reject) => {
			// Stash the callbacks so we can call them later.
			this.activeRequests[id.toString()] = [resolve, reject, method];

			let req = {
				id: id.toString(),
				method: method,
				params: params
			};
			let json = JSON.stringify(req) + "\r\n";
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
			let lastNewline = fullBuffer.lastIndexOf("\n");
			let incompleteMessage = fullBuffer.substring(lastNewline + 1);
			fullBuffer = fullBuffer.substring(0, lastNewline);
			this.messageBuffer.push(incompleteMessage);
		}

		// Process the complete messages in the buffer.
		fullBuffer.split("\n").filter(m => m.trim() != "").forEach(m => this.handleMessage(m));
	}

	handleMessage(message: string): void {
		this.logTraffic(`<== ${message}\r\n`);
		let msg: any;
		try {
			msg = JSON.parse(message);
		}
		catch (e) {
			// This will include things like Observatory output and some analyzer logging code.
			message = message.trim();
			if (!message.startsWith('--- ') && !message.startsWith('+++ ')) {
				console.error(`Unable to parse message (${e}): ${message}`);
			}
			return;
		}

		if (msg.event)
			this.handleNotification(<UnknownNotification>msg);
		else
			this.handleResponse(<UnknownResponse>msg);
	}

	protected abstract handleNotification(evt: UnknownNotification): void;

	private handleResponse(evt: UnknownResponse) {
		let handler = this.activeRequests[evt.id];
		let method: string = handler[2];
		let error = evt.error;

		if (error && error.code == "SERVER_ERROR") {
			error.method = method;
			this.notify(this.requestErrorSubscriptions, error);
		}

		if (error) {
			handler[1](error);
		} else {
			handler[0](evt.result);
		}
	}

	protected notify<T>(subscriptions: ((notification: T) => void)[], notification: T) {
		subscriptions.slice().forEach(sub => sub(notification));
	}

	protected subscribe<T>(subscriptions: ((notification: T) => void)[], subscriber: (notification: T) => void): Disposable {
		subscriptions.push(subscriber);
		return {
			dispose: () => {
				let index = subscriptions.indexOf(subscriber);
				if (index >= 0) {
					subscriptions.splice(index, 1);
				}
			}
		};
	}

	registerForRequestError(subscriber: (notification: any) => void): Disposable {
		return this.subscribe(this.requestErrorSubscriptions, subscriber);
	}

	protected logTraffic(message: String): void {
		const max: number = 2000;

		if (this.logFile) {
			if (!this.logStream)
				this.logStream = fs.createWriteStream(this.logFile);
			this.logStream.write(`[${(new Date()).toLocaleTimeString()}]: `);
			if (message.length > max)
				this.logStream.write(message.substring(0, max) + "...\r\n");
			else
				this.logStream.write(message);
		} else if (!this.logFile && this.logStream) {
			// Turn off logging.
			this.logStream.close();
			this.logStream = null;
		}
	}

	dispose() {
		this.process.kill();

		if (this.logStream) {
			this.logStream.close();
			this.logStream = null;
		}
	}
}

export class Request<T> {
	id: string;
	method: string;
	params: T;
}

export class Response<T> {
	id: string;
	error: any;
	result: T;
}

export class UnknownResponse extends Response<any> { }

export class Notification<T> {
	event: string;
	params: T;
}

export class UnknownNotification extends Notification<any> { }
