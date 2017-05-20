"use strict";

import * as vs from "vscode";
import * as child_process from "child_process";
import * as fs from "fs";
import { config } from "../config";
import { log, logError, extensionVersion } from "../utils";
import { StdIOService, Request, UnknownResponse, UnknownNotification } from "../services/stdio_service";

export class Flutter extends StdIOService {
	constructor(flutterBinPath: string, projectFolder: string) {
		super("Flutter daemon", config.flutterDaemonLogFile);

		this.createProcess(projectFolder, flutterBinPath, ["daemon"]);
	}

	protected shouldHandleMessage(message: string): boolean {
		// Everything in flutter is wrapped in [] so we can tell what to handle.
		return message.startsWith('[') && message.endsWith(']');
	}

	protected handleNotification(evt: UnknownNotification) {
		switch (evt.event) {
			// case "server.connected":
			// 	this.notify(this.serverConnectedSubscriptions, <as.ServerConnectedNotification>evt.params);
			// 	break;
		}
	}
}
