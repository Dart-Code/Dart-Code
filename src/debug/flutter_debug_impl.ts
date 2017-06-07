"use strict";

import { DartDebugSession, DartLaunchRequestArguments } from "./dart_debug_impl";
import * as child_process from "child_process";
import { DebugProtocol } from "vscode-debugprotocol";
import { FlutterRun } from "./flutter_run";
import { TerminatedEvent } from "vscode-debugadapter";

export class FlutterDebugSession extends DartDebugSession {
	constructor() {
		super();

		this.sendStdOutToConsole = false;
	}

	flutter: FlutterRun;
	currentRunningAppId: string;
	protected spawnProcess(args: DartLaunchRequestArguments): any {
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
		this.flutter = new FlutterRun(this.flutterPath, args.cwd, appArgs, this.flutterRunLogFile);

		// Set up subscriptions.
		this.flutter.registerForAppStart(n => { this.log("Building and launching application..."); this.currentRunningAppId = n.appId; });
		this.flutter.registerForAppDebugPort(n => this.initObservatory(n.wsUri || `ws://127.0.0.1:${n.port}/ws`)); // TODO: Confirm this is correct use for port.

		return this.flutter.process;
	}
}
