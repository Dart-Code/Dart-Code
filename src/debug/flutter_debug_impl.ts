"use strict";

import { DartDebugSession } from "./dart_debug_impl";
import { DebugProtocol } from "vscode-debugprotocol";
import { FlutterLaunchRequestArguments, isWin, fileToUri, uriToFilePath } from "./utils";
import { FlutterRun } from "./flutter_run";
import { TerminatedEvent } from "vscode-debugadapter";
import * as child_process from "child_process";
import * as path from "path";

export class FlutterDebugSession extends DartDebugSession {
	protected args: FlutterLaunchRequestArguments;
	flutter: FlutterRun;
	currentRunningAppId: string;
	observatoryUri: string;
	baseUri: string;

	constructor() {
		super();

		this.sendStdOutToConsole = false;
	}

	protected initializeRequest(
		response: DebugProtocol.InitializeResponse,
		args: DebugProtocol.InitializeRequestArguments
	): void {
		response.body.supportsRestartRequest = true;
		super.initializeRequest(response, args);
	}

	protected spawnProcess(args: FlutterLaunchRequestArguments): any {
		let debug = !args.noDebug;
		let appArgs = [];

		if (this.sourceFile) {
			appArgs.push("-t")
			appArgs.push(this.sourceFile);
		}

		if (this.args.deviceId) {
			appArgs.push("-d")
			appArgs.push(this.args.deviceId);
		}

		if (debug) {
			appArgs.push("--observatory-port=0");
			appArgs.push("--start-paused");
		}

		if (args.args)
			appArgs = appArgs.concat(args.args);

		// TODO: Add log file.
		this.flutter = new FlutterRun(this.args.flutterPath, args.cwd, appArgs, this.args.flutterRunLogFile);
		this.flutter.registerForUnhandledMessages(msg => this.log(msg));

		// Set up subscriptions.
		this.flutter.registerForAppStart(n => this.currentRunningAppId = n.appId);
		this.flutter.registerForAppDebugPort(n => { this.observatoryUri = n.wsUri; this.baseUri = n.baseUri; });
		this.flutter.registerForAppStarted(n => this.initObservatory(this.observatoryUri));

		return this.flutter.process;
	}

	/***
	 * Converts a source path to an array of possible uris.
	 *
	 * For flutter we need to extend the Dart implementation by also providing uris
	 * using the baseUri value returned from `flutter run` to match the fs path
	 * on the device running the application in order for breakpoints to match the
	 * patched `hot reload` code. 
	 */
	protected getPossibleSourceUris(sourcePath: string): string[] {
		const originalUris = super.getPossibleSourceUris(sourcePath);
		const allUris = originalUris.slice();
		const projectUri = fileToUri(this.args.cwd);

		originalUris.forEach(uri => {
			if (uri.startsWith(projectUri)) {
				const relativePath = uri.substr(projectUri.length);
				const mappedPath = path.join(this.baseUri, relativePath);
				const newUri = fileToUri(mappedPath);
				allUris.push(newUri);
				// HACK: See https://github.com/flutter/flutter/issues/11040
				if (newUri.startsWith("file:///"))
					allUris.push(newUri.substring("file://".length));
			}
		});

		return allUris;
	}

	protected convertVMUriToSourcePath(uri: string): string {
		let localPath = super.convertVMUriToSourcePath(uri);
		const basePath = uriToFilePath(this.baseUri);

		// If the path is the baseUri given by flutter, we need to rewrite it into a local path for this machine.		
		if (localPath.startsWith(basePath))
			localPath = path.join(this.args.cwd, path.relative(basePath, localPath));

		return localPath;
	}

	protected disconnectRequest(
		response: DebugProtocol.DisconnectResponse,
		args: DebugProtocol.DisconnectArguments
	): void {
		if (this.currentRunningAppId)
			this.flutter.stop(this.currentRunningAppId);
		super.disconnectRequest(response, args);
	}

	protected restartRequest(
		response: DebugProtocol.RestartResponse,
		args: DebugProtocol.RestartArguments
	): void {
		this.flutter.restart(this.currentRunningAppId, !this.args.noDebug)
		super.restartRequest(response, args);
	}
}
