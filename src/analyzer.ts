"use strict";

import * as vscode from "vscode";
import * as child_process from "child_process";
import * as as from "./analysis_server_types";
import { AnalyzerGen } from "./analyzer_gen";
import { config } from "./config";

export class Analyzer extends AnalyzerGen {
	private analyzerProcess: child_process.ChildProcess;
	private nextRequestID = 1;
	private activeRequests: { [key: string]: [(result: any) => void, (error: any) => void] } = {};
	private messageBuffer: string[] = [];

	constructor(dartVMPath: string, analyzerPath: string) {
		super();

		console.log(`Starting Dart analysis server...`);

		let args = [analyzerPath];

		// Optionally start the analyzer's diagnostic web server on the given port.
		let port = config.analyzerDiagnosticsPort;
		if (port)
			args.push(`--port=${port}`);

		this.analyzerProcess = child_process.spawn(dartVMPath, args);

		this.analyzerProcess.stdout.on("data", (data: Buffer) => {
			let message = data.toString();
			if (config.verbose && message.trim().length != 0)
				console.log(`<== ${message}`);

			// Add this message to the buffer for processing.
			this.messageBuffer.push(message);

			// Kick off processing if we have a full message.
			if (message.indexOf("\n") >= 0)
				this.processMessageBuffer();
		});

		this.serverSetSubscriptions({
			subscriptions: ['STATUS']
		});
	}

	private processMessageBuffer() {
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

	private handleMessage(message: string) {
		let msg = JSON.parse(message);
		if (msg.event)
			this.handleNotification(<UnknownNotification>msg);
		else
			this.handleResponse(<UnknownResponse>msg);
	}

	private sendMessage<T>(req: Request<T>) {
		let json = JSON.stringify(req);
		if (config.verbose)
			console.log(`==> ${json}`);
		this.analyzerProcess.stdin.write(json);
		this.analyzerProcess.stdin.write("\n");
	}

	private handleResponse(evt: UnknownResponse) {
		let handler = this.activeRequests[evt.id];
		if (evt.error)
			handler[1](evt.error);
		else
			handler[0](evt.result);
	}

	protected sendRequest<TReq, TResp>(method: string, params?: TReq): Thenable<TResp> {
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

export function getSymbolKindForElementKind(kind: as.ElementKind): vscode.SymbolKind {
	// TODO: Review if these are all mapped as well as possible.
	switch (kind) {
		case "CLASS":
			return vscode.SymbolKind.Class;
		case "CLASS_TYPE_ALIAS":
			return vscode.SymbolKind.Class;
		case "COMPILATION_UNIT":
			return vscode.SymbolKind.Module;
		case "CONSTRUCTOR":
			return vscode.SymbolKind.Constructor;
		case "ENUM":
			return vscode.SymbolKind.Enum;
		case "ENUM_CONSTANT":
			return vscode.SymbolKind.Enum;
		case "FIELD":
			return vscode.SymbolKind.Field;
		case "FILE":
			return vscode.SymbolKind.File;
		case "FUNCTION":
			return vscode.SymbolKind.Function;
		case "FUNCTION_TYPE_ALIAS":
			return vscode.SymbolKind.Function;
		case "GETTER":
			return vscode.SymbolKind.Property;
		case "LABEL":
			return vscode.SymbolKind.Module;
		case "LIBRARY":
			return vscode.SymbolKind.Namespace;
		case "LOCAL_VARIABLE":
			return vscode.SymbolKind.Variable;
		case "METHOD":
			return vscode.SymbolKind.Method;
		case "PARAMETER":
			return vscode.SymbolKind.Variable;
		case "PREFIX":
			return vscode.SymbolKind.Variable;
		case "SETTER":
			return vscode.SymbolKind.Property;
		case "TOP_LEVEL_VARIABLE":
			return vscode.SymbolKind.Variable;
		case "TYPE_PARAMETER":
			return vscode.SymbolKind.Variable;
		case "UNIT_TEST_GROUP":
			return vscode.SymbolKind.Module;
		case "UNIT_TEST_TEST":
			return vscode.SymbolKind.Method;
		case "UNKNOWN":
			return vscode.SymbolKind.Object;
		default:
			throw new Error("Unknown kind: " + kind);
	}
}
