"use strict";

import * as vs from "vscode";
import * as child_process from "child_process";
import * as fs from "fs";
import { log } from "../utils";

export abstract class StdIOService implements vs.Disposable {
	protected serviceName: string;
	protected process: child_process.ChildProcess;
	private logFile: string;
	private logStream: fs.WriteStream;

	constructor(serviceName: string, logFile: string) {
		this.serviceName = serviceName;
		this.logFile = logFile;
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
		log(`Stopping ${this.serviceName}...`);

		this.process.kill();

		if (this.logStream) {
			this.logStream.close();
			this.logStream = null;
		}
	}
}
