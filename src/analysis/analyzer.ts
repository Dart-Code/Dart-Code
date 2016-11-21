"use strict";

import * as vs from "vscode";
import * as child_process from "child_process";
import * as as from "./analysis_server_types";
import * as fs from "fs";
import { AnalyzerGen } from "./analyzer_gen";
import { config } from "../config";
import { log, logError, extensionVersion } from "../utils";

export class Analyzer extends AnalyzerGen implements vs.Disposable {
	private analyzerProcess: child_process.ChildProcess;
	private nextRequestID = 1;
	private activeRequests: { [key: string]: [(result: any) => void, (error: any) => void] } = {};
	private messageBuffer: string[] = [];
	private logStream: fs.WriteStream;

	private requestErrorSubscriptions: ((notification: as.RequestError) => void)[] = [];

	constructor(dartVMPath: string, analyzerPath: string) {
		super();

		log(`Starting Dart analysis server...`);

		let args = [];

		// Optionally start Observatory for the analyzer.
		if (config.analyzerObservatoryPort)
			args.push(`--observe=${config.analyzerObservatoryPort}`);

		args.push(analyzerPath);

		// Optionally start the analyzer's diagnostic web server on the given port.
		if (config.analyzerDiagnosticsPort)
			args.push(`--port=${config.analyzerDiagnosticsPort}`);

		// Add info about the extension that will be collected for crash reports etc.
		args.push(`--client-id=DanTup.dart-code`);
		args.push(`--client-version=${extensionVersion}`);

		// The analysis server supports a verbose instrumentation log file.
		if (config.analyzerInstrumentationLogFile)
			args.push(`--instrumentation-log-file=${config.analyzerInstrumentationLogFile}`);

		// Allow arbitrary args to be passed to the analysis server.
		if (config.analyzerAdditionalArgs)
			args.concat(config.analyzerAdditionalArgs);

		this.analyzerProcess = child_process.spawn(dartVMPath, args);

		this.analyzerProcess.stdout.on("data", (data: Buffer) => {
			let message = data.toString();

			// Add this message to the buffer for processing.
			this.messageBuffer.push(message);

			// Kick off processing if we have a full message.
			if (message.indexOf("\n") >= 0)
				this.processMessageBuffer();
		});

		this.serverSetSubscriptions({
			subscriptions: ["STATUS"]
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
		this.logTraffic(`<== ${message}\r\n`);
		let msg: any;
		try {
			msg = JSON.parse(message);
		}
		catch (e) {
			// This will include things like Observatory output.
			logError({ message: `Unable to parse message (${e}): ${message}` });
			return;
		}

		if (msg.event)
			this.handleNotification(<UnknownNotification>msg);
		else
			this.handleResponse(<UnknownResponse>msg);
	}

	private sendMessage<T>(req: Request<T>) {
		let json = JSON.stringify(req) + "\r\n";
		this.logTraffic(`==> ${json}`);
		try {
			this.analyzerProcess.stdin.write(json);
		}
		catch (e) {
			const reloadAction: string = "Reload Project";
			vs.window.showErrorMessage("The Dart analysis server has terminated. Save your changes then reload the project to resume.", reloadAction).then(res => {
				if (res == reloadAction)
					vs.commands.executeCommand("workbench.action.reloadWindow");
			});
			throw e;
		}
	}

	private logTraffic(message: String): void {
		const max: number = 2000;

		if (config.analyzerLogFile) {
			if (!this.logStream)
				this.logStream = fs.createWriteStream(config.analyzerLogFile);
			this.logStream.write(`[${(new Date()).toLocaleTimeString()}]: `);
			if (message.length > max)
				this.logStream.write(message.substring(0, max) + "...\r\n");
			else
				this.logStream.write(message);
		} else if (!config.analyzerLogFile && this.logStream) {
			// Turn off logging.
			this.logStream.close();
			this.logStream = null;
		}
	}

	private handleResponse(evt: UnknownResponse) {
		let handler = this.activeRequests[evt.id];
		if (evt.error && evt.error.code == "SERVER_ERROR")
			this.notify(this.requestErrorSubscriptions, <as.RequestError>evt.error);
		else if (evt.error)
			handler[1](evt.error);
		else
			handler[0](evt.result);
	}

	registerForRequestError(subscriber: (notification: as.RequestError) => void): vs.Disposable {
		return this.subscribe(this.requestErrorSubscriptions, subscriber);
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
		subscriptions.slice().forEach(sub => sub(notification));
	}

	protected subscribe<T>(subscriptions: ((notification: T) => void)[], subscriber: (notification: T) => void): vs.Disposable {
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

	dispose() {
		log(`Stopping Dart analysis server...`);

		this.analyzerProcess.kill();

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
	error: as.RequestError;
	result: T;
}

export class UnknownResponse extends Response<any> { }

export class Notification<T> {
	event: string;
	params: T;
}

export class UnknownNotification extends Notification<any> { }

export function getSymbolKindForElementKind(kind: as.ElementKind): vs.SymbolKind {
	// TODO: Review if these are all mapped as well as possible.
	switch (kind) {
		case "CLASS":
			return vs.SymbolKind.Class;
		case "CLASS_TYPE_ALIAS":
			return vs.SymbolKind.Class;
		case "COMPILATION_UNIT":
			return vs.SymbolKind.Module;
		case "CONSTRUCTOR":
			return vs.SymbolKind.Constructor;
		case "ENUM":
			return vs.SymbolKind.Enum;
		case "ENUM_CONSTANT":
			return vs.SymbolKind.Enum;
		case "FIELD":
			return vs.SymbolKind.Field;
		case "FILE":
			return vs.SymbolKind.File;
		case "FUNCTION":
			return vs.SymbolKind.Function;
		case "FUNCTION_TYPE_ALIAS":
			return vs.SymbolKind.Function;
		case "GETTER":
			return vs.SymbolKind.Property;
		case "LABEL":
			return vs.SymbolKind.Module;
		case "LIBRARY":
			return vs.SymbolKind.Namespace;
		case "LOCAL_VARIABLE":
			return vs.SymbolKind.Variable;
		case "METHOD":
			return vs.SymbolKind.Method;
		case "PARAMETER":
			return vs.SymbolKind.Variable;
		case "PREFIX":
			return vs.SymbolKind.Variable;
		case "SETTER":
			return vs.SymbolKind.Property;
		case "TOP_LEVEL_VARIABLE":
			return vs.SymbolKind.Variable;
		case "TYPE_PARAMETER":
			return vs.SymbolKind.Variable;
		case "UNIT_TEST_GROUP":
			return vs.SymbolKind.Module;
		case "UNIT_TEST_TEST":
			return vs.SymbolKind.Method;
		case "UNKNOWN":
			return vs.SymbolKind.Object;
		default:
			throw new Error("Unknown kind: " + kind);
	}
}
