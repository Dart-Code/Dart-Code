"use strict";

import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
	DebugSession,
	InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent, Event,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint, ThreadEvent, Variable, ModuleEvent,
	Module,
} from "vscode-debugadapter";
import { DebugProtocol } from "vscode-debugprotocol";
import { PackageMap, uriToFilePath, PromiseCompleter, getLocalPackageName, isWin, DartLaunchRequestArguments, formatPathForVm } from "./utils";
import {
	ObservatoryConnection, VMEvent, VMIsolateRef, RPCError, DebuggerResult, VMStack, VMSentinel, VMObj,
	VMFrame, VMFuncRef, VMInstanceRef, VMScriptRef, VMScript, VMSourceLocation, VMErrorRef, VMBreakpoint,
	VMInstance, VMResponse, VMClassRef, VM, VMIsolate, VMLibraryRef, VMCodeRef,
} from "./dart_debug_protocol";

// TODO: supportsSetVariable
// TODO: class variables?
// TODO: library variables?
// stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments): void;
// restartFrameRequest(response: DebugProtocol.RestartFrameResponse, args: DebugProtocol.RestartFrameArguments): void;
// completionsRequest(response: DebugProtocol.CompletionsResponse, args: DebugProtocol.CompletionsArguments): void;

export class DartDebugSession extends DebugSession {
	protected args: DartLaunchRequestArguments;
	// TODO: Tidy all this up
	protected sourceFile: string;
	protected childProcess: child_process.ChildProcess;
	private processExited: boolean = false;
	public observatory: ObservatoryConnection;
	private observatoryLogStream: fs.WriteStream;
	private threadManager: ThreadManager;
	private packageMap: PackageMap;
	private localPackageName: string;
	protected sendStdOutToConsole: boolean = true;

	public constructor() {
		super();

		this.threadManager = new ThreadManager(this);
	}

	protected initializeRequest(
		response: DebugProtocol.InitializeResponse,
		args: DebugProtocol.InitializeRequestArguments,
	): void {
		response.body.supportsConfigurationDoneRequest = true;
		response.body.supportsEvaluateForHovers = true;
		response.body.exceptionBreakpointFilters = [
			{ filter: "All", label: "All Exceptions", default: false },
			{ filter: "Unhandled", label: "Uncaught Exceptions", default: true },
		];
		this.sendResponse(response);
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: DartLaunchRequestArguments): void {
		if (!args || !args.dartPath || !args.program) {
			this.sendEvent(new OutputEvent("Unable to restart debugging. Please try ending the debug session and starting again."));
			this.sendEvent(new TerminatedEvent());
			return;
		}

		this.args = args;
		this.sourceFile = path.relative(args.cwd, args.program);
		this.packageMap = new PackageMap(PackageMap.findPackagesFile(args.program));
		this.localPackageName = getLocalPackageName(args.program);

		this.sendResponse(response);

		this.childProcess = this.spawnProcess(args);
		const process = this.childProcess;

		process.stdout.setEncoding("utf8");
		process.stdout.on("data", (data) => {
			let match: RegExpExecArray;
			if (!this.observatory) {
				match = ObservatoryConnection.portRegex.exec(data.toString());
			}

			if (match) {
				let uri = match[1].trim();

				// In SDK 1.22, trailing slash was added to the url (see #215).
				if (!uri.endsWith("/"))
					uri = uri + "/";

				this.initObservatory(`${uri}ws`);
			} else if (this.sendStdOutToConsole)
				this.sendEvent(new OutputEvent(data.toString(), "stdout"));
		});
		process.stderr.setEncoding("utf8");
		process.stderr.on("data", (data) => {
			this.sendEvent(new OutputEvent(data.toString(), "stderr"));
		});
		process.on("error", (error) => {
			this.sendEvent(new OutputEvent(`error: ${error}\n`));
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

	protected spawnProcess(args: DartLaunchRequestArguments) {
		const debug = !args.noDebug;
		let appArgs = [];
		if (debug) {
			appArgs.push("--enable-vm-service=0");
			appArgs.push("--pause_isolates_on_start=true");
		}
		if (args.checkedMode) {
			appArgs.push("--checked");
		}
		appArgs.push(this.sourceFile);
		if (args.args)
			appArgs = appArgs.concat(args.args);

		const process = child_process.spawn(this.args.dartPath, appArgs, { cwd: args.cwd });

		return process;
	}

	protected initObservatory(uri: string) {
		// Send the uri back to the editor so it can be used to launch browsers etc.
		if (uri.endsWith("/ws")) {
			let browserFriendlyUri = uri.substring(0, uri.length - 3);
			if (browserFriendlyUri.startsWith("ws:"))
				browserFriendlyUri = "http:" + browserFriendlyUri.substring(3);
			this.sendEvent(new Event("dart.observatoryUri", { observatoryUri: browserFriendlyUri.toString() }));
		}
		this.observatory = new ObservatoryConnection(uri);
		this.observatory.onLogging((message) => {
			const max: number = 2000;

			if (this.args.observatoryLogFile) {
				if (!this.observatoryLogStream)
					this.observatoryLogStream = fs.createWriteStream(this.args.observatoryLogFile);
				this.observatoryLogStream.write(`[${(new Date()).toLocaleTimeString()}]: `);
				if (message.length > max)
					this.observatoryLogStream.write(message.substring(0, max) + "…\r\n");
				else
					this.observatoryLogStream.write(message.trim() + "\r\n");
			}
		});
		this.observatory.onOpen(() => {
			this.observatory.on("Isolate", (event: VMEvent) => this.handleIsolateEvent(event));
			this.observatory.on("Debug", (event: VMEvent) => this.handleDebugEvent(event));
			this.observatory.getVM().then((result) => {
				const vm: VM = result.result as VM;
				const promises = [];

				for (const isolateRef of vm.isolates) {
					promises.push(this.observatory.getIsolate(isolateRef.id).then((response) => {
						const isolate: VMIsolate = response.result as VMIsolate;
						this.threadManager.registerThread(
							isolateRef,
							isolate.runnable ? "IsolateRunnable" : "IsolateStart",
						);

						if (isolate.pauseEvent.kind === "PauseStart") {
							const thread = this.threadManager.getThreadInfoFromRef(isolateRef);
							thread.receivedPauseStart();
						}

						// Helpers to categories libraries as SDK/ExternalLibrary/not.
						const isValidToDebug = (l: VMLibraryRef) => !l.uri.startsWith("dart:_"); // TODO: See https://github.com/dart-lang/sdk/issues/29813
						const isSdkLibrary = (l: VMLibraryRef) => l.uri.startsWith("dart:");
						const isExternalLibrary = (l: VMLibraryRef) => l.uri.startsWith("package:") && !l.uri.startsWith(`package:${this.localPackageName}/`);

						// Set whether libraries should be debuggable based on user settings.
						return Promise.all(
							isolate.libraries.filter(isValidToDebug).map((library) => {
								// Note: Condition is negated.
								const shouldDebug = !(
									// Inside here is shouldNotDebug!
									(isSdkLibrary(library) && !this.args.debugSdkLibraries)
									|| (isExternalLibrary(library) && !this.args.debugExternalLibraries)
								);
								this.observatory.setLibraryDebuggable(isolateRef.id, library.id, shouldDebug);
							}),
						);
					}));
				}

				Promise.all(promises).then((_) => {
					this.sendEvent(new InitializedEvent());
				});
			});
		});

		this.observatory.onClose((code: number, message: string) => {
			if (this.observatoryLogStream) {
				this.observatoryLogStream.close();
				this.observatoryLogStream = null;
			}
			// This event arrives before the process exit event.
			setTimeout(() => {
				if (!this.processExited)
					this.sendEvent(new TerminatedEvent());
			}, 100);
		});
	}

	protected disconnectRequest(
		response: DebugProtocol.DisconnectResponse,
		args: DebugProtocol.DisconnectArguments,
	): void {
		if (this.childProcess != null)
			this.childProcess.kill();
		super.disconnectRequest(response, args);
	}

	protected setBreakPointsRequest(
		response: DebugProtocol.SetBreakpointsResponse,
		args: DebugProtocol.SetBreakpointsArguments,
	): void {
		const source: DebugProtocol.Source = args.source;
		let breakpoints: DebugProtocol.SourceBreakpoint[] = args.breakpoints;
		if (!breakpoints)
			breakpoints = [];

		// Get all possible valid source uris for the given path.
		const uris = this.getPossibleSourceUris(source.path);

		uris.forEach((uri) => {
			this.threadManager.setBreakpoints(uri, breakpoints).then((result: boolean[]) => {
				const bpResponse = [];
				for (const verified of result) {
					bpResponse.push({ verified });
				}

				response.body = { breakpoints: bpResponse };
				this.sendResponse(response);
			}).catch((error) => this.errorResponse(response, `${error}`));
		});
	}

	/***
	 * Converts a source path to an array of possible uris.
	 *
	 * This is to ensure that we can hit breakpoints in the case
	 * where the VM considers a file to be a package: uri and also
	 * a filesystem uri (this can vary depending on how it was
	 * imported by the user).
	 */
	protected getPossibleSourceUris(sourcePath: string): string[] {
		const uris = [];

		// Add the raw file path.
		uris.push(formatPathForVm(sourcePath));

		// Convert to package path and add that too.
		const packageUri = this.packageMap.convertFileToPackageUri(sourcePath);
		if (packageUri)
			uris.push(packageUri);

		return uris;
	}

	protected setExceptionBreakPointsRequest(
		response: DebugProtocol.SetExceptionBreakpointsResponse,
		args: DebugProtocol.SetExceptionBreakpointsArguments,
	): void {
		const filters: string[] = args.filters;

		let mode = "None";
		if (filters.indexOf("Unhandled") !== -1)
			mode = "Unhandled";
		if (filters.indexOf("All") !== -1)
			mode = "All";

		this.threadManager.setExceptionPauseMode(mode);

		this.sendResponse(response);
	}

	protected configurationDoneRequest(
		response: DebugProtocol.ConfigurationDoneResponse,
		args: DebugProtocol.ConfigurationDoneArguments,
	): void {
		this.sendResponse(response);

		this.threadManager.receivedConfigurationDone();
	}

	protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): void {
		const thread = this.threadManager.getThreadInfoFromNumber(args.threadId);

		if (!thread) {
			this.errorResponse(response, `No thread with id ${args.threadId}`);
			return;
		}

		this.observatory.pause(thread.ref.id)
			.then((_) => this.sendResponse(response))
			.catch((error) => this.errorResponse(response, `${error}`));
	}

	protected sourceRequest(response: DebugProtocol.SourceResponse, args: DebugProtocol.SourceArguments): void {
		const sourceReference = args.sourceReference;
		const data = this.threadManager.getStoredData(sourceReference);
		const scriptRef: VMScriptRef = data.data as VMScriptRef;

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
		const thread = this.threadManager.getThreadInfoFromNumber(args.threadId);
		let startFrame: number = args.startFrame;
		let levels: number = args.levels;

		if (!thread) {
			this.errorResponse(response, `No thread with id ${args.threadId}`);
			return;
		}

		this.observatory.getStack(thread.ref.id).then((result: DebuggerResult) => {
			const stack: VMStack = result.result as VMStack;
			let vmFrames: VMFrame[] = stack.asyncCausalFrames;
			if (vmFrames == null)
				vmFrames = stack.frames;
			const totalFrames = vmFrames.length;

			if (!startFrame)
				startFrame = 0;
			if (!levels)
				levels = totalFrames;
			if (startFrame + levels > totalFrames)
				levels = totalFrames - startFrame;
			vmFrames = vmFrames.slice(startFrame, startFrame + levels);

			const stackFrames: StackFrame[] = [];
			const promises: Array<Promise<void>> = [];

			vmFrames.forEach((frame: VMFrame) => {
				const frameId = thread.storeData(frame);

				if (frame.kind === "AsyncSuspensionMarker") {
					const stackFrame: StackFrame = new StackFrame(frameId, "<asynchronous gap>");
					stackFrames.push(stackFrame);
					return;
				}

				const frameName = frame.code.name;
				const location: VMSourceLocation = frame.location;

				if (location == null) {
					const stackFrame: StackFrame = new StackFrame(frameId, frameName);
					stackFrames.push(stackFrame);
					return;
				}

				const uri = location.script.uri;
				const shortName = this.convertVMUriToUserName(uri);
				let sourcePath = this.convertVMUriToSourcePath(uri);

				// Download the source if from a "dart:" uri.
				let sourceReference: number;
				if (uri.startsWith("dart:")) {
					sourcePath = null;
					sourceReference = thread.storeData(location.script);
				}

				const stackFrame: StackFrame = new StackFrame(
					frameId,
					frameName,
					new Source(shortName, sourcePath, sourceReference, null, location.script),
					0, 0,
				);
				stackFrames.push(stackFrame);

				// Resolve the line and column information.
				const promise = thread.getScript(location.script).then((script: VMScript) => {
					const fileLocation: FileLocation = this.resolveFileLocation(script, location.tokenPos);
					if (fileLocation) {
						stackFrame.line = fileLocation.line;
						stackFrame.column = fileLocation.column;
					}
				});
				promises.push(promise);
			});

			response.body = {
				stackFrames,
				totalFrames,
			};

			Promise.all(promises).then((_) => {
				this.sendResponse(response);
			}).catch((_) => {
				this.sendResponse(response);
			});
		}).catch((error) => this.errorResponse(response, `${error}`));
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		const frameId = args.frameId;
		const data = this.threadManager.getStoredData(frameId);
		const frame: VMFrame = data.data as VMFrame;

		// TODO: class variables? library variables?

		const variablesReference = data.thread.storeData(frame);
		response.body = {
			scopes: [new Scope("Locals", variablesReference)],
		};
		this.sendResponse(response);
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
		const variablesReference = args.variablesReference;

		// implement paged arrays
		// let filter = args.filter; // optional; either "indexed" or "named"
		let start = args.start; // (optional) index of the first variable to return; if omitted children start at 0
		const count = args.count; // (optional) number of variables to return. If count is missing or 0, all variables are returned

		const data = this.threadManager.getStoredData(variablesReference);
		const thread = data.thread;

		if (data.data.type === "Frame") {
			const frame: VMFrame = data.data as VMFrame;
			const variables: DebugProtocol.Variable[] = [];
			for (const variable of frame.vars)
				variables.push(this.instanceRefToVariable(thread, variable.name, variable.value));
			response.body = { variables };
			this.sendResponse(response);
		} else {
			const instanceRef = data.data as VMInstanceRef;

			this.observatory.getObject(thread.ref.id, instanceRef.id, start, count).then(
				(result: DebuggerResult,
				) => {
					const variables: DebugProtocol.Variable[] = [];

					if (result.result.type === "Sentinel") {
						variables.push({
							name: "evalError",
							value: (result.result as VMSentinel).valueAsString,
							variablesReference: 0,
						});
					} else {
						const obj: VMObj = result.result as VMObj;

						if (obj.type === "Instance") {
							const instance = obj as VMInstance;

							// TODO: show by kind instead
							if (instance.elements) {
								const len = instance.elements.length;
								if (!start)
									start = 0;
								for (let i = 0; i < len; i++) {
									const element = instance.elements[i];
									variables.push(this.instanceRefToVariable(thread, `[${i + start}]`, element));
								}
							} else if (instance.associations) {
								for (const association of instance.associations) {
									let keyName = this.valueAsString(association.key);
									if (!keyName) {
										if (association.key.type === "Sentinel")
											keyName = "<evalError>";
										else
											keyName = (association.key as VMInstanceRef).id;
									}
									variables.push(this.instanceRefToVariable(thread, keyName, association.value));
								}
							} else if (instance.fields) {
								for (const field of instance.fields)
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

					response.body = { variables };
					this.sendResponse(response);
				}).catch((error) => this.errorResponse(response, `${error}`));
		}
	}

	private callToString(isolate: VMIsolateRef, instanceRef: VMInstanceRef): Promise<string> {
		return this.observatory.evaluate(isolate.id, instanceRef.id, "toString()").then((result: DebuggerResult) => {
			if (result.result.type === "@Error") {
				return null;
			} else {
				const evalResult: VMInstanceRef = result.result as VMInstanceRef;
				return this.valueAsString(evalResult);
			}
		}).catch((e) => null);
	}

	protected setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): void {
		const variablesReference: number = args.variablesReference;
		// The name of the variable.
		const name: string = args.name;
		// The value of the variable.
		const value: string = args.value;

		// TODO: Use eval to implement this.
		this.errorResponse(response, "not supported");
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		const thread = this.threadManager.getThreadInfoFromNumber(args.threadId);
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
		const thread = this.threadManager.getThreadInfoFromNumber(args.threadId);
		if (!thread) {
			this.errorResponse(response, `No thread with id ${args.threadId}`);
			return;
		}
		const type = thread.atAsyncSuspension ? "OverAsyncSuspension" : "Over";
		this.observatory.resume(thread.ref.id, type).then((_) => {
			thread.handleResumed();
			this.sendResponse(response);
		}).catch((error) => this.errorResponse(response, `${error}`));
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
		const thread = this.threadManager.getThreadInfoFromNumber(args.threadId);
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
		const thread = this.threadManager.getThreadInfoFromNumber(args.threadId);
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
		const expression: string = args.expression;
		// Stack frame scope; if not specified, the expression is evaluated in the global scope.
		const frameId: number = args.frameId;
		// Values are "watch", "repl", and "hover".
		const context: string = args.context;

		if (!frameId) {
			this.errorResponse(response, "global evaluation not supported");
			return;
		}

		const data = this.threadManager.getStoredData(frameId);
		const thread = data.thread;
		const frame: VMFrame = data.data as VMFrame;

		this.observatory.evaluateInFrame(thread.ref.id, frame.index, expression).then((result: DebuggerResult) => {
			// InstanceRef or ErrorRef
			if (result.result.type === "@Error") {
				const error: VMErrorRef = result.result as VMErrorRef;
				let str: string = error.message;
				if (str && str.length > 100)
					str = str.substring(0, 100) + "…";
				this.errorResponse(response, str);
			} else {
				const instanceRef: VMInstanceRef = result.result as VMInstanceRef;
				if (instanceRef.valueAsString) {
					response.body = {
						result: this.valueAsString(instanceRef),
						variablesReference: 0,
					};
				} else {
					response.body = {
						result: instanceRef.class.name,
						variablesReference: thread.storeData(instanceRef),
					};
				}
				this.sendResponse(response);
			}
		}).catch((error) => this.errorResponse(response, `${error}`));
	}

	protected customRequest(request: string, response: DebugProtocol.Response, args: any): void {
		switch (request) {
			default:
				super.customRequest(request, response, args);
				break;
		}
	}

	// IsolateStart, IsolateRunnable, IsolateExit, IsolateUpdate, ServiceExtensionAdded
	public handleIsolateEvent(event: VMEvent) {
		const kind = event.kind;
		if (kind === "IsolateStart" || kind === "IsolateRunnable") {
			this.threadManager.registerThread(event.isolate, kind);
		} else if (kind === "IsolateExit") {
			this.threadManager.handleIsolateExit(event.isolate);
		}
	}

	// PauseStart, PauseExit, PauseBreakpoint, PauseInterrupted, PauseException, Resume,
	// BreakpointAdded, BreakpointResolved, BreakpointRemoved, Inspect, None
	public handleDebugEvent(event: VMEvent) {
		const kind = event.kind;

		// For PausePostRequest we need to re-send all breakpoints; this happens after a flutter restart
		if (kind === "PausePostRequest") {
			this.threadManager.resetBreakpoints()
				.then((_) => this.observatory.resume(event.isolate.id))
				.catch((e) => { if (e.code !== 106) throw e; }); // Ignore failed-to-resume errors https://github.com/flutter/flutter/issues/10934
		} else if (kind === "PauseStart") {
			// "PauseStart" should auto-resume after breakpoints are set.
			const thread = this.threadManager.getThreadInfoFromRef(event.isolate);
			thread.receivedPauseStart();
		} else if (kind.startsWith("Pause")) {
			const thread = this.threadManager.getThreadInfoFromRef(event.isolate);

			// PauseStart, PauseExit, PauseBreakpoint, PauseInterrupted, PauseException
			let reason = "pause";
			let exceptionText = null;

			if (kind === "PauseBreakpoint") {
				reason = "breakpoint";
				if (event.pauseBreakpoints == null || event.pauseBreakpoints.length === 0) {
					reason = "step";
				}
			}

			if (kind === "PauseException") {
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

	public errorResponse(response: DebugProtocol.Response, message: string) {
		response.success = false;
		response.message = message;
		this.sendResponse(response);
	}

	private convertVMUriToUserName(uri: string): string {
		if (uri.startsWith("file:")) {
			uri = uriToFilePath(uri);
			uri = path.relative(this.args.cwd, uri);
		}

		return uri;
	}

	protected convertVMUriToSourcePath(uri: string, returnWindowsPath?: boolean): string {
		if (uri.startsWith("file:"))
			return uriToFilePath(uri, returnWindowsPath);

		if (uri.startsWith("package:"))
			return this.packageMap.resolvePackageUri(uri);

		return uri;
	}

	private valueAsString(ref: VMInstanceRef | VMSentinel): string {
		if (ref.type === "Sentinel")
			return ref.valueAsString;

		const instanceRef = ref as VMInstanceRef;

		if (ref.valueAsString) {
			let str: string = instanceRef.valueAsString;
			if (instanceRef.valueAsStringIsTruncated)
				str += "…";
			if (instanceRef.kind === "String")
				str = `'${str}'`;
			return str;
		} else if (ref.kind === "List") {
			return `[${instanceRef.length}]`;
		} else if (ref.kind === "Map") {
			return `{${instanceRef.length}}`;
		} else {
			return instanceRef.class.name;
		}
	}

	private instanceRefToVariable(
		thread: ThreadInfo, name: string, ref: VMInstanceRef | VMSentinel,
	): DebugProtocol.Variable {
		if (ref.type === "Sentinel") {
			return {
				name,
				value: (ref as VMSentinel).valueAsString,
				variablesReference: 0,
			};
		} else {
			const val = ref as VMInstanceRef;

			let str = this.valueAsString(val);
			if (!val.valueAsString && !str)
				str = "";

			return {
				indexedVariables: (val.kind.endsWith("List") ? val.length : null),
				name,
				type: val.class.name,
				value: str,
				variablesReference: val.valueAsString ? 0 : thread.storeData(val),
			};
		}
	}

	private resolveFileLocation(script: VMScript, tokenPos: number): FileLocation {
		const table: number[][] = script.tokenPosTable;
		for (const entry of table) {
			// [lineNumber, (tokenPos, columnNumber)*]
			for (let index = 1; index < entry.length; index += 2) {
				if (entry[index] === tokenPos) {
					const line = entry[0];
					return new FileLocation(line, entry[index + 1]);
				}
			}
		}

		return null;
	}

	protected log(obj: string) {
		this.sendEvent(new OutputEvent(`${obj}\n`));
	}
}

class ThreadManager {
	public nextThreadId: number = 0;

	public threads: ThreadInfo[] = [];
	public debugSession: DartDebugSession;
	public bps: { [uri: string]: DebugProtocol.SourceBreakpoint[] } = {};
	private hasConfigurationDone = false;
	private exceptionMode = "Unhandled";

	constructor(debugSession: DartDebugSession) {
		this.debugSession = debugSession;
	}

	public registerThread(ref: VMIsolateRef, eventKind: string) {
		let thread: ThreadInfo = this.getThreadInfoFromRef(ref);

		if (!thread) {
			thread = new ThreadInfo(this, ref, this.nextThreadId);
			this.nextThreadId++;
			this.threads.push(thread);

			// If this is the first time we've seen it, fire an event
			this.debugSession.sendEvent(new ThreadEvent("started", thread.number));

			if (this.hasConfigurationDone)
				thread.receivedConfigurationDone();
		}

		// If it's just become runnable (IsolateRunnable), then set breakpoints.
		if (eventKind === "IsolateRunnable" && !thread.runnable) {
			thread.runnable = true;

			this.debugSession.observatory.setExceptionPauseMode(thread.ref.id, this.exceptionMode);

			this.resetBreakpoints().then((_) => thread.setInitialBreakpoints());
		}
	}

	public receivedConfigurationDone() {
		this.hasConfigurationDone = true;

		for (const thread of this.threads)
			thread.receivedConfigurationDone();
	}

	public getThreadInfoFromRef(ref: VMIsolateRef): ThreadInfo {
		for (const thread of this.threads) {
			if (thread.ref.id === ref.id)
				return thread;
		}
		return null;
	}

	public getThreadInfoFromNumber(num: number): ThreadInfo {
		for (const thread of this.threads) {
			if (thread.number === num)
				return thread;
		}
		return null;
	}

	public getThreads(): Thread[] {
		return this.threads.map((thread: ThreadInfo) => new Thread(thread.number, thread.ref.name));
	}

	public setExceptionPauseMode(mode: string) {
		this.exceptionMode = mode;

		for (const thread of this.threads) {
			if (thread.runnable)
				this.debugSession.observatory.setExceptionPauseMode(thread.ref.id, mode);
		}
	}

	// Just resends existing breakpoints
	public resetBreakpoints() {
		const promises = [];
		for (const uri of Object.keys(this.bps)) {
			promises.push(this.setBreakpoints(uri, this.bps[uri]));
		}
		return Promise.all(promises);
	}

	public setBreakpoints(uri: string, breakpoints: DebugProtocol.SourceBreakpoint[]): Promise<boolean[]> {
		// Remember these bps for when new threads start.
		if (breakpoints.length === 0)
			delete this.bps[uri];
		else
			this.bps[uri] = breakpoints;

		let promise;

		for (const thread of this.threads) {
			if (thread.runnable) {
				const result = thread.setBreakpoints(uri, breakpoints);
				if (!promise)
					promise = result;
			}
		}

		if (promise)
			return promise;

		const completer = new PromiseCompleter<boolean[]>();
		const result = [];
		for (const b of breakpoints)
			result.push(true);
		completer.resolve(result);
		return completer.promise;
	}

	public nextDataId: number = 1;
	public storedData: { [id: number]: StoredData } = {};

	public storeData(thread: ThreadInfo, data: VMResponse): number {
		const id = this.nextDataId;
		this.nextDataId++;
		this.storedData[id] = new StoredData(thread, data);
		return id;
	}

	public getStoredData(id: number): StoredData {
		return this.storedData[id];
	}

	public removeStoredIds(ids: number[]) {
		for (const id of ids) {
			delete this.storedData[id];
		}
	}

	public handleIsolateExit(ref: VMIsolateRef) {
		const threadInfo: ThreadInfo = this.getThreadInfoFromRef(ref);
		this.debugSession.sendEvent(new ThreadEvent("exited", threadInfo.number));
		this.threads.splice(this.threads.indexOf(threadInfo), 1);
	}
}

class StoredData {
	public thread: ThreadInfo;
	public data: VMResponse;

	constructor(thread: ThreadInfo, data: VMResponse) {
		this.thread = thread;
		this.data = data;
	}
}

class ThreadInfo {
	public manager: ThreadManager;
	public ref: VMIsolateRef;
	public number: number;
	public storedIds: number[] = [];
	public scriptCompleters: { [key: string]: PromiseCompleter<VMScript> } = {};
	public runnable: boolean = false;
	public vmBps: { [uri: string]: VMBreakpoint[] } = {};
	public atAsyncSuspension: boolean = false;

	constructor(manager: ThreadManager, ref: VMIsolateRef, num: number) {
		this.manager = manager;
		this.ref = ref;
		this.number = num;
	}

	public setBreakpoints(uri: string, breakpoints: DebugProtocol.SourceBreakpoint[]): Promise<boolean[]> {
		const removeBreakpointPromises = [];

		// Remove all current bps.
		const oldbps = this.vmBps[uri];
		if (oldbps) {
			for (const bp of oldbps) {
				removeBreakpointPromises.push(this.manager.debugSession.observatory.removeBreakpoint(this.ref.id, bp.id));
			}
		}

		this.vmBps[uri] = [];

		return Promise.all(removeBreakpointPromises).then(() => {
			// Set new ones.
			const promises = [];

			for (const bp of breakpoints) {
				const promise = this.manager.debugSession.observatory.addBreakpointWithScriptUri(
					this.ref.id, uri, bp.line, bp.column,
				).then((result: DebuggerResult) => {
					const vmBp: VMBreakpoint = result.result as VMBreakpoint;
					this.vmBps[uri].push(vmBp);
					return true;
				}).catch((error) => {
					return false;
				});

				promises.push(promise);
			}

			return Promise.all(promises);
		});
	}

	private gotPauseStart = false;
	private initialBreakpoints = false;
	private hasConfigurationDone = false;

	public receivedPauseStart() {
		this.gotPauseStart = true;
		this.checkResume();
	}

	public setInitialBreakpoints() {
		this.initialBreakpoints = true;
		this.checkResume();
	}

	public receivedConfigurationDone() {
		this.hasConfigurationDone = true;
		this.checkResume();
	}

	public checkResume() {
		if (this.gotPauseStart && this.initialBreakpoints && this.hasConfigurationDone)
			this.manager.debugSession.observatory.resume(this.ref.id);
	}

	public handleResumed() {
		// TODO: I don"t think we want to do this...
		// this.manager.removeStoredIds(this.storedIds);
		// this.storedIds = [];
		this.atAsyncSuspension = false;
	}

	public getScript(scriptRef: VMScriptRef): Promise<VMScript> {
		const scriptId = scriptRef.id;

		if (this.scriptCompleters[scriptId]) {
			const completer: PromiseCompleter<VMScript> = this.scriptCompleters[scriptId];
			return completer.promise;
		} else {
			const completer: PromiseCompleter<VMScript> = new PromiseCompleter();
			this.scriptCompleters[scriptId] = completer;

			const observatory = this.manager.debugSession.observatory;
			observatory.getObject(this.ref.id, scriptRef.id).then((result: DebuggerResult) => {
				const script: VMScript = result.result as VMScript;
				completer.resolve(script);
			}).catch((error) => {
				completer.reject(error);
			});

			return completer.promise;
		}
	}

	public storeData(data: VMResponse): number {
		return this.manager.storeData(this, data);
	}

	public handlePaused(atAsyncSuspension?: boolean) {
		this.atAsyncSuspension = atAsyncSuspension;
	}
}

class FileLocation {
	public line: number;
	public column: number;

	constructor(line: number, column: number) {
		this.line = line;
		this.column = column;
	}
}
