"use strict";
import * as vscode from "vscode";
import * as child_process from "child_process";

export class Analyzer {
	private analyzerProcess: child_process.ChildProcess;

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
		let evt = <UnknownEvent>JSON.parse(message);
		switch (evt.event) {
			case "server.connected":
				this.serverConnected(<ServerConnectedEvent>evt);
				break;
		}
	}

	private serverConnected(evt: ServerConnectedEvent) {
		let message = `Connected to Dart analysis server version ${evt.params.version}`;

		console.log(message);
		let disposable = vscode.window.setStatusBarMessage(message);

		setTimeout(() => disposable.dispose(), 3000);		
	}

	stop() {
		console.log(`Stopping Dart analysis server...`);
		// TODO: end gracefully!
		this.analyzerProcess.kill();
	}
}

class Event<T> {
	event: string;
	params: T;
}

class UnknownEvent extends Event<any> { }

class ServerConnectedEvent extends Event<SeverConnectedParams> {}

class SeverConnectedParams {
	version: string;
	pid: number;
}