import * as child_process from "child_process";
import * as path from "path";
import { Event, OutputEvent, TerminatedEvent, DebugSession, InitializedEvent } from "vscode-debugadapter";
import { DebugProtocol } from "vscode-debugprotocol";
import { DartDebugSession } from "./dart_debug_impl";
import { VMEvent } from "./dart_debug_protocol";
import { FlutterRun } from "./flutter_run";
import { FlutterLaunchRequestArguments, formatPathForVm, isWin, uriToFilePath, safeSpawn } from "./utils";

export class FlutterMultiReloadDebugSession extends DebugSession {
	protected args: FlutterLaunchRequestArguments;
	protected sourceFile: string;
	protected childProcess: child_process.ChildProcess;
	private processExited: boolean = false;

	protected initializeRequest(
		response: DebugProtocol.InitializeResponse,
		args: DebugProtocol.InitializeRequestArguments,
	): void {
		response.body.supportsRestartRequest = true;
		response.body.supportsConfigurationDoneRequest = true;
		this.sendResponse(response);
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: FlutterLaunchRequestArguments): void {
		if (!args || !args.dartPath || !args.program) {
			this.sendEvent(new OutputEvent("Unable to restart debugging. Please try ending the debug session and starting again."));
			this.sendEvent(new TerminatedEvent());
			return;
		}

		this.args = args;
		this.sourceFile = path.relative(args.cwd, args.program);

		this.sendResponse(response);

		this.childProcess = this.spawnProcess(args);
		const process = this.childProcess;

		process.stdout.setEncoding("utf8");
		process.stdout.on("data", (data) => {
			this.sendEvent(new OutputEvent(data.toString(), "stdout"));
		});
		process.stderr.setEncoding("utf8");
		process.stderr.on("data", (data) => {
			this.sendEvent(new OutputEvent(data.toString(), "stderr"));
		});
		process.on("error", (error) => {
			this.sendEvent(new OutputEvent(`Error: ${error}\n`));
		});
		process.on("exit", (code, signal) => {
			this.processExited = true;
			if (!code && !signal)
				this.sendEvent(new OutputEvent("Exited"));
			else
				this.sendEvent(new OutputEvent(`Exited (${signal ? `${signal}`.toLowerCase() : code})`));
			this.sendEvent(new TerminatedEvent());
		});

		if (args.noDebug)
			this.sendEvent(new InitializedEvent());
	}

	protected configurationDoneRequest(
		response: DebugProtocol.ConfigurationDoneResponse,
		args: DebugProtocol.ConfigurationDoneArguments,
	): void {
		this.sendResponse(response);
	}

	protected spawnProcess(args: FlutterLaunchRequestArguments): any {
		const debug = !args.noDebug;
		let appArgs = ["run"];

		if (this.sourceFile) {
			appArgs.push("-t");
			appArgs.push(this.sourceFile);
		}

		if (args.deviceId) {
			appArgs.push("-d");
			appArgs.push(args.deviceId);
		}

		if (args.previewDart2) {
			appArgs.push("--preview-dart-2");
		} else if (args.previewDart2 === false) {
			appArgs.push(`--no-preview-dart-2`);
		}

		if (args.flutterMode === "profile") {
			appArgs.push("--profile");
		} else if (args.flutterMode === "release") {
			appArgs.push("--release");
		}

		if (args.args) {
			appArgs = appArgs.concat(args.args);
		}

		return safeSpawn(args.cwd, this.args.flutterPath, appArgs);
	}

	protected async disconnectRequest(
		response: DebugProtocol.DisconnectResponse,
		args: DebugProtocol.DisconnectArguments,
	): Promise<void> {
		this.childProcess.stdin._write("q", "utf8", () => ({}));
		await this.delay(100);
		if (this.childProcess != null)
			this.childProcess.kill();
		super.disconnectRequest(response, args);
	}

	private delay(milliseconds: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, milliseconds));
	}

	protected restartRequest(
		response: DebugProtocol.RestartResponse,
		args: DebugProtocol.RestartArguments,
	): void {
		this.performReload(false);
		super.restartRequest(response, args);
	}

	protected customRequest(request: string, response: DebugProtocol.Response, args: any): void {
		switch (request) {
			case "hotReload":
				this.performReload(false);
				break;

			case "fullRestart":
				this.performReload(true);
				break;

			default:
				super.customRequest(request, response, args);
				break;
		}
	}

	private performReload(fullRestart: boolean) {
		this.childProcess.stdin._write(fullRestart ? "R" : "r", "utf8", () => ({}));
	}
}
