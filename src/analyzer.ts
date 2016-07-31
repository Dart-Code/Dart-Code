"use strict";

import * as vscode from "vscode";
import * as child_process from "child_process";
import * as as from "./analysis_server_types";

export class Analyzer {
	private analyzerProcess: child_process.ChildProcess;
	private nextRequestID = 1;
	private activeRequests: { [key: number]: [(result: any) => void, (error: any) => void] } = {};

	constructor(dartVMPath: string, analyzerPath: string) {
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
		console.log(`SND: ${json}\r\n`);
		this.analyzerProcess.stdin.write(json);
	}

	private handleNotification(evt: UnknownNotification) {
		switch (evt.event) {
			case "server.connected":
				this.serverConnected(<as.ServerConnectedNotification>evt.params);
				break;
		}
	}

	private handleResponse(evt: UnknownResponse) {

	}

	private sendRequest<TReq, TResp>(method: string, params: TReq): Thenable<TResp> {
		// Generate an ID for this request so we can match up the response.
		let id = this.nextRequestID++;

		return new Promise<TResp>((resolve, reject) => {
			// Stash the callbacks so we can call them later.
			this.activeRequests[id] = [resolve, reject];

			this.sendMessage({
				id: id.toString(),
				method: method,
				params: params
			});
		});
	}

	private serverConnected(evt: as.ServerConnectedNotification) {
		let message = `Connected to Dart analysis server version ${evt.version}`;

		console.log(message);
		let disposable = vscode.window.setStatusBarMessage(message);

		setTimeout(() => disposable.dispose(), 3000);
	}

	getHover(request: as.AnalysisGetHoverRequest): Thenable<as.AnalysisGetHoverResponse> {
		return this.sendRequest("analysis.getHover", request);
	}

	stop() {
		console.log(`Stopping Dart analysis server...`);
		// TODO: end gracefully!
		this.analyzerProcess.kill();
	}
}

class Request<T> {
	id: string;
	method: string;
	params: T;
}

class Response<T> {
	id: string;
	error: as.RequestError;
	result: T;
}

class UnknownResponse extends Response<any> { }

class Notification<T> {
	event: string;
	params: T;
}

class UnknownNotification extends Notification<any> { }
