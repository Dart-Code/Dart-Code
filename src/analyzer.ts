"use strict";

import * as vscode from "vscode";
import * as child_process from "child_process";
import * as as from "./analysis_server_types";
import {AnalyzerGen} from "./analyzer_gen";

export class Analyzer extends AnalyzerGen {
	private analyzerProcess: child_process.ChildProcess;
	private nextRequestID = 1;
	private activeRequests: { [key: string]: [(result: any) => void, (error: any) => void] } = {};

	constructor(dartVMPath: string, analyzerPath: string) {
		super();
		console.log(`Starting Dart analysis server...`);
		this.analyzerProcess = child_process.spawn(dartVMPath, [analyzerPath]);

		this.analyzerProcess.stdout.on('data', (data: Buffer) => {
			let message = data.toString();
			console.log(`RCV: ${message}`);
			if (message != null && message.trim() != "")
				this.handleMessage(message);
		});
	}

	private handleMessage(message: string) {
		let msg = JSON.parse(message);
		if (msg.event)
			this.handleNotification(<UnknownNotification>msg);
		else
			this.handleResponse(<UnknownResponse>msg);
	}

	private sendMessage<T>(req: Request<T>) {
		let json = JSON.stringify(req);
		console.log(`SND: ${json}`);
		this.analyzerProcess.stdin.write(json);
		this.analyzerProcess.stdin.write("\r\n");
	}

	private handleResponse(evt: UnknownResponse) {
		let handler = this.activeRequests[evt.id];
		if (evt.error)
			handler[1](evt.error);
		else
			handler[0](evt.result);
	}

	protected sendRequest<TReq, TResp>(method: string, params: TReq): Thenable<TResp> {
		// Generate an ID for this request so we can match up the response.
		let id = this.nextRequestID++;

		return new Promise<TResp>((resolve, reject) => {
			// Stash the callbacks so we can call them later.
			this.activeRequests[id.toString()] = [resolve, reject];

			this.sendMessage({
				id: id.toString(),
				method: method,
				params: params
			});
		});
	}

	protected notify<T>(subscriptions: ((notification: T) => void)[], notification: T) {
		subscriptions.forEach(sub => sub(notification));
	}

	protected subscribe<T>(subscriptions: ((notification: T) => void)[], subscriber: (notification: T) => void): vscode.Disposable {
		subscriptions.push(subscriber);
		return {
			dispose: () => {
				var index = subscriptions.indexOf(subscriber);
				if (index >= 0) {
					subscriptions.splice(index, 1);
				}
			}
		};
	}

	stop() {
		console.log(`Stopping Dart analysis server...`);
		// TODO: end gracefully!
		this.analyzerProcess.kill();
	}
}

export class Request<T> {
	id: string;
	method: string;
	params: T;
}

export class Response<T> {
	id: string;
	error: as.RequestError;
	result: T;
}

export class UnknownResponse extends Response<any> { }

export class Notification<T> {
	event: string;
	params: T;
}

export class UnknownNotification extends Notification<any> { }
