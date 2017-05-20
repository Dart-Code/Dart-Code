"use strict";

import * as vs from "vscode";
import * as child_process from "child_process";
import * as fs from "fs";
import { log } from "../utils";

export abstract class StdIOService implements vs.Disposable {
	protected serviceName: string;
	protected process: child_process.ChildProcess;
	protected messageBuffer: string[] = [];
	private logFile: string;
	private logStream: fs.WriteStream;

	constructor(serviceName: string, logFile: string) {
		this.serviceName = serviceName;
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

	protected sendMessage<T>(json: string) {
		this.logTraffic(`==> ${json}`);
		try {
			this.process.stdin.write(json);
		}
		catch (e) {
			const reloadAction: string = "Reload Project";
			vs.window.showErrorMessage(`The ${this.serviceName} has terminated. Save your changes then reload the project to resume.`, reloadAction).then(res => {
				if (res == reloadAction)
					vs.commands.executeCommand("workbench.action.reloadWindow");
			});
			throw e;
		}
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

	protected abstract handleMessage(message: string): void;

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
		log(`Stopping ${this.serviceName}...`);

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
