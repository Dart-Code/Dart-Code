'use strict';

import * as child_process from "child_process";
import * as path from "path";
import {
	DebugSession,
	InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent, Event,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint, ThreadEvent, Variable
} from "vscode-debugadapter";
import { DebugProtocol } from "vscode-debugprotocol";
import { readSdkPath } from "./sdk_path"

export interface DartLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	cwd: string;
	program: string;
	args: Array<string>;
}

export class DartDebugSession extends DebugSession {
	private sourceFile: string;
	private cwd: string;
	private childProcess: child_process.ChildProcess;
	private processExited: boolean = false;
	private sdkPath = readSdkPath();
	private dartPath = this.sdkPath != null ? path.join(this.sdkPath, "bin", "dart") : "dart"; 

	public constructor() {
		super();
	}

	protected initializeRequest(
		response: DebugProtocol.InitializeResponse,
		args: DebugProtocol.InitializeRequestArguments
	): void {
		response.body = {
			supportsConfigurationDoneRequest: true,
			// supportsEvaluateForHovers: true,
			// exceptionBreakpointFilters: [
			// 	{ filter: "All", label: "All Exceptions", default: false },
			// 	{ filter: "Unhandled", label: "Uncaught Exceptions", default: true }
			// ]
		};
		this.sendResponse(response);
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: DartLaunchRequestArguments): void {
		this.cwd = args.cwd;
		this.sourceFile = path.relative(args.cwd, args.program);
		this.sendEvent(new OutputEvent(`dart ${this.sourceFile}\n`));

		this.sendResponse(response);

		let debug = !args.noDebug;
		let appArgs = [];
		// TODO:
		// if (debug) {
		// 	appArgs.push("--enable-vm-service:0");
		// 	appArgs.push("--pause_isolates_on_start=true");
		// }
		appArgs.push(this.sourceFile);
		if (args.args)
			appArgs = appArgs.concat(args.args);

		let process = child_process.spawn(this.dartPath, appArgs, {
			cwd: args.cwd
		});

		this.childProcess = process;

		process.stdout.setEncoding("utf8");
		process.stdout.on("data", (data) => {
			// TODO: look for 'Observatory listening on...'
			this.sendEvent(new OutputEvent(data, "stdout"));
		});
		process.stderr.setEncoding("utf8");
		process.stderr.on("data", (data) => {
			this.sendEvent(new OutputEvent(data, "stderr"));
		});
		process.on("error", (error) => {
			this.sendEvent(new OutputEvent(`error: ${error}\n`));
		});
		process.on("exit", (code, signal) => {
			this.processExited = true;
			if (!code && !signal)
				this.sendEvent(new OutputEvent("finished"));
			else
				this.sendEvent(new OutputEvent(`finished (${signal ? `${signal}`.toLowerCase() : code})`));
			this.sendEvent(new TerminatedEvent());
		});

		if (!debug)
			this.sendEvent(new InitializedEvent());
	}

	protected disconnectRequest(
		response: DebugProtocol.DisconnectResponse,
		args: DebugProtocol.DisconnectArguments
	): void {
		if (this.childProcess != null)
			this.childProcess.kill();
		super.disconnectRequest(response, args);
	}

	protected setBreakPointsRequest(
		response: DebugProtocol.SetBreakpointsResponse,
		args: DebugProtocol.SetBreakpointsArguments
	): void {
		// TODO:
	}

	protected setExceptionBreakPointsRequest(
		response: DebugProtocol.SetExceptionBreakpointsResponse,
		args: DebugProtocol.SetExceptionBreakpointsArguments
	): void {
		// TODO:
	}

	protected configurationDoneRequest(
		response: DebugProtocol.ConfigurationDoneResponse,
		args: DebugProtocol.ConfigurationDoneArguments
	): void {
		this.sendResponse(response);
	}

	protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): void {
		// TODO:
	}

	protected sourceRequest(response: DebugProtocol.SourceResponse, args: DebugProtocol.SourceArguments): void {
		// TODO:
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		// TODO:
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		// TODO:
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		// TODO:
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
		// TODO:
	}

	protected setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): void {
		// TODO:
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		// TODO:
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		// TODO:
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
		// TODO:
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
		// TODO:
	}

	protected stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments): void {
		// unsupported
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
		// TODO:
	}

	protected customRequest(request: string, response: DebugProtocol.Response, args: any): void {
		this.log("[customRequest]");

		switch (request) {
			default:
				super.customRequest(request, response, args);
				break;
		}
	}

	errorResponse(response: DebugProtocol.Response, message: string) {
		response.success = false;
		response.message = message;
		this.sendResponse(response);
	}

	private log(obj) {
		this.sendEvent(new OutputEvent(`${obj}\n`));
	}
}
