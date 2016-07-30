"use strict";
import * as child_process from "child_process";

export class Analyzer {
	private analyzerProcess: child_process.ChildProcess;

	constructor(dartVMPath: string, analyzerPath: string) {
		console.log(`Starting Dart analysis server...`);
		this.analyzerProcess = child_process.spawn(dartVMPath, [analyzerPath]);

		this.analyzerProcess.stdout.on('data', (data: Buffer) => {
			let message = data.toString();
			console.log(`RCV: ${message}`);
			this.handleMessage(message);
		});
	}

	private handleMessage(message: string) {
	}

	stop() {
		console.log(`Stopping Dart analysis server...`);
		// TODO: end gracefully!
		this.analyzerProcess.kill();
	}
}