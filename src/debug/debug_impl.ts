"use strict";

import * as child_process from "child_process";
import * as path from "path";
import {
	DebugSession,
	InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent, Event,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint, ThreadEvent, Variable
} from "vscode-debugadapter";
import { DebugProtocol } from "vscode-debugprotocol";
import { PackageMap, uriToFilePath, fileToUri, PromiseCompleter } from "./utils";
import {
	ObservatoryConnection, VMEvent, VMIsolateRef, RPCError, DebuggerResult, VMStack, VMSentinel, VMObj,
	VMFrame, VMFuncRef, VMInstanceRef, VMScriptRef, VMScript, VMSourceLocation, VMErrorRef, VMBreakpoint,
	VMInstance, VMResponse, VMClassRef
} from "./debug_protocol";

// TODO: modules? ModuleEvent
// TODO: supportsSetVariable
// TODO: class variables?
// TODO: library variables?
// TODO: break large arrays into subarrays
// TODO: should we call toString() on objects that don't have valueAsString?

export interface DartLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	cwd: string;
	sdkPath: string;
	program: string;
	args: Array<string>;
}

export class DartDebugSession extends DebugSession {
	private sourceFile: string;
	private cwd: string;
	private sdkPath: string;
	private dartPath: string;
	private childProcess: child_process.ChildProcess;
	private processExited: boolean = false;
	observatory: ObservatoryConnection;
	private threadManager: ThreadManager;
	private packageMap: PackageMap;

	public constructor() {
		super();

		this.threadManager = new ThreadManager(this);
	}

	protected initializeRequest(
		response: DebugProtocol.InitializeResponse,
		args: DebugProtocol.InitializeRequestArguments
	): void {
		response.body = {
			supportsConfigurationDoneRequest: true,
			supportsEvaluateForHovers: true,
			exceptionBreakpointFilters: [
				{ filter: "All", label: "All Exceptions", default: false },
				{ filter: "Unhandled", label: "Uncaught Exceptions", default: true }
			]
		};
		this.sendResponse(response);
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: DartLaunchRequestArguments): void {
		this.cwd = args.cwd;
		this.sdkPath = args.sdkPath;
		this.dartPath = this.sdkPath != null ? path.join(this.sdkPath, "bin", "dart") : "dart";
		this.sourceFile = path.relative(args.cwd, args.program);
		this.sendEvent(new OutputEvent(`dart ${this.sourceFile}\n`));

		this.packageMap = new PackageMap(PackageMap.findPackagesFile(args.program));

		this.sendResponse(response);

		let debug = !args.noDebug;
		let appArgs = [];
		if (debug) {
			appArgs.push("--enable-vm-service:0");
			appArgs.push("--pause_isolates_on_start=true");
		}
		appArgs.push(this.sourceFile);
		if (args.args)
			appArgs = appArgs.concat(args.args);

		let process = child_process.spawn(this.dartPath, appArgs, {
			cwd: args.cwd
		});

		this.childProcess = process;

		process.stdout.setEncoding("utf8");
		process.stdout.on("data", (data) => {
			let match: RegExpExecArray;
			if (!this.observatory) {
				match = ObservatoryConnection.portRegex.exec(data);
			}

			if (match) {
				this.initObservatory(match[1]);
			} else {
				this.sendEvent(new OutputEvent(data, "stdout"));
			}
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

	private initObservatory(uri: string) {
		this.observatory = new ObservatoryConnection(`${uri}/ws`);
		this.observatory.onLogging(message => {
			this.sendEvent(new OutputEvent(`${message.trim()}\n`));
		});
		this.observatory.onOpen(() => {
			this.observatory.on("Isolate", (event: VMEvent) => this.handleIsolateEvent(event));
			this.observatory.on("Debug", (event: VMEvent) => this.handleDebugEvent(event));
			this.sendEvent(new InitializedEvent());
		});

		this.observatory.onClose((code: number, message: string) => {
			// This event arives before the process exit event.
			setTimeout(() => {
				if (!this.processExited)
					this.sendEvent(new TerminatedEvent());
			}, 100);
		});
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
		let source: DebugProtocol.Source = args.source;
		let breakpoints: DebugProtocol.SourceBreakpoint[] = args.breakpoints;
		if (!breakpoints)
			breakpoints = [];

		let sourcePath = source.path;
		let uri = this.packageMap.convertFileToPackageUri(sourcePath);
		if (!uri)
			uri = fileToUri(sourcePath);

		this.threadManager.setBreakpoints(uri, breakpoints).then((result: boolean[]) => {
			let bpResponse = [];
			for (let verified of result) {
				bpResponse.push({ verified: verified });
			}

			response.body = { breakpoints: bpResponse };
			this.sendResponse(response);
		}).catch((error) => this.errorResponse(response, `${error}`));
	}

	protected setExceptionBreakPointsRequest(
		response: DebugProtocol.SetExceptionBreakpointsResponse,
		args: DebugProtocol.SetExceptionBreakpointsArguments
	): void {
		let filters: string[] = args.filters;

		let mode = "None";
		if (filters.indexOf("Unhandled") != -1)
			mode = "Unhandled";
		if (filters.indexOf("All") != -1)
			mode = "All";

		this.threadManager.setExceptionPauseMode(mode);

		this.sendResponse(response);
	}

	protected configurationDoneRequest(
		response: DebugProtocol.ConfigurationDoneResponse,
		args: DebugProtocol.ConfigurationDoneArguments
	): void {
		this.sendResponse(response);

		this.threadManager.receivedConfigurationDone();
	}

	protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): void {
		let thread = this.threadManager.getThreadInfoFromNumber(args.threadId);

		if (!thread) {
			this.errorResponse(response, `No thread with id ${args.threadId}`);
			return;
		}

		this.observatory.pause(thread.ref.id)
			.then((_) => this.sendResponse(response))
			.catch((error) => this.errorResponse(response, `${error}`));
	}

	protected sourceRequest(response: DebugProtocol.SourceResponse, args: DebugProtocol.SourceArguments): void {
		let sourceReference = args.sourceReference;
		let data = this.threadManager.getStoredData(sourceReference);
		let scriptRef: VMScriptRef = <VMScriptRef>data.data;

		data.thread.getScript(scriptRef).then((script: VMScript) => {
			response.body = { content: script.source };
			this.sendResponse(response);
		}).catch((error) => this.errorResponse(response, `${error}`));
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		response.body = { threads: this.threadManager.getThreads() };
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		let thread = this.threadManager.getThreadInfoFromNumber(args.threadId);
		let startFrame: number = args.startFrame;
		let levels: number = args.levels;

		if (!thread) {
			this.errorResponse(response, `No thread with id ${args.threadId}`);
			return;
		}

		this.observatory.getStack(thread.ref.id).then((result: DebuggerResult) => {
			let stack: VMStack = <VMStack>result.result;
			let vmFrames: VMFrame[] = stack.frames;
			let totalFrames = vmFrames.length;

			if (!startFrame)
				startFrame = 0;
			if (!levels)
				levels = totalFrames;
			if (startFrame + levels > totalFrames)
				levels = totalFrames - startFrame;
			vmFrames = vmFrames.slice(startFrame, startFrame + levels);

			let stackFrames: StackFrame[] = [];
			let promises = [];

			vmFrames.forEach((frame: VMFrame) => {
				let frameId = thread.storeData(frame);
				let location: VMSourceLocation = frame.location;
				let uri = location.script.uri;
				let shortName = this.convertVMUriToUserName(uri);
				let sourcePath = this.convertVMUriToSourcePath(uri);

				// Download the source if from a "dart:" uri.
				let sourceReference: number;
				if (uri.startsWith("dart:")) {
					sourcePath = null;
					sourceReference = thread.storeData(location.script);
				}

				let func: VMFuncRef = frame.function;
				let frameName = func.name;
				if (func.owner.type == "@Class") {
					let owner = <VMClassRef>func.owner;
					frameName = owner.name + "." + frameName;
				}

				let stackFrame: StackFrame = new StackFrame(
					frameId,
					frameName,
					new Source(shortName, sourcePath, sourceReference, null, location.script),
					0, 0
				);
				stackFrames.push(stackFrame);

				// Resolve the line and column information.
				let promise = thread.getScript(location.script).then((script: VMScript) => {
					let fileLocation: FileLocation = this.resolveFileLocation(script, location.tokenPos);
					if (fileLocation) {
						stackFrame.line = fileLocation.line;
						stackFrame.column = fileLocation.column;
					}
				});
				promises.push(promise);
			});

			response.body = {
				stackFrames: stackFrames,
				totalFrames: totalFrames
			};

			Promise.all(promises).then((_) => {
				this.sendResponse(response);
			}).catch((_) => {
				this.sendResponse(response);
			});
		}).catch((error) => this.errorResponse(response, `${error}`));
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		let frameId = args.frameId;
		let data = this.threadManager.getStoredData(frameId);
		let frame: VMFrame = <VMFrame>data.data;

		// TODO: class variables? library variables?

		let variablesReference = data.thread.storeData(frame);
		response.body = {
			scopes: [new Scope("Locals", variablesReference)]
		};
		this.sendResponse(response);
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
		let variablesReference = args.variablesReference;
		let data = this.threadManager.getStoredData(variablesReference);
		let thread = data.thread;

		if (data.data.type == "Frame") {
			let frame: VMFrame = <VMFrame>data.data;
			let variables: DebugProtocol.Variable[] = [];
			for (let variable of frame.vars)
				variables.push(this.instanceRefToVariable(thread, variable.name, variable.value));
			response.body = { variables: variables };
			this.sendResponse(response);
		} else {
			let instanceRef = <VMInstanceRef>data.data;

			// let offset = 0;
			// let count = 0;
			// if (instanceRef.kind == "List" || instanceRef.kind == "Map") {
			//   offset = 0;
			//   // TODO: We should cap this, and report that the list is truncated.
			//   count = instanceRef.length;
			// }

			this.observatory.getObject(thread.ref.id, instanceRef.id).then((result: DebuggerResult) => {
				let variables: DebugProtocol.Variable[] = [];

				if (result.result.type == "Sentinel") {
					variables.push({
						name: "evalError",
						value: (<VMSentinel>result.result).valueAsString,
						variablesReference: 0
					});
				} else {
					let obj: VMObj = <VMObj>result.result;

					if (obj.type == "Instance") {
						let instance = <VMInstance>obj;

						// TODO: show by kind instead

						if (instance.elements) {
							let len = instance.elements.length;
							for (let i = 0; i < len; i++) {
								let element = instance.elements[i];
								variables.push(this.instanceRefToVariable(thread, `[${i}]`, element));
							}
						} else if (instance.associations) {
							for (let association of instance.associations) {
								let keyName = this.valueAsString(association.key);
								if (!keyName) {
									if (association.key.type == "Sentinel")
										keyName = "<evalError>";
									else
										keyName = (<VMInstanceRef>association.key).id;
								}
								variables.push(this.instanceRefToVariable(thread, keyName, association.value));
							}
						} else if (instance.fields) {
							for (let field of instance.fields)
								variables.push(this.instanceRefToVariable(thread, field.decl.name, field.value));
						} else {
							// TODO: unhandled kind
							this.log(instance.kind);
						}
					} else {
						// TODO: unhandled type
						this.log(obj.type);
					}
				}

				response.body = { variables: variables };
				this.sendResponse(response);
			}).catch((error) => this.errorResponse(response, `${error}`));
		}
	}

	private callToString(isolate: VMIsolateRef, instanceRef: VMInstanceRef): Promise<string> {
		return this.observatory.evaluate(isolate.id, instanceRef.id, "toString()").then((result: DebuggerResult) => {
			if (result.result.type == "@Error") {
				return null;
			} else {
				let evalResult: VMInstanceRef = <VMInstanceRef>result.result;
				return this.valueAsString(evalResult);
			}
		}).catch((e) => null);
	}

	protected setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): void {
		let variablesReference: number = args.variablesReference;
		// The name of the variable.
		let name: string = args.name;
		// The value of the variable.
		let value: string = args.value;

		// TODO: Use eval to implement this.
		this.errorResponse(response, "not supported");
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		let thread = this.threadManager.getThreadInfoFromNumber(args.threadId);
		if (!thread) {
			this.errorResponse(response, `No thread with id ${args.threadId}`);
			return;
		}
		this.observatory.resume(thread.ref.id).then((_) => {
			thread.handleResumed();
			response.body = { allThreadsContinued: false };
			this.sendResponse(response);
		}).catch((error) => this.errorResponse(response, `${error}`));
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		let thread = this.threadManager.getThreadInfoFromNumber(args.threadId);
		if (!thread) {
			this.errorResponse(response, `No thread with id ${args.threadId}`);
			return;
		}
		let type = thread.atAsyncSuspension ? "OverAsyncSuspension" : "Over";
		this.observatory.resume(thread.ref.id, type).then((_) => {
			thread.handleResumed();
			this.sendResponse(response);
		}).catch((error) => this.errorResponse(response, `${error}`));
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
		let thread = this.threadManager.getThreadInfoFromNumber(args.threadId);
		if (!thread) {
			this.errorResponse(response, `No thread with id ${args.threadId}`);
			return;
		}
		this.observatory.resume(thread.ref.id, "Into").then((_) => {
			thread.handleResumed();
			this.sendResponse(response);
		}).catch((error) => this.errorResponse(response, `${error}`));
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
		let thread = this.threadManager.getThreadInfoFromNumber(args.threadId);
		if (!thread) {
			this.errorResponse(response, `No thread with id ${args.threadId}`);
			return;
		}
		this.observatory.resume(thread.ref.id, "Out").then((_) => {
			thread.handleResumed();
			this.sendResponse(response);
		}).catch((error) => this.errorResponse(response, `${error}`));
	}

	protected stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments): void {
		// unsupported
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
		let expression: string = args.expression;
		// Stack frame scope; if not specified, the expression is evaluated in the global scope.
		let frameId: number = args.frameId;
		// Values are "watch", "repl", and "hover".
		let context: string = args.context;

		if (!frameId) {
			this.errorResponse(response, "global evaluation not supported");
			return;
		}

		let data = this.threadManager.getStoredData(frameId);
		let thread = data.thread;
		let frame: VMFrame = <VMFrame>data.data;

		this.observatory.evaluateInFrame(thread.ref.id, frame.index, expression).then((result: DebuggerResult) => {
			// InstanceRef or ErrorRef
			if (result.result.type == "@Error") {
				let error: VMErrorRef = <VMErrorRef>result.result;
				let str: string = error.message;
				if (str && str.length > 100)
					str = str.substring(0, 100) + "…";
				this.errorResponse(response, str);
			} else {
				let instanceRef: VMInstanceRef = <VMInstanceRef>result.result;
				if (instanceRef.valueAsString) {
					response.body = {
						result: this.valueAsString(instanceRef),
						variablesReference: 0
					};
				} else {
					response.body = {
						result: instanceRef.class.name,
						variablesReference: thread.storeData(instanceRef)
					};
				}
				this.sendResponse(response);
			}
		}).catch((error) => this.errorResponse(response, `${error}`));
	}

	protected customRequest(request: string, response: DebugProtocol.Response, args: any): void {
		this.log("[customRequest]");

		switch (request) {
			default:
				super.customRequest(request, response, args);
				break;
		}
	}

	// IsolateStart, IsolateRunnable, IsolateExit, IsolateUpdate, ServiceExtensionAdded
	handleIsolateEvent(event: VMEvent) {
		let kind = event.kind;
		if (kind == "IsolateStart" || kind == "IsolateRunnable") {
			this.threadManager.registerThread(event.isolate, kind);
		} else if (kind == "IsolateExit") {
			this.threadManager.handleIsolateExit(event.isolate);
		}
	}

	// PauseStart, PauseExit, PauseBreakpoint, PauseInterrupted, PauseException, Resume,
	// BreakpointAdded, BreakpointResolved, BreakpointRemoved, Inspect, None
	handleDebugEvent(event: VMEvent) {
		let kind = event.kind;

		if (kind == "PauseStart") {
			// "PauseStart" should auto-resume after breakpoints are set.
			let thread = this.threadManager.getThreadInfoFromRef(event.isolate);
			thread.receivedPauseStart();
		} else if (kind.startsWith("Pause")) {
			let thread = this.threadManager.getThreadInfoFromRef(event.isolate);

			// PauseStart, PauseExit, PauseBreakpoint, PauseInterrupted, PauseException
			let reason = "pause";
			let exceptionText = null;

			if (kind == "PauseBreakpoint") {
				reason = "breakpoint";
				if (event.pauseBreakpoints == null || event.pauseBreakpoints.length == 0) {
					reason = "step";
				}
			}

			if (kind == "PauseException") {
				reason = "exception";
				exceptionText = this.valueAsString(event.exception);
				if (!exceptionText)
					exceptionText = event.exception.class.name;
				// TODO: Call toString()?
				this.sendEvent(new OutputEvent(`breaking at exception: ${exceptionText}\n`));
			}

			thread.handlePaused(event.atAsyncSuspension);

			this.sendEvent(new StoppedEvent(reason, thread.number, exceptionText));
		}
	}

	errorResponse(response: DebugProtocol.Response, message: string) {
		response.success = false;
		response.message = message;
		this.sendResponse(response);
	}

	private convertVMUriToUserName(uri: string): string {
		if (uri.startsWith("file:")) {
			uri = uriToFilePath(uri);
			uri = path.relative(this.cwd, uri);
		}

		return uri;
	}

	private convertVMUriToSourcePath(uri: string): string {
		if (uri.startsWith("file:"))
			return uriToFilePath(uri);

		if (uri.startsWith("package:"))
			return this.packageMap.resolvePackageUri(uri);

		return uri;
	}

	private valueAsString(ref: VMInstanceRef | VMSentinel): string {
		if (ref.type == "Sentinel")
			return ref.valueAsString;

		let instanceRef = <VMInstanceRef>ref;

		if (ref.valueAsString) {
			let str: string = instanceRef.valueAsString;
			if (instanceRef.valueAsStringIsTruncated)
				str += "…";
			if (instanceRef.kind == 'String')
				str = `'${str}'`;
			return str;
		} else if (ref.kind == 'List') {
			return `[${instanceRef.length}]`;
		} else if (ref.kind == 'Map') {
			return `{${instanceRef.length}}`;
		} else {
			return instanceRef.class.name;
		}
	}

	private instanceRefToVariable(
		thread: ThreadInfo, name: string, ref: VMInstanceRef | VMSentinel
	): DebugProtocol.Variable {
		if (ref.type == "Sentinel") {
			return {
				name: name,
				value: (<VMSentinel>ref).valueAsString,
				variablesReference: 0
			};
		} else {
			let val = <VMInstanceRef>ref;

			let str = this.valueAsString(val);
			if (!val.valueAsString && !str)
				str = '';

			return {
				name: name,
				type: val.class.name,
				value: str,
				variablesReference: val.valueAsString ? 0 : thread.storeData(val)
			};
		}
	}

	private resolveFileLocation(script: VMScript, tokenPos: number): FileLocation {
		let table: number[][] = script.tokenPosTable;
		for (let entry of table) {
			// [lineNumber, (tokenPos, columnNumber)*]
			for (let index = 1; index < entry.length; index += 2) {
				if (entry[index] == tokenPos) {
					let line = entry[0];
					return new FileLocation(line, entry[index + 1]);
				}
			}
		}

		return null;
	}

	private log(obj) {
		this.sendEvent(new OutputEvent(`${obj}\n`));
	}
}

class ThreadManager {
	nextThreadId: number = 0;

	threads: ThreadInfo[] = [];
	debugSession: DartDebugSession;
	bps = {};
	private hasConfigurationDone = false;
	private exceptionMode = "Unhandled";

	constructor(debugSession: DartDebugSession) {
		this.debugSession = debugSession;
	}

	registerThread(ref: VMIsolateRef, eventKind: string) {
		let thread: ThreadInfo = this.getThreadInfoFromRef(ref);

		if (!thread) {
			thread = new ThreadInfo(this, ref, this.nextThreadId);
			this.nextThreadId++;
			this.threads.push(thread);

			// If this is the first time we"ve seen it, fire an event
			this.debugSession.sendEvent(new ThreadEvent("started", thread.number));

			if (this.hasConfigurationDone)
				thread.receivedConfigurationDone();
		}

		// If it"s just become runnable (IsolateRunnable), then set breakpoints.
		if (eventKind == "IsolateRunnable") {
			thread.runnable = true;

			this.debugSession.observatory.setExceptionPauseMode(thread.ref.id, this.exceptionMode);

			let promises = []
			for (let uri of Object.keys(this.bps)) {
				promises.push(thread.setBreakpoints(uri, this.bps[uri]));
			}
			Promise.all(promises).then((_) => {
				thread.setInitialBreakpoints();
			});
		}
	}

	receivedConfigurationDone() {
		this.hasConfigurationDone = true;

		for (let thread of this.threads)
			thread.receivedConfigurationDone();
	}

	getThreadInfoFromRef(ref: VMIsolateRef): ThreadInfo {
		for (let thread of this.threads) {
			if (thread.ref.id == ref.id)
				return thread;
		}
		return null;
	}

	getThreadInfoFromNumber(num: number): ThreadInfo {
		for (let thread of this.threads) {
			if (thread.number == num)
				return thread;
		}
		return null;
	}

	getThreads(): Thread[] {
		return this.threads.map((thread: ThreadInfo) => new Thread(thread.number, thread.ref.name));
	}

	setExceptionPauseMode(mode: string) {
		this.exceptionMode = mode;

		for (let thread of this.threads) {
			if (thread.runnable)
				this.debugSession.observatory.setExceptionPauseMode(thread.ref.id, mode);
		}
	}

	setBreakpoints(uri: string, breakpoints: DebugProtocol.SourceBreakpoint[]): Promise<boolean[]> {
		// Remember these bps for when new threads start.
		if (breakpoints.length == 0)
			delete this.bps[uri];
		else
			this.bps[uri] = breakpoints;

		let promise;

		for (let thread of this.threads) {
			if (thread.runnable) {
				let result = thread.setBreakpoints(uri, breakpoints);
				if (!promise)
					promise = result;
			}
		}

		if (promise)
			return promise;

		let completer = new PromiseCompleter();
		let result = [];
		for (let i = 0; i < breakpoints.length; i++) {
			result.push(true);
		}
		completer.resolve(result);
		return completer.promise;
	}

	nextDataId: number = 1;
	storedData = {};

	storeData(thread: ThreadInfo, data: VMResponse): number {
		let id = this.nextDataId;
		this.nextDataId++;
		this.storedData[id] = new StoredData(thread, data);
		return id;
	}

	getStoredData(id: number): StoredData {
		return this.storedData[id];
	}

	removeStoredIds(ids: number[]) {
		for (let id of ids) {
			delete this.storeData[id];
		}
	}

	handleIsolateExit(ref: VMIsolateRef) {
		let threadInfo: ThreadInfo = this.getThreadInfoFromRef(ref);
		this.debugSession.sendEvent(new ThreadEvent("exited", threadInfo.number));
		this.threads.splice(this.threads.indexOf(threadInfo), 1);
	}
}

class StoredData {
	thread: ThreadInfo;
	data: VMResponse;

	constructor(thread: ThreadInfo, data: VMResponse) {
		this.thread = thread;
		this.data = data;
	}
}

class ThreadInfo {
	manager: ThreadManager;
	ref: VMIsolateRef;
	number: number;
	storedIds: number[] = [];
	scriptCompleters: { [key: string]: PromiseCompleter<VMScript> } = {};
	runnable: boolean = false;
	vmBps = {};
	atAsyncSuspension: boolean = false;

	constructor(manager: ThreadManager, ref: VMIsolateRef, number: number) {
		this.manager = manager;
		this.ref = ref;
		this.number = number;
	}

	setBreakpoints(uri: string, breakpoints: DebugProtocol.SourceBreakpoint[]): Promise<boolean[]> {
		// Remove all current bps.
		let oldbps = this.vmBps[uri];
		if (oldbps) {
			for (let bp of oldbps) {
				this.manager.debugSession.observatory.removeBreakpoint(this.ref.id, bp.id);
			}
		}

		this.vmBps[uri] = [];

		// Set new ones.
		let promises = [];

		for (let bp of breakpoints) {
			let promise = this.manager.debugSession.observatory.addBreakpointWithScriptUri(
				this.ref.id, uri, bp.line, bp.column
			).then((result: DebuggerResult) => {
				let vmBp: VMBreakpoint = <VMBreakpoint>result.result;
				this.vmBps[uri].push(vmBp);
				return true;
			}).catch((error) => {
				return false;
			});

			promises.push(promise);
		}

		return Promise.all(promises);
	}

	private gotPauseStart = false;
	private initialBreakpoints = false;
	private hasConfigurationDone = false;

	receivedPauseStart() {
		this.gotPauseStart = true;
		this.checkResume();
	}

	setInitialBreakpoints() {
		this.initialBreakpoints = true;
		this.checkResume();
	}

	receivedConfigurationDone() {
		this.hasConfigurationDone = true;
		this.checkResume();
	}

	checkResume() {
		if (this.gotPauseStart && this.initialBreakpoints && this.hasConfigurationDone)
			this.manager.debugSession.observatory.resume(this.ref.id);
	}

	handleResumed() {
		// TODO: I don"t think we want to do this...
		// this.manager.removeStoredIds(this.storedIds);
		// this.storedIds = [];
		this.atAsyncSuspension = false;
	}

	getScript(scriptRef: VMScriptRef): Promise<VMScript> {
		let scriptId = scriptRef.id;

		if (this.scriptCompleters[scriptId]) {
			let completer: PromiseCompleter<VMScript> = this.scriptCompleters[scriptId];
			return completer.promise;
		} else {
			let completer: PromiseCompleter<VMScript> = new PromiseCompleter();;
			this.scriptCompleters[scriptId] = completer;

			let observatory = this.manager.debugSession.observatory;
			observatory.getObject(this.ref.id, scriptRef.id).then((result: DebuggerResult) => {
				let script: VMScript = <VMScript>result.result;
				completer.resolve(script);
			}).catch((error) => {
				completer.reject(error);
			});

			return completer.promise;
		}
	}

	storeData(data: VMResponse): number {
		return this.manager.storeData(this, data);
	}

	handlePaused(atAsyncSuspension?: boolean) {
		this.atAsyncSuspension = atAsyncSuspension;
	}
}

class FileLocation {
	line: number;
	column: number;

	constructor(line: number, column: number) {
		this.line = line;
		this.column = column;
	}
}
