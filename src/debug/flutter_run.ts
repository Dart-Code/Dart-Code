"use strict";

import { StdIOService, Request, UnknownResponse, UnknownNotification } from "../services/stdio_service";
import * as child_process from "child_process";
import * as f from "../flutter/flutter_types";
import * as fs from "fs";
import { Disposable } from "vscode";

export class FlutterRun extends StdIOService {
	constructor(flutterBinPath: string, projectFolder: string, args: string[], logFile: string) {
		super(logFile, true);

		this.createProcess(projectFolder, flutterBinPath, ["run", "--machine"].concat(args));
	}

	protected shouldHandleMessage(message: string): boolean {
		// Everything in flutter is wrapped in [] so we can tell what to handle.
		return message.startsWith('[') && message.endsWith(']');
	}

	// TODO: Can we code-gen all this like the analysis server?

	protected handleNotification(evt: UnknownNotification) {
		//console.log(JSON.stringify(evt));
		switch (evt.event) {
			case "app.start":
				this.notify(this.appStartSubscriptions, <f.AppStart>evt.params);
				break;
			case "app.debugPort":
				this.notify(this.appDebugPortSubscriptions, <f.AppDebugPort>evt.params);
				break;
			case "app.started":
				this.notify(this.appStartedSubscriptions, <f.AppEvent>evt.params);
				break;
			case "app.stop":
				this.notify(this.appStopSubscriptions, <f.AppEvent>evt.params);
				break;
		}
	}

	// Subscription lists.	

	private appStartSubscriptions: ((notification: f.AppStart) => void)[] = [];
	private appDebugPortSubscriptions: ((notification: f.AppDebugPort) => void)[] = [];
	private appStartedSubscriptions: ((notification: f.AppEvent) => void)[] = [];
	private appStopSubscriptions: ((notification: f.AppEvent) => void)[] = [];


	// Request methods.

	stop(appId: string): Thenable<UnknownResponse> {
		return this.sendRequest("app.stop", { "appId": appId });
	}


	// Subscription methods.

	registerForAppStart(subscriber: (notification: f.AppStart) => void): Disposable {
		return this.subscribe(this.appStartSubscriptions, subscriber);
	}

	registerForAppDebugPort(subscriber: (notification: f.AppDebugPort) => void): Disposable {
		return this.subscribe(this.appDebugPortSubscriptions, subscriber);
	}

	registerForAppStarted(subscriber: (notification: f.AppEvent) => void): Disposable {
		return this.subscribe(this.appStartedSubscriptions, subscriber);
	}

	registerForAppStop(subscriber: (notification: f.AppEvent) => void): Disposable {
		return this.subscribe(this.appStopSubscriptions, subscriber);
	}
}
