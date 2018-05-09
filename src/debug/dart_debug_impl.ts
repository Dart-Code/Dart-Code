import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import { DebugSession, Event, InitializedEvent, OutputEvent, Scope, Source, StackFrame, StoppedEvent, TerminatedEvent, Thread, ThreadEvent } from "vscode-debugadapter";
import { DebugProtocol } from "vscode-debugprotocol";
import { DebuggerResult, ObservatoryConnection, VM, VMBreakpoint, VMErrorRef, VMEvent, VMFrame, VMInstance, VMInstanceRef, VMIsolate, VMIsolateRef, VMLibraryRef, VMMapEntry, VMObj, VMResponse, VMScript, VMScriptRef, VMSentinel, VMSourceLocation, VMStack } from "./dart_debug_protocol";
import { PackageMap } from "./package_map";
import { DartAttachRequestArguments, DartLaunchRequestArguments, PromiseCompleter, formatPathForVm, safeSpawn, uriToFilePath } from "./utils";

// TODO: supportsSetVariable
// TODO: class variables?
// TODO: library variables?
// stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments): void;
// restartFrameRequest(response: DebugProtocol.RestartFrameResponse, args: DebugProtocol.RestartFrameArguments): void;
// completionsRequest(response: DebugProtocol.CompletionsResponse, args: DebugProtocol.CompletionsArguments): void;

export class DartDebugSession extends DebugSession {
	// TODO: Tidy all this up
	protected childProcess: child_process.ChildProcess;
	private processExited: boolean = false;
	public observatory: ObservatoryConnection;
	protected cwd: string;
	private observatoryLogFile: string;
	private observatoryLogStream: fs.WriteStream;
	private debugSdkLibraries: boolean;
	private debugExternalLibraries: boolean;
	private threadManager: ThreadManager;
	private packageMap: PackageMap;
	protected sendStdOutToConsole: boolean = true;
	protected pollforMemoryMs?: number; // If set, will poll for memory usage and send events back.

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
		response.body.supportsDelayedStackTraceLoading = true;
		response.body.supportsConditionalBreakpoints = true;
		response.body.supportsLogPoints = true;
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

		// Force relative paths to absolute.
		if (!path.isAbsolute(args.program))
			args.program = path.join(args.cwd, args.program);
		this.cwd = args.cwd;
		this.packageMap = new PackageMap(PackageMap.findPackagesFile(args.program));
		this.debugSdkLibraries = args.debugSdkLibraries;
		this.debugExternalLibraries = args.debugExternalLibraries;
		this.observatoryLogFile = args.observatoryLogFile;

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
				this.initObservatory(this.websocketUriForObservatoryUri(match[1]));
			} else if (this.sendStdOutToConsole)
				this.sendEvent(new OutputEvent(data.toString(), "stdout"));
		});
		process.stderr.setEncoding("utf8");
		process.stderr.on("data", (data) => {
			this.sendEvent(new OutputEvent(data.toString(), "stderr"));
		});
		process.on("error", (error) => {
			this.sendEvent(new OutputEvent(`${error}`, "stderr"));
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

	protected attachRequest(response: DebugProtocol.AttachResponse, args: DartAttachRequestArguments): void {
		if (!args || !args.observatoryUri) {
			response.success = false;
			response.message = "Unable to attach; no Observatory address provided.";
			this.sendResponse(response);
			return;
		}

		this.cwd = args.cwd;
		this.packageMap = new PackageMap(PackageMap.findPackagesFile(args.packages));
		this.debugSdkLibraries = args.debugSdkLibraries;
		this.debugExternalLibraries = args.debugExternalLibraries;
		this.observatoryLogFile = args.observatoryLogFile;

		// TODO: Hold off on sending the response until initObservatory has succeeded or failed
		// so that attach failures (e.g., invalid URLs, wrong port) are reported.
		this.sendResponse(response);
		this.initObservatory(this.websocketUriForObservatoryUri(args.observatoryUri));
	}

	protected sourceFileForArgs(args: DartLaunchRequestArguments) {
		return path.relative(args.cwd, args.program);
	}

	protected spawnProcess(args: DartLaunchRequestArguments) {
		const debug = !args.noDebug;
		let appArgs = [];
		if (debug) {
			appArgs.push("--enable-vm-service=0");
			appArgs.push("--pause_isolates_on_start=true");
		}
		if (args.checkedMode && !args.previewDart2) {
			appArgs.push("--checked");
		}
		if (args.previewDart2 === true) {
			appArgs.push("--preview-dart-2");
		} else if (args.previewDart2 === false) {
			// VM doesn't support this flag
			// appArgs.push(`--no-preview-dart-2`);
		}
		if (args.vmAdditionalArgs) {
			appArgs = appArgs.concat(args.vmAdditionalArgs);
		}
		appArgs.push(this.sourceFileForArgs(args));
		if (args.args) {
			appArgs = appArgs.concat(args.args);
		}

		const process = safeSpawn(args.cwd, args.dartPath, appArgs);

		return process;
	}

	private websocketUriForObservatoryUri(uri: string) {
		let wsUri = uri.trim();
		if (!wsUri.endsWith("/ws")) {
			if (!wsUri.endsWith("/"))
				wsUri = wsUri + "/";
			wsUri = wsUri + "ws";
		}
		return wsUri;
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

			if (this.observatoryLogFile) {
				if (!this.observatoryLogStream)
					this.observatoryLogStream = fs.createWriteStream(this.observatoryLogFile);
				this.observatoryLogStream.write(`[${(new Date()).toLocaleTimeString()}]: `);
				if (message.length > max)
					this.observatoryLogStream.write(message.substring(0, max) + "…\r\n");
				else
					this.observatoryLogStream.write(message.trim() + "\r\n");
			}
		});
		this.observatory.onOpen(() => {
			this.observatory.on("Isolate", (event: VMEvent) => this.handleIsolateEvent(event));
			this.observatory.on("Extension", (event: VMEvent) => this.handleExtensionEvent(event));
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

						if (isolate.pauseEvent.kind.startsWith("Pause")) {
							this.handlePauseEvent(isolate.pauseEvent);
						}

						// Helpers to categories libraries as SDK/ExternalLibrary/not.
						const isValidToDebug = (l: VMLibraryRef) => !l.uri.startsWith("dart:_"); // TODO: See https://github.com/dart-lang/sdk/issues/29813
						const isSdkLibrary = (l: VMLibraryRef) => l.uri.startsWith("dart:");
						// If we don't know the local package name, we have to assume nothing is external, else we might disable debugging for the local library.
						const isExternalLibrary = (l: VMLibraryRef) => l.uri.startsWith("package:") && this.packageMap.localPackageName && !l.uri.startsWith(`package:${this.packageMap.localPackageName}/`);

						// Set whether libraries should be debuggable based on user settings.
						return Promise.all(
							isolate.libraries.filter(isValidToDebug).map((library) => {
								// Note: Condition is negated.
								const shouldDebug = !(
									// Inside here is shouldNotDebug!
									(isSdkLibrary(library) && !this.debugSdkLibraries)
									|| (isExternalLibrary(library) && !this.debugExternalLibraries)
								);
								this.observatory.setLibraryDebuggable(isolateRef.id, library.id, shouldDebug);
							}),
						);
					}));
				}

				// Set a timer for memory updates.
				if (this.pollforMemoryMs)
					setTimeout(() => this.pollForMemoryUsage(), this.pollforMemoryMs);

				// TODO: Handle errors (such as these failing because we sent them too early).
				// https://github.com/Dart-Code/Dart-Code/issues/790
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
		if (this.childProcess != null) {
			this.childProcess.kill();
		} else {
			// Remove all breakpoints from the VM.
			const removeBreakpointPromises = [];
			for (const thread of this.threadManager.threads) {
				removeBreakpointPromises.push(thread.removeAllBreakpoints());
			}
			Promise.all(removeBreakpointPromises).then((_) => {
				// Restart any paused threads.
				const resumePromises = [];
				for (const thread of this.threadManager.threads) {
					if (thread.paused) {
						resumePromises.push(this.observatory.resume(thread.ref.id));
					}
				}
				Promise.all(resumePromises).then((_) => {
					// Finally, shut down the connection to the observatory.
					this.observatory.close();
				}).catch((error) => this.observatory.close());
			}).catch((error) => this.observatory.close());
		}
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

		// Add the raw file path as a URI.
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
		const scopes: Scope[] = [];

		if (data.thread.exceptionReference) {
			scopes.push(new Scope("Exception", data.thread.exceptionReference));
		}

		scopes.push(new Scope("Locals", variablesReference));

		response.body = { scopes };
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
			if (frame.vars) {
				for (const variable of frame.vars)
					variables.push(this.instanceRefToVariable(thread, true, variable.name, variable.name, variable.value));
			}
			response.body = { variables };
			this.sendResponse(response);
		} else if (data.data.type === "MapEntry") {
			const mapRef = data.data as VMMapEntry;

			Promise.all([
				this.observatory.getObject(thread.ref.id, mapRef.keyId),
				this.observatory.getObject(thread.ref.id, mapRef.valueId),
			]).then((results: DebuggerResult[]) => {
				const variables: DebugProtocol.Variable[] = [];

				const [keyDebuggerResult, valueDebuggerResult] = results;
				const keyInstanceRef = keyDebuggerResult.result as VMInstanceRef;
				const valueInstanceRef = valueDebuggerResult.result as VMInstanceRef;

				variables.push(this.instanceRefToVariable(thread, false, "key", "key", keyInstanceRef));

				let canEvaluateValueName = false;
				let valueEvaluateName = "value";
				if (this.isSimpleKind(keyInstanceRef.kind)) {
					canEvaluateValueName = true;
					valueEvaluateName = `${mapRef.mapEvaluateName}[${this.valueAsString(keyInstanceRef)}]`;
				}

				variables.push(this.instanceRefToVariable(thread, canEvaluateValueName, valueEvaluateName, "value", valueInstanceRef));

				response.body = { variables };
				this.sendResponse(response);
			});
		} else {
			const instanceRef = data.data as InstanceWithEvaluateName;

			this.observatory.getObject(thread.ref.id, instanceRef.id, start, count).then(
				(result: DebuggerResult,
				) => {
					const variables: DebugProtocol.Variable[] = [];
					// If we're the top-level exception, or our parent has an evaluateName of undefined (its children)
					// we cannot evaluate (this will disable "Add to Watch" etc).
					const canEvaluate = variablesReference !== data.thread.exceptionReference && instanceRef.evaluateName !== undefined;

					if (result.result.type === "Sentinel") {
						variables.push({
							name: "<evalError>",
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
									variables.push(this.instanceRefToVariable(thread, canEvaluate, `${instanceRef.evaluateName}[${i + start}]`, `[${i + start}]`, element));
								}
							} else if (instance.associations) {
								const len = instance.associations.length;
								if (!start)
									start = 0;
								for (let i = 0; i < len; i++) {
									const association = instance.associations[i];

									const keyName = this.valueAsString(association.key, true);
									const valueName = this.valueAsString(association.value, true);

									let variablesReference = 0;

									if (association.key.type !== "Sentinel" && association.value.type !== "Sentinel") {
										const mapRef: VMMapEntry = {
											keyId: (association.key as VMInstanceRef).id,
											mapEvaluateName: instanceRef.evaluateName,
											type: "MapEntry",
											valueId: (association.value as VMInstanceRef).id,
										};

										variablesReference = thread.storeData(mapRef);
									}

									variables.push({
										name: `${i + start}`,
										type: `${keyName} -> ${valueName}`,
										value: `${keyName} -> ${valueName}`,
										variablesReference,
									});
								}
							} else if (instance.fields) {
								for (const field of instance.fields)
									variables.push(this.instanceRefToVariable(thread, canEvaluate, `${instanceRef.evaluateName}.${field.decl.name}`, field.decl.name, field.value));
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

	private isSimpleKind(kind: string) {
		return kind === "String" || kind === "Bool" || kind === "Int" || kind === "Num" || kind === "Double";
	}

	private async callToString(isolate: VMIsolateRef, instanceRef: VMInstanceRef, getFullString: boolean = false): Promise<string> {
		try {
			const result = await this.observatory.evaluate(isolate.id, instanceRef.id, "toString()");
			if (result.result.type === "@Error") {
				return null;
			} else {
				let evalResult: VMInstanceRef = result.result as VMInstanceRef;

				if (evalResult.valueAsStringIsTruncated && getFullString) {
					const result = await this.observatory.getObject(isolate.id, evalResult.id);
					evalResult = result.result as VMInstanceRef;
				}

				return this.valueAsString(evalResult, undefined, true);
			}
		} catch (e) {
			console.error(e);
			return null;
		}
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
				response.body = {
					result: this.valueAsString(instanceRef),
					variablesReference: instanceRef.valueAsString ? 0 : thread.storeData(instanceRef),
				};
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
		} else if (kind === "ServiceExtensionAdded") {
			this.handleServiceExtensionAdded(event);
		}
	}

	// Extension
	public handleExtensionEvent(event: VMEvent) {
		// Nothing Dart-specific, but Flutter overrides this
	}

	// PauseStart, PauseExit, PauseBreakpoint, PauseInterrupted, PauseException, Resume,
	// BreakpointAdded, BreakpointResolved, BreakpointRemoved, Inspect, None
	public async handleDebugEvent(event: VMEvent) {
		const kind = event.kind;

		if (kind.startsWith("Pause")) {
			this.handlePauseEvent(event);
		}
	}

	private async handlePauseEvent(event: VMEvent) {
		const kind = event.kind;

		// For PausePostRequest we need to re-send all breakpoints; this happens after a flutter restart
		if (kind === "PausePostRequest") {
			await this.threadManager.resetBreakpoints();
			try {
				await this.observatory.resume(event.isolate.id);
			} catch (e) {
				// Ignore failed-to-resume errors https://github.com/flutter/flutter/issues/10934
				if (e.code !== 106)
					throw e;
			}
		} else if (kind === "PauseStart") {
			// "PauseStart" should auto-resume after breakpoints are set.
			const thread = this.threadManager.getThreadInfoFromRef(event.isolate);
			thread.receivedPauseStart();
		} else {
			const thread = this.threadManager.getThreadInfoFromRef(event.isolate);

			// PauseStart, PauseExit, PauseBreakpoint, PauseInterrupted, PauseException
			let reason = "pause";
			let exceptionText = null;
			let shouldRemainedStoppedOnBreakpoint = true;

			if (kind === "PauseBreakpoint" && event.pauseBreakpoints && event.pauseBreakpoints.length) {
				reason = "breakpoint";

				const breakpoints = event.pauseBreakpoints.map((bp) => thread.breakpoints[bp.id]);
				// When attaching to an already-stopped process, this event can be handled before the
				// breakpoints have been registered. If that happens, replace any unknown breakpoints with
				// dummy unconditional breakpoints.
				// TODO: Ensure that VM breakpoint state is reconciled with debugger breakpoint state before
				// handling thread state so that this doesn't happen, and remove this check.
				const hasUnknownBreakpoints = breakpoints.indexOf(undefined) !== -1;

				if (!hasUnknownBreakpoints) {
					const hasUnconditionalBreakpoints = !!breakpoints.find((bp) => !bp.condition && !bp.logMessage);
					const conditionalBreakpoints = breakpoints.filter((bp) => bp.condition);
					const logPoints = breakpoints.filter((bp) => bp.logMessage);

					// Evalute conditions to see if we should remain stopped or continue.
					shouldRemainedStoppedOnBreakpoint =
						hasUnconditionalBreakpoints
						|| await this.anyBreakpointConditionReturnsTrue(conditionalBreakpoints, thread);

					// Output any logpoint messages.
					for (const logPoint of logPoints) {
						// TODO: Escape triple quotes?
						const logMessage = logPoint.logMessage
							.replace(/(^|[^\\\$]){/g, "$1\${") // Prefix any {tokens} with $ if they don't have
							.replace(/\\({)/g, "$1"); // Remove slashes
						const printCommand = `print("""${logMessage}""")`;
						await this.evaluateAndSendErrors(thread, printCommand);
					}
				}
			} else if (kind === "PauseBreakpoint") {
				reason = "step";
			} else if (kind === "PauseException") {
				reason = "exception";
				exceptionText = this.valueAsString(event.exception, false);
				if (!exceptionText)
					exceptionText = await this.callToString(event.isolate, event.exception, true);
			}

			if (shouldRemainedStoppedOnBreakpoint) {
				thread.handlePaused(event.atAsyncSuspension, event.exception);
				this.sendEvent(new StoppedEvent(reason, thread.number, exceptionText));
			} else {
				this.observatory.resume(thread.ref.id);
			}
		}
	}

	private async anyBreakpointConditionReturnsTrue(breakpoints: DebugProtocol.SourceBreakpoint[], thread: ThreadInfo) {
		for (const bp of breakpoints) {
			const evalResult = await this.evaluateAndSendErrors(thread, bp.condition);
			if (evalResult) {
				// To be considered true, we need to have a value and either be not-a-bool
				const breakpointconditionEvaluatesToTrue =
					(evalResult.kind === "Bool" && evalResult.valueAsString === "true")
					|| (evalResult.kind === "Int" && evalResult.valueAsString !== "0");
				if (breakpointconditionEvaluatesToTrue)
					return true;

			}
		}
		return false;
	}

	private async evaluateAndSendErrors(thread: ThreadInfo, expression: string): Promise<VMInstanceRef> {
		function trimToFirstNewline(s: string) {
			s = s && s.toString();
			const newlinePos = s.indexOf("\n");
			return s.substr(0, newlinePos).trim();
		}
		try {
			const result = await this.observatory.evaluateInFrame(thread.ref.id, 0, expression);
			if (result.result.type !== "@Error") {
				return result.result as VMInstanceRef;
			} else {
				this.sendEvent(new OutputEvent(`Debugger failed to evaluate expression \`${expression}\``, "stderr"));
			}
		} catch {
			this.sendEvent(new OutputEvent(`Debugger failed to evaluate expression \`${expression}\``, "stderr"));
		}
	}

	public handleServiceExtensionAdded(event: VMEvent) {
		if (event && event.extensionRPC) {
			this.sendEvent(new Event("dart.serviceExtensionAdded", { id: event.extensionRPC }));
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
			uri = path.relative(this.cwd, uri);
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

	private valueAsString(ref: VMInstanceRef | VMSentinel, useClassNameAsFallback = true, suppressQuotesAroundStrings: boolean = false): string {
		if (ref.type === "Sentinel")
			return ref.valueAsString;

		const instanceRef = ref as VMInstanceRef;

		if (ref.valueAsString) {
			let str: string = instanceRef.valueAsString;
			if (instanceRef.valueAsStringIsTruncated)
				str += "…";
			if (instanceRef.kind === "String" && !suppressQuotesAroundStrings)
				str = `"${str}"`;
			return str;
		} else if (ref.kind === "List") {
			return `[${instanceRef.length}]`;
		} else if (ref.kind === "Map") {
			return `{${instanceRef.length}}`;
		} else if (useClassNameAsFallback) {
			return this.getFriendlyTypeName(instanceRef);
		} else {
			return null;
		}
	}

	private getFriendlyTypeName(ref: VMInstanceRef): string {
		return ref.kind !== "PlainInstance" ? ref.kind : ref.class.name;
	}

	private instanceRefToVariable(
		thread: ThreadInfo, canEvaluate: boolean, evaluateName: string, name: string, ref: VMInstanceRef | VMSentinel,
	): DebugProtocol.Variable {
		if (ref.type === "Sentinel") {
			return {
				name,
				value: (ref as VMSentinel).valueAsString,
				variablesReference: 0,
			};
		} else {
			const val = ref as InstanceWithEvaluateName;
			// Stick on the evaluateName as we'll need this to build
			// the evaluateName for the child, and we don't have the parent
			// (or a string expression) in the response.
			val.evaluateName = canEvaluate ? evaluateName : undefined;

			let str = this.valueAsString(val);
			if (!val.valueAsString && !str)
				str = "";

			return {
				evaluateName: canEvaluate ? evaluateName : null,
				indexedVariables: (val.kind.endsWith("List") ? val.length : null),
				name,
				type: `${val.kind} (${val.class.name})`,
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

	private async pollForMemoryUsage(): Promise<void> {
		if (!this.childProcess || this.childProcess.killed)
			return;

		const result = await this.observatory.getVM();
		const vm = result.result as VM;

		const promises: Array<Promise<DebuggerResult>> = [];

		const isolatePromises = vm.isolates.map((isolateRef) => this.observatory.getIsolate(isolateRef.id));
		const isolatesResponses = await Promise.all(isolatePromises);
		const isolates = isolatesResponses.map((response) => response.result as VMIsolate);

		let current = 0;
		let total = 0;

		for (const isolate of isolates) {
			for (const heap of [isolate._heaps.old, isolate._heaps.new]) {
				current += heap.used + heap.external;
				total += heap.capacity + heap.external;
			}
		}

		this.sendEvent(new Event("dart.debugMetrics", { memory: { current, total } }));

		setTimeout(() => this.pollForMemoryUsage(), this.pollforMemoryMs);
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
		if (threadInfo) {
			this.debugSession.sendEvent(new ThreadEvent("exited", threadInfo.number));
			this.threads.splice(this.threads.indexOf(threadInfo), 1);
		} else {
			console.error(`Failed to find thread for ${ref.id} during exit`);
		}
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
	// TODO: Do we need both sets of breakpoints?
	public breakpoints: { [key: string]: DebugProtocol.SourceBreakpoint } = {};
	public atAsyncSuspension: boolean = false;
	public exceptionReference = 0;
	public paused: boolean = false;

	constructor(manager: ThreadManager, ref: VMIsolateRef, num: number) {
		this.manager = manager;
		this.ref = ref;
		this.number = num;
	}

	private removeBreakpointsAtUri(uri: string): Promise<DebuggerResult[]> {
		const removeBreakpointPromises = [];
		const breakpoints = this.vmBps[uri];
		if (breakpoints) {
			for (const bp of breakpoints) {
				removeBreakpointPromises.push(this.manager.debugSession.observatory.removeBreakpoint(this.ref.id, bp.id));
			}
			delete this.vmBps[uri];
		}
		return Promise.all(removeBreakpointPromises);
	}

	public removeAllBreakpoints(): Promise<DebuggerResult[]> {
		const removeBreakpointPromises = [];
		for (const uri of Object.keys(this.vmBps)) {
			removeBreakpointPromises.push(this.removeBreakpointsAtUri(uri));
		}
		return Promise.all(removeBreakpointPromises).then((results) => {
			return [].concat.apply([], results);
		});
	}

	public setBreakpoints(uri: string, breakpoints: DebugProtocol.SourceBreakpoint[]): Promise<boolean[]> {
		// Remove all current bps.
		const removeBreakpointPromises = this.removeBreakpointsAtUri(uri);

		this.vmBps[uri] = [];

		return removeBreakpointPromises.then(() => {
			// Set new ones.
			const promises = [];

			for (const bp of breakpoints) {
				const promise = this.manager.debugSession.observatory.addBreakpointWithScriptUri(
					this.ref.id, uri, bp.line, bp.column,
				).then((result: DebuggerResult) => {
					const vmBp: VMBreakpoint = result.result as VMBreakpoint;
					this.vmBps[uri].push(vmBp);
					this.breakpoints[vmBp.id] = bp;
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
		this.paused = true;
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
		if (this.paused && this.gotPauseStart && this.initialBreakpoints && this.hasConfigurationDone)
			this.manager.debugSession.observatory.resume(this.ref.id).then((_) => this.handleResumed());
	}

	public handleResumed() {
		// TODO: I don"t think we want to do this...
		// this.manager.removeStoredIds(this.storedIds);
		// this.storedIds = [];
		this.atAsyncSuspension = false;
		this.exceptionReference = 0;
		this.paused = false;
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

	public handlePaused(atAsyncSuspension?: boolean, exception?: VMInstanceRef) {
		this.atAsyncSuspension = atAsyncSuspension;
		if (exception)
			this.exceptionReference = this.storeData(exception);
		this.paused = true;
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

interface InstanceWithEvaluateName extends VMInstanceRef {
	// Undefined means we cannot evaluate
	// Null means we use the name
	// Otherwise we use the string
	evaluateName: string | null | undefined;
}
