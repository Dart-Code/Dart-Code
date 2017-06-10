"use strict";

import { DartDebugSession } from "./dart_debug_impl";
import { DebugProtocol } from "vscode-debugprotocol";
import { FlutterLaunchRequestArguments, isWin } from "./utils";
import { FlutterRun } from "./flutter_run";
import { TerminatedEvent } from "vscode-debugadapter";
import * as child_process from "child_process";
import * as path from "path";

export class FlutterDebugSession extends DartDebugSession {
	protected args: FlutterLaunchRequestArguments;
	flutter: FlutterRun;
	currentRunningAppId: string;

	constructor() {
		super();

		this.sendStdOutToConsole = false;
	}

	protected spawnProcess(args: FlutterLaunchRequestArguments): any {
		let debug = !args.noDebug;
		let appArgs = [];

		if (this.sourceFile) {
			appArgs.push("-t")
			appArgs.push(this.sourceFile);
		}

		if (debug) {
			appArgs.push("--observatory-port=0");
			appArgs.push("--start-paused");
		}

		if (args.args)
			appArgs = appArgs.concat(args.args);

		// TODO: Add log file.
		this.flutter = new FlutterRun(this.args.flutterPath, args.cwd, appArgs, this.args.flutterRunLogFile);

		// Set up subscriptions.
		this.flutter.registerForAppStart(n => { this.log("Building and launching application..."); this.currentRunningAppId = n.appId; });
		this.flutter.registerForAppDebugPort(n => this.initObservatory(n.wsUri));

		return this.flutter.process;
	}

	protected disconnectRequest(
		response: DebugProtocol.DisconnectResponse,
		args: DebugProtocol.DisconnectArguments
	): void {
		if (this.currentRunningAppId)
			this.flutter.stop(this.currentRunningAppId);
		super.disconnectRequest(response, args);
	}
}
