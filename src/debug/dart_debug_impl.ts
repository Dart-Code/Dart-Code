import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { URL } from "url";
import { DebugSession, Event, InitializedEvent, OutputEvent, Scope, Source, StackFrame, StoppedEvent, TerminatedEvent } from "vscode-debugadapter";
import { DebugProtocol } from "vscode-debugprotocol";
import { DartCapabilities } from "../shared/capabilities/dart";
import { VmServiceCapabilities } from "../shared/capabilities/vm_service";
import { debugLaunchProgressId, debugTerminatingProgressId, pleaseReportBug, vmServiceListeningBannerPattern } from "../shared/constants";
import { LogCategory, LogSeverity } from "../shared/enums";
import { LogMessage, SpawnedProcess } from "../shared/interfaces";
import { safeSpawn } from "../shared/processes";
import { PackageMap } from "../shared/pub/package_map";
import { errorString, notUndefined, PromiseCompleter, uniq, uriToFilePath } from "../shared/utils";
import { sortBy } from "../shared/utils/array";
import { applyColor, grey, grey2 } from "../shared/utils/colors";
import { getRandomInt } from "../shared/utils/fs";
import { DebuggerResult, Version, VM, VMClass, VMClassRef, VMErrorRef, VMEvent, VMFrame, VMInstance, VMInstanceRef, VMIsolate, VMIsolateRef, VMMapEntry, VMObj, VMScript, VMScriptRef, VMSentinel, VmServiceConnection, VMStack, VMTypeRef } from "./dart_debug_protocol";
import { DebugAdapterLogger } from "./logging";
import { ThreadInfo, ThreadManager } from "./threads";
import { DartAttachRequestArguments, DartLaunchRequestArguments, FileLocation, formatPathForVm } from "./utils";

const maxValuesToCallToString = 15;
// Prefix that appears at the start of stack frame names that are unoptimized
// which we'd prefer not to show to the user.
const unoptimizedPrefix = "[Unoptimized] ";
const stackFrameWithUriPattern = new RegExp(`(.*#\\d+.*)\\(((?:package|dart|file):.*\\.dart):(\\d+):(\\d+)\\)\\s*$`, "m");
const webStackFrameWithUriPattern = new RegExp(`((?:package|dart|file):.*\\.dart) (\\d+):(\\d+)\\s*(\\S+)\\s*$`, "m");
const messageWithUriPattern = new RegExp(`(.*?)((?:package|dart|file):.*\\.dart):(\\d+):(\\d+)\\s*$`, "m");
const trailingSemicolonPattern = new RegExp(`;\\s*$`, "m");

// TODO: supportsSetVariable
// TODO: class variables?
// TODO: library variables?
// stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments): void;
// restartFrameRequest(response: DebugProtocol.RestartFrameResponse, args: DebugProtocol.RestartFrameArguments): void;
// completionsRequest(response: DebugProtocol.CompletionsResponse, args: DebugProtocol.CompletionsArguments): void;
export class DartDebugSession extends DebugSession {
	// TODO: Tidy all this up
	protected childProcess?: SpawnedProcess | RemoteEditorTerminalProcess;

	/** The additional process IDs to terminate when terminating a debugging session.
	 *
	 * A Set is used so a Process ID does not appear multiple times within the collection as
	 * that can cause a (eg. testing) session to be terminated prematurely while waiting for it to end.
	 */
	protected readonly additionalPidsToTerminate = new Set<number>();

	protected expectAdditionalPidToTerminate = false;
	private additionalPidCompleter = new PromiseCompleter<void>();
	// We normally track the pid from the VM service to terminate the VM afterwards, but for Flutter Run it's
	// a remote PID and therefore doesn't make sense to try and terminate.
	protected allowTerminatingVmServicePid = true;
	// Normally we don't connect to the VM when running no noDebug mode, but for
	// Flutter, this means we can't call service extensions (for ex. toggling
	// debug modes) so we allow it to override this (and then we skip things
	// like breakpoints). We can't do it always, because some functionality
	// (such as running multiple test suites) will break by having multiple
	// potential VM services come and go.
	// https://github.com/Dart-Code/Dart-Code/issues/1673
	protected connectVmEvenForNoDebug = false;
	protected allowWriteServiceInfo = true;
	protected processExited = false;
	public vmService?: VmServiceConnection;
	protected cwd?: string;
	public noDebug?: boolean;
	private logFile?: string;
	private sendLogsToClient = false;
	protected toolEnv?: any;
	private logStream?: fs.WriteStream;
	public debugSdkLibraries = false;
	public debugExternalLibraries = false;
	public showDartDeveloperLogs = true;
	public useFlutterStructuredErrors = false;
	public evaluateGettersInDebugViews = false;
	protected evaluateToStringInDebugViews = false;
	protected readonly dartCapabilities = DartCapabilities.empty;
	protected readonly vmServiceCapabilities = VmServiceCapabilities.empty;
	protected useWriteServiceInfo = false;
	protected vmServiceInfoFile?: string;
	private serviceInfoPollTimer?: NodeJS.Timer;
	private remoteEditorTerminalLaunched?: Promise<RemoteEditorTerminalProcess>;
	private serviceInfoFileCompleter?: PromiseCompleter<string>;
	public debuggerHandlesPathsEverywhereForBreakpoints = false;
	protected threadManager: ThreadManager;
	public packageMap?: PackageMap;
	protected sendStdOutToConsole: boolean = true;
	protected supportsObservatoryWebApp: boolean = true;
	protected parseVmServiceUriFromStdOut: boolean = true;
	protected requiresProgram: boolean = true;
	protected pollforMemoryMs?: number; // If set, will poll for memory usage and send events back.
	protected processExit: Promise<{ code: number | null, signal: string | null }> = Promise.resolve({ code: 0, signal: null });
	protected maxLogLineLength: number = 1000; // This should always be overriden in launch/attach requests but we have it here for narrower types.
	protected shouldKillProcessOnTerminate = true;
	protected logCategory = LogCategory.General; // This isn't used as General, since both debuggers override it.
	protected supportsRunInTerminalRequest = false;
	protected supportsDebugInternalLibraries = false;
	protected isTerminating = false;
	protected readonly logger = new DebugAdapterLogger(this, LogCategory.VmService);

	protected get shouldConnectDebugger() {
		return !this.noDebug || this.connectVmEvenForNoDebug;
	}

	public constructor() {
		super();

		this.threadManager = new ThreadManager(this.logger, this);
	}

	protected initializeRequest(
		response: DebugProtocol.InitializeResponse,
		args: DebugProtocol.InitializeRequestArguments,
	): void {
		this.supportsRunInTerminalRequest = !!args.supportsRunInTerminalRequest;

		response.body = response.body || {};
		response.body.supportsConfigurationDoneRequest = true;
		response.body.supportsEvaluateForHovers = true;
		response.body.supportsDelayedStackTraceLoading = true;
		response.body.supportsConditionalBreakpoints = true;
		response.body.supportsLogPoints = true;
		response.body.supportsTerminateRequest = true;
		response.body.supportsRestartFrame = true;
		response.body.supportsClipboardContext = true;
		response.body.exceptionBreakpointFilters = [
			{ filter: "All", label: "All Exceptions", default: false },
			{ filter: "Unhandled", label: "Uncaught Exceptions", default: true },
		];
		this.sendResponse(response);
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: DartLaunchRequestArguments): Promise<void> {
		if (!args || !args.dartPath || (this.requiresProgram && !args.program)) {
			this.logToUser("Unable to restart debugging. Please try ending the debug session and starting again.\n");
			this.sendEvent(new TerminatedEvent());
			return;
		}

		// Force relative paths to absolute.
		if (args.program && !path.isAbsolute(args.program)) {
			if (!args.cwd) {
				return this.errorResponse(response, "Unable to start debugging. program was specified as a relative path without cwd.");
			}
			args.program = path.join(args.cwd, args.program);
		}

		this.startProgress(debugLaunchProgressId, "Launching");

		this.shouldKillProcessOnTerminate = true;
		this.cwd = args.cwd;
		this.noDebug = args.noDebug;
		// Set default exception mode based on noDebug. This will be sent to threads
		// prior to VS Code sending (or, in the case of noDebug, due to not sending)
		// the exception mode.
		await this.threadManager.setExceptionPauseMode(this.noDebug ? "None" : "Unhandled");
		this.packageMap = new PackageMap(PackageMap.findPackagesFile(args.program || args.cwd));
		this.dartCapabilities.version = args.dartVersion;
		this.useWriteServiceInfo = this.allowWriteServiceInfo && this.dartCapabilities.supportsWriteServiceInfo;
		this.supportsDebugInternalLibraries = this.dartCapabilities.supportsDebugInternalLibraries;
		this.readSharedArgs(args);

		this.sendResponse(response);

		if (this.useWriteServiceInfo) {
			this.parseVmServiceUriFromStdOut = false;
			this.vmServiceInfoFile = path.join(os.tmpdir(), `dart-vm-service-${getRandomInt(0x1000, 0x10000).toString(16)}.json`);
		}

		try {
			// Terminal mode is only supported if we can use writeServiceInfo.
			// TODO: Move useWriteServiceInfo check to the client, so other clients do not need to provide this.
			if (args.console === "terminal" && !this.supportsRunInTerminalRequest) {
				this.log("Ignoring request to run in terminal because client does not support runInTerminalRequest", LogSeverity.Warn);
			}
			if (args.console === "terminal" && this.useWriteServiceInfo && this.supportsRunInTerminalRequest) {
				this.childProcess = await this.spawnRemoteEditorProcess(args);
			} else {
				const process = this.spawnProcess(args);

				this.childProcess = process;
				this.processExited = false;
				this.processExit = new Promise((resolve) => process.on("exit", (code, signal) => resolve({ code, signal })));
				process.stdout.setEncoding("utf8");
				process.stdout.on("data", async (data) => {
					let match: RegExpExecArray | null = null;
					if (this.shouldConnectDebugger && this.parseVmServiceUriFromStdOut && !this.vmService) {
						match = vmServiceListeningBannerPattern.exec(data.toString());
					}
					if (match) {
						await this.initDebugger(this.vmServiceWsUriFor(match[1]));
					} else if (this.sendStdOutToConsole)
						this.logToUserBuffered(data.toString(), "stdout");
				});
				process.stderr.setEncoding("utf8");
				process.stderr.on("data", (data) => {
					this.logToUserBuffered(data.toString(), "stderr");
				});
				process.on("error", (error) => {
					this.logToUser(`${error}\n`, "stderr");
				});
				// tslint:disable-next-line: no-floating-promises
				this.processExit.then(async ({ code, signal }) => {
					this.stopServiceFilePolling();
					this.processExited = true;
					this.log(`Process exited (${signal ? `${signal}`.toLowerCase() : code})`);
					if (!code && !signal)
						this.logToUser("Exited\n");
					else
						this.logToUser(`Exited (${signal ? `${signal}`.toLowerCase() : code})\n`);
					// To reduce the chances of losing async logs, wait a short period
					// before terminating.
					await this.raceIgnoringErrors(() => this.lastLoggingEvent, 500);
					// Add a small delay to allow for async events to complete first
					// to reduce the chance of closing output.
					setTimeout(() => this.sendEvent(new TerminatedEvent()), 250);
				});
			}

			if (this.useWriteServiceInfo && this.shouldConnectDebugger) {
				const url = await this.startServiceFilePolling();
				await this.initDebugger(url.toString());
			}
		} catch (e) {
			this.logToUser(`Unable to start debugging: ${e}`);
			this.sendEvent(new TerminatedEvent());
			return;
		}

		if (!this.shouldConnectDebugger) {
			this.endProgress(debugLaunchProgressId);
			this.sendEvent(new InitializedEvent());

			// If we're not connecting a debugger and we spawned a remote process, we have
			// no way of knowing when the process terminates and will have to just end the debug
			// session immediately (it has no value anyway).
			if (this.childProcess && this.childProcess instanceof RemoteEditorTerminalProcess)
				setImmediate(() => this.sendEvent(new TerminatedEvent()), 0);
		}
	}

	private readSharedArgs(args: DartLaunchRequestArguments | DartAttachRequestArguments) {
		this.debugExternalLibraries = args.debugExternalLibraries;
		this.debuggerHandlesPathsEverywhereForBreakpoints = this.dartCapabilities.handlesPathsEverywhereForBreakpoints;
		this.debugSdkLibraries = args.debugSdkLibraries;
		this.evaluateGettersInDebugViews = args.evaluateGettersInDebugViews;
		this.evaluateToStringInDebugViews = args.evaluateToStringInDebugViews;
		this.logFile = args.vmServiceLogFile;
		this.maxLogLineLength = args.maxLogLineLength;
		this.sendLogsToClient = !!args.sendLogsToClient;
		this.showDartDeveloperLogs = args.showDartDeveloperLogs;
		this.toolEnv = args.toolEnv;
		this.useFlutterStructuredErrors = args.useFlutterStructuredErrors;
	}

	protected async attachRequest(response: DebugProtocol.AttachResponse, args: DartAttachRequestArguments): Promise<void> {
		const vmServiceUri = (args.vmServiceUri || args.observatoryUri);
		if (!args || (!vmServiceUri && !args.serviceInfoFile)) {
			return this.errorResponse(response, "Unable to attach; no VM service address or service info file provided.");
		}

		this.startProgress(debugLaunchProgressId, "Waiting for application");

		this.shouldKillProcessOnTerminate = false;
		this.cwd = args.cwd;
		this.readSharedArgs(args);

		this.log(`Attaching to process via ${vmServiceUri || args.serviceInfoFile}`);

		// If we were given an explicity packages path, use it (otherwise we'll try
		// to extract from the VM)
		if (args.packages) {
			// Support relative paths
			if (args.packages && !path.isAbsolute(args.packages))
				args.packages = args.cwd ? path.join(args.cwd, args.packages) : args.packages;

			try {
				this.packageMap = new PackageMap(PackageMap.findPackagesFile(args.packages));
			} catch (e) {
				this.errorResponse(response, `Unable to load packages file: ${e}`);
			}
		}

		this.sendResponse(response);

		let url: string | undefined;
		try {
			if (vmServiceUri) {
				url = this.vmServiceWsUriFor(vmServiceUri);
			} else {
				this.vmServiceInfoFile = args.serviceInfoFile;
				this.updateProgress(debugLaunchProgressId, `Waiting for ${this.vmServiceInfoFile}`);
				url = await this.startServiceFilePolling();
				this.endProgress(debugLaunchProgressId);
			}
			await this.initDebugger(url);
		} catch (e) {
			const messageSuffix = args.serviceInfoFile ? `\n    VM info was read from ${args.serviceInfoFile}` : "";
			this.logToUser(`Unable to connect to VM service at ${url || "??"}${messageSuffix}\n    ${e}`);
			this.sendEvent(new TerminatedEvent());
			return;
		}
	}

	protected sourceFileForArgs(args: DartLaunchRequestArguments) {
		return args.cwd ? path.relative(args.cwd, args.program) : args.program;
	}

	protected spawnProcess(args: DartLaunchRequestArguments) {
		const appArgs = this.buildAppArgs(args);

		this.log(`Spawning ${args.dartPath} with args ${JSON.stringify(appArgs)}`);
		if (args.cwd)
			this.log(`..  in ${args.cwd}`);
		const process = safeSpawn(args.cwd, args.dartPath, appArgs, { envOverrides: args.env, toolEnv: args.toolEnv });

		this.log(`    PID: ${process.pid}`);

		return process;
	}

	protected async spawnRemoteEditorProcess(args: DartLaunchRequestArguments): Promise<RemoteEditorTerminalProcess> {
		const appArgs = this.buildAppArgs(args);

		this.log(`Spawning ${args.dartPath} remotely with args ${JSON.stringify(appArgs)}`);
		if (args.cwd)
			this.log(`..  in ${args.cwd}`);

		this.remoteEditorTerminalLaunched = new Promise<RemoteEditorTerminalProcess>((resolve, reject) => {
			this.sendRequest("runInTerminal", {
				args: [args.dartPath].concat(appArgs),
				cwd: args.cwd,
				env: args.env,
				kind: "integrated",
				title: args.name,
			} as DebugProtocol.RunInTerminalRequestArguments, 15000, (response: DebugProtocol.Response) => {
				if (response.success) {
					this.log(`    PID: ${process.pid}`);
					const resp = response as DebugProtocol.RunInTerminalResponse;
					resolve(new RemoteEditorTerminalProcess(resp.body.processId || resp.body.shellProcessId));
				} else {
					reject(response.message);
				}
			});
		});

		return this.remoteEditorTerminalLaunched;
	}

	private buildAppArgs(args: DartLaunchRequestArguments) {
		let appArgs = [];
		if (this.shouldConnectDebugger) {
			this.expectAdditionalPidToTerminate = true;
			appArgs.push(`--enable-vm-service=${args.vmServicePort}`);
			appArgs.push("--pause_isolates_on_start=true");
		}
		if (this.useWriteServiceInfo && this.vmServiceInfoFile) {
			appArgs.push(`--write-service-info=${formatPathForVm(this.vmServiceInfoFile)}`);
			appArgs.push("-DSILENT_OBSERVATORY=true");
		}
		if (args.enableAsserts !== false) { // undefined = on
			appArgs.push("--enable-asserts");
		}
		if (args.vmAdditionalArgs) {
			appArgs = appArgs.concat(args.vmAdditionalArgs);
		}
		appArgs.push(this.sourceFileForArgs(args));
		if (args.args) {
			appArgs = appArgs.concat(args.args);
		}
		return appArgs;
	}

	protected vmServiceWsUriFor(uri: string) {
		const wsUri = uri.trim();
		if (wsUri.endsWith("/ws"))
			return wsUri;
		else if (wsUri.endsWith("/ws/"))
			return wsUri.substr(0, wsUri.length - 1);
		else if (wsUri.endsWith("/"))
			return `${wsUri}ws`;
		else
			return `${wsUri}/ws`;
	}

	protected log(message: string, severity = LogSeverity.Info) {
		if (this.logFile) {
			if (!this.logStream) {
				this.logStream = fs.createWriteStream(this.logFile);
			}
			this.logStream.write(`[${(new Date()).toLocaleTimeString()}]: `);
			if (this.maxLogLineLength && message.length > this.maxLogLineLength)
				this.logStream.write(message.substring(0, this.maxLogLineLength) + "…\r\n");
			else
				this.logStream.write(message.trim() + "\r\n");
		}

		if (this.sendLogsToClient)
			this.sendEvent(new Event("dart.log", { message, severity, category: LogCategory.VmService } as LogMessage));
	}

	private startServiceFilePolling(): Promise<string> {
		this.logger.info(`Starting to poll for file ${this.vmServiceInfoFile}`);
		// Ensure we stop if we were already running, to avoid leaving timers running
		// if this is somehow called twice.
		this.stopServiceFilePolling(false);
		if (this.serviceInfoFileCompleter)
			this.serviceInfoFileCompleter.reject("Cancelled");
		this.serviceInfoFileCompleter = new PromiseCompleter<string>();
		this.serviceInfoPollTimer = setInterval(() => this.tryReadServiceFile(), 50);
		return this.serviceInfoFileCompleter.promise;
	}

	private stopServiceFilePolling(allowDelete = true) {
		if (this.serviceInfoPollTimer) {
			this.logger.info(`Stopping polling for file ${this.vmServiceInfoFile}`);
			clearInterval(this.serviceInfoPollTimer);
		}
		if (allowDelete
			&& this.vmServiceInfoFile
			&& fs.existsSync(this.vmServiceInfoFile)
			// And we launched the process - we don't want to delete files we
			// didn't create.
			&& this.remoteEditorTerminalLaunched) {
			try {
				fs.unlinkSync(this.vmServiceInfoFile);
				this.vmServiceInfoFile = undefined;
			} catch (e) {
				// Don't complain if we failed - the file may have been cleaned up
				// in the meantime.
			}
		}
	}

	private async tryReadServiceFile(): Promise<void> {
		if (!this.vmServiceInfoFile || !fs.existsSync(this.vmServiceInfoFile))
			return;

		try {
			const serviceInfoJson = fs.readFileSync(this.vmServiceInfoFile, "utf8");

			// It's possible we read the file before the VM had started writing it, so
			// do some crude checks and bail to reduce the chances of logging half-written
			// files as errors.
			if (serviceInfoJson.length < 2 || !serviceInfoJson.trimRight().endsWith("}"))
				return;

			const serviceInfo: { uri: string } = JSON.parse(serviceInfoJson);

			this.logger.info(`Succesfully read JSON from ${this.vmServiceInfoFile}`);

			const url = new URL(serviceInfo.uri);
			url.protocol = "ws";
			// Ensure we no trailing /
			if (url.pathname.endsWith("/"))
				url.pathname = url.pathname.substr(0, url.pathname.length - 1);
			// Ensure we always end with /ws
			if (!url.pathname.endsWith("/ws"))
				url.pathname = `${url.pathname}/ws`;

			this.stopServiceFilePolling();
			// Ensure we don't try to start anything before we've finished
			// setting up the process when running remotely.
			if (this.remoteEditorTerminalLaunched) {
				await this.remoteEditorTerminalLaunched;
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
			this.serviceInfoFileCompleter?.resolve(url.toString());
		} catch (e) {
			this.logger.error(e);
			this.serviceInfoFileCompleter?.reject(e);
		}
	}

	protected async initDebugger(uri: string): Promise<void> {
		this.log(`Initialising debugger for ${uri}`);
		// Send the uri back to the editor so it can be used to launch browsers etc.
		let browserFriendlyUri: string;
		if (uri.endsWith("/ws")) {
			browserFriendlyUri = uri.substring(0, uri.length - 2);
			if (browserFriendlyUri.startsWith("ws:"))
				browserFriendlyUri = "http:" + browserFriendlyUri.substring(3);
		} else {
			browserFriendlyUri = uri;
		}

		this.sendEvent(new Event("dart.debuggerUris", {
			// If we don't support Observatory, don't send its URL back to the editor.
			observatoryUri: this.supportsObservatoryWebApp ? browserFriendlyUri.toString() : undefined,
			vmServiceUri: browserFriendlyUri.toString(),
		}));

		if (!this.shouldConnectDebugger)
			return;

		return new Promise<void>((resolve, reject) => {
			this.log(`Connecting to VM Service at ${uri}`);
			this.logToUser(`Connecting to VM Service at ${uri}\n`);
			this.vmService = new VmServiceConnection(uri);
			this.vmService.onLogging((message) => this.log(message));
			// TODO: Extract some code here and change to async/await. This is
			// super confusing, for ex. it's not clear the resolve() inside onOpen
			// fires immediately opon opening, not when all the code in the getVM
			// callback fires (so it may as well have come first - unless it's
			// a bug/race and it was supposed to be after all the setup!).
			this.vmService.onOpen(async () => {
				if (!this.vmService)
					return;

				// Read the version to update capabilities before doing anything else.
				await this.vmService.getVersion().then(async (versionResult) => {
					const version: Version = versionResult.result as Version;
					this.vmServiceCapabilities.version = `${version.major}.${version.minor}.0`;

					if (!this.vmService)
						return;

					await this.vmService.getVM().then(async (vmResult): Promise<void> => {
						if (!this.vmService)
							return;
						const vm: VM = vmResult.result as VM;

						await this.subscribeToStreams();

						// If we own this process (we launched it, didn't attach) and the PID we get from the VM service is different, then
						// we should keep a ref to this process to terminate when we quit. This avoids issues where our process is a shell
						// (we use shell execute to fix issues on Windows) and the kill signal isn't passed on correctly.
						// See: https://github.com/Dart-Code/Dart-Code/issues/907
						if (this.allowTerminatingVmServicePid && this.childProcess) {
							this.recordAdditionalPid(vm.pid);
						}

						const isolates = await Promise.all(vm.isolates.map((isolateRef) => this.vmService!.getIsolate(isolateRef.id)));

						// TODO: Is it valid to assume the first (only?) isolate with a rootLib is the one we care about here?
						// If it's always the first, could we even just query the first instead of getting them all before we
						// start the other processing?
						const rootIsolateResult = isolates.find((isolate) => !!(isolate.result as VMIsolate).rootLib);
						const rootIsolate = rootIsolateResult && rootIsolateResult.result as VMIsolate;

						if (rootIsolate && rootIsolate.extensionRPCs) {
							// If we're attaching, we won't see ServiceExtensionAdded events for extensions already loaded so
							// we need to enumerate them here.
							rootIsolate.extensionRPCs.forEach((id) => this.notifyServiceExtensionAvailable(id, rootIsolate.id));
						}

						if (!this.packageMap) {
							// TODO: There's a race here if the isolate is not yet runnable, it might not have rootLib yet. We don't
							// currently fill this in later.
							if (rootIsolate && rootIsolate.rootLib)
								this.packageMap = new PackageMap(PackageMap.findPackagesFile(this.convertVMUriToSourcePath(rootIsolate.rootLib.uri)));
						}

						await Promise.all(isolates.map(async (response) => {
							const isolate: VMIsolate = response.result as VMIsolate;
							await this.threadManager.registerThread(
								isolate,
								isolate.runnable ? "IsolateRunnable" : "IsolateStart",
							);

							if (isolate.pauseEvent.kind.startsWith("Pause")) {
								await this.handlePauseEvent(isolate.pauseEvent);
							}
						}));

						// Set a timer for memory updates.
						if (this.pollforMemoryMs)
							setTimeout(() => this.pollForMemoryUsage(), this.pollforMemoryMs);

						this.endProgress(debugLaunchProgressId);
						this.sendEvent(new InitializedEvent());
					});
				});

				resolve();
			});

			this.vmService.onClose((code: number, message: string) => {

				this.log(`VM service connection closed: ${code} (${message})`);
				if (this.logStream) {
					this.logStream.end();
					this.logStream = undefined;
					// Wipe out the filename so if a message arrives late, it doesn't
					// wipe out the logfile with just a "process exited" or similar message.
					this.logFile = undefined;
				}
				// If we don't have a process (eg. we're attached) or we ran as a terminal, then this is our signal to quit,
				// since we won't get a process exit event.
				if (!this.childProcess || this.childProcess instanceof RemoteEditorTerminalProcess) {
					this.sendEvent(new TerminatedEvent());
				} else {
					// In some cases the VM service closes but we never get the exit/close events from the process
					// so this is a fallback to termiante the session after a short period. Without this, we have
					// issues like https://github.com/Dart-Code/Dart-Code/issues/1268 even though when testing from
					// the terminal the app does terminate as expected.
					// 2019-07-10: Increased delay because when we tell Flutter to stop the VM service quits quickly and
					// this code results in a TerminatedEvent() even though the process hasn't quit. The TerminatedEvent()
					// results in VS Code sending disconnectRequest() and we then try to more forefully kill.
					setTimeout(() => {
						if (!this.processExited)
							this.sendEvent(new TerminatedEvent());
					}, 5000);
				}
			});

			this.vmService.onError((error) => {
				reject(error);
			});
		});
	}

	protected recordAdditionalPid(pid: number) {
		this.additionalPidsToTerminate.add(pid);
		this.additionalPidCompleter.resolve();
	}

	private async subscribeToStreams(): Promise<void> {
		if (!this.vmService)
			return;

		const serviceStreamName = this.vmServiceCapabilities.serviceStreamIsPublic ? "Service" : "_Service";
		await Promise.all([
			this.vmService.on("Isolate", (event: VMEvent) => this.handleIsolateEvent(event)),
			this.vmService.on("Extension", (event: VMEvent) => this.handleExtensionEvent(event)),
			this.vmService.on("Debug", (event: VMEvent) => this.handleDebugEvent(event)),
			this.vmService.on(serviceStreamName, (event: VMEvent) => this.handleServiceEvent(event)),
		]);

		if (this.vmServiceCapabilities.hasLoggingStream && this.showDartDeveloperLogs) {
			await this.vmService.on("Logging", (event: VMEvent) => this.handleLoggingEvent(event)).catch((e) => {
				this.logger.info(errorString(e));
				// For web, the protocol version says this is supported, but it throws.
				// TODO: Remove this catch block if/when the stable release does not throw.
			});
		}
	}

	protected async terminate(force: boolean): Promise<void> {
		const signal = force ? "SIGKILL" : "SIGINT";
		const request = force ? "DISC" : "TERM";
		this.log(`${request}: Requested to terminate with ${signal}...`);
		this.stopServiceFilePolling();
		if (this.shouldKillProcessOnTerminate && this.childProcess && !this.processExited) {
			this.log(`${request}: Terminating processes...`);
			for (const pid of this.additionalPidsToTerminate) {
				if (pid === this.childProcess.pid)
					continue;
				try {
					this.log(`${request}: Terminating related process ${pid} with ${signal}...`);
					process.kill(pid, signal);
					// Don't remove these PIDs from the list as we don't know that they actually quit yet.
				} catch (e) {
					// Sometimes this process will have already gone away (eg. the app finished/terminated)
					// so logging here just results in lots of useless info.
				}
			}
			if (!this.processExited) {
				if (this.childProcess.pid) {
					try {
						this.log(`${request}: Terminating main process with ${signal}...`);
						process.kill(this.childProcess.pid, signal);
					} catch (e) {
						// This tends to throw a lot because the shell process quit when we terminated the related
						// VM process above, so just swallow the error.
					}
				} else {
					this.log(`${request}: Process had no PID.`);
				}

				// If we didn't quit, it might be because we're paused.
				await this.tryRemoveAllBreakpointsAndResumeAllThreads(request);
			} else {
				this.log(`${request}: Main process had already quit.`);
			}
			// Don't do this - because the process might ignore our kill (eg. test framework lets the current
			// test finish) so we may need to send again it we get another disconnectRequest.
			// We also use !childProcess to mean we're attached.
			// this.childProcess = undefined;
		} else if (!this.shouldKillProcessOnTerminate && this.vmService) {
			this.log(`${request}: Disconnecting from process...`);
			await this.tryRemoveAllBreakpointsAndResumeAllThreads(request);
			try {
				this.log(`${request}: Closing VM service connection...`);
				this.vmService.close();
			} catch { } finally {
				this.vmService = undefined;
			}
		} else {
			this.log(`${request}: Did not need to terminate processes`);
		}

		this.log(`${request}: Removing all stored data...`);
		this.threadManager.removeAllStoredData();

		this.log(`${request}: Waiting for process to finish...`);
		await this.processExit;

		this.log(`${request}: Disconnecting...`);
	}

	// When shutting down, we may need to remove all breakpoints and resume all threads
	// to avoid things like waiting for tests to exit that will never exit. We don't wait
	// for any responses here as if the VM has shut down we won't get them.
	private async tryRemoveAllBreakpointsAndResumeAllThreads(request: string) {
		this.log(`${request}: Disabling break-on-exception and removing all breakpoints`);
		await this.raceIgnoringErrors(() => Promise.all([
			this.threadManager.setExceptionPauseMode("None"),
			this.threadManager.threads.map((thread) => thread.removeAllBreakpoints()),
		]));

		this.log(`${request}: Unpausing all threads...`);
		await this.raceIgnoringErrors(() => Promise.all([
			this.threadManager.threads.map((thread) => thread.resume()),
		]));
	}

	// Run some code, but don't wait longer than a certain time period for the result
	// as it may never come. Returns true if the operation completed.
	private async raceIgnoringErrors(action: () => Promise<any>, timeout: number = 250): Promise<boolean> {
		try {
			return await Promise.race([
				action().then((_) => true),
				new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeout)),
			]);
		} catch (e) {
			this.log(`Error while while waiting for action: ${e}`);
			return false;
		}
	}

	protected async terminateRequest(
		response: DebugProtocol.TerminateResponse,
		args: DebugProtocol.TerminateArguments,
	): Promise<void> {
		this.log(`Termination requested!`);
		this.isTerminating = true;
		this.startProgress(debugTerminatingProgressId, "Terminating debug session");

		if (this.expectAdditionalPidToTerminate && !this.additionalPidsToTerminate.size) {
			this.log(`Waiting for main process PID before terminating`);
			this.updateProgress(debugTerminatingProgressId, "Waiting for process");
			const didGetPid = await this.raceIgnoringErrors(() => this.additionalPidCompleter.promise, 20000);
			if (didGetPid)
				this.log(`Got main process PID, continuing...`);
			else
				this.log(`Timed out waiting for main process PID, continuing anyway...`);
			this.updateProgress(debugTerminatingProgressId, "Terminating process");
		}

		try {
			await this.terminate(false);
		} catch (e) {
			return this.errorResponse(response, `${e}`);
		}
		super.terminateRequest(response, args);
	}

	protected async disconnectRequest(
		response: DebugProtocol.DisconnectResponse,
		args: DebugProtocol.DisconnectArguments,
	): Promise<void> {
		this.log(`Disconnect requested!`);
		this.isTerminating = true;
		try {
			const succeeded = await this.raceIgnoringErrors(() => this.terminate(false), 2000);
			// If we hit the 2s timeout, then terminate more forcefully.
			if (!succeeded)
				await this.terminate(true);
		} catch (e) {
			return this.errorResponse(response, `${e}`);
		}
		super.disconnectRequest(response, args);
	}

	protected async setBreakPointsRequest(
		response: DebugProtocol.SetBreakpointsResponse,
		args: DebugProtocol.SetBreakpointsArguments,
	): Promise<void> {
		if (this.noDebug) {
			response.body = { breakpoints: (args.breakpoints || []).map((b) => ({ verified: false })) };
			this.sendResponse(response);
			return;
		}

		const source: DebugProtocol.Source = args.source;
		const breakpoints: DebugProtocol.SourceBreakpoint[] = args.breakpoints || [];

		// Format the path correctly for the VM. In older SDKs we had to use
		// package: URIs in many places, however as of 2.2.2 (?) file URIs should
		// work everywhere.
		// TODO: The `|| source.name` stops a crash (#1566) but doesn't actually make
		// the breakpoints work. This needs more work.
		const uri = this.packageMap && !this.debuggerHandlesPathsEverywhereForBreakpoints
			? (this.packageMap.convertFileToPackageUri(source.path) || formatPathForVm(source.path || source.name!)!)
			: formatPathForVm(source.path || source.name!);

		try {
			const result = await this.threadManager.setBreakpoints(uri, breakpoints);
			const bpResponse = [];
			for (const bpRes of result) {
				bpResponse.push({ verified: !!bpRes });
			}

			response.body = { breakpoints: bpResponse };
			this.sendResponse(response);
		} catch (error) {
			this.errorResponse(response, `${error}`);
		}
	}

	protected async setExceptionBreakPointsRequest(
		response: DebugProtocol.SetExceptionBreakpointsResponse,
		args: DebugProtocol.SetExceptionBreakpointsArguments,
	): Promise<void> {
		const filters: string[] = args.filters;

		let mode: VmExceptionMode = "None";

		// If we're running in noDebug mode, we'll always set None.
		if (!this.noDebug) {
			if (filters.indexOf("Unhandled") !== -1)
				mode = "Unhandled";
			if (filters.indexOf("All") !== -1)
				mode = "All";
		}

		await this.threadManager.setExceptionPauseMode(mode);

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

		if (!this.vmService) {
			this.errorResponse(response, `No VM service connection`);
			return;
		}

		this.vmService.pause(thread.ref.id)
			.then((_) => this.sendResponse(response))
			.catch((error) => this.errorResponse(response, `${error}`));
	}

	protected sourceRequest(response: DebugProtocol.SourceResponse, args: DebugProtocol.SourceArguments): void {
		const sourceReference = args.sourceReference;
		const data = this.threadManager.getStoredData(sourceReference);
		const scriptRef: VMScriptRef = data.data as VMScriptRef;

		data.thread.getScript(scriptRef).then((script: VMScript) => {
			if (script.source) {
				response.body = { content: script.source, mimeType: "text/x-dart" };
			} else {
				response.success = false;
				response.message = "<source not available>";
			}
			this.sendResponse(response);
		}).catch((error) => this.errorResponse(response, `${error}`));
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		response.body = { threads: this.threadManager.getThreads() };
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		const thread = this.threadManager.getThreadInfoFromNumber(args.threadId);
		const startFrame = args.startFrame || 0;
		let levels = args.levels;

		if (!thread) {
			this.errorResponse(response, `No thread with id ${args.threadId}`);
			return;
		}

		if (!this.vmService) {
			this.errorResponse(response, `No VM service connection`);
			return;
		}

		this.vmService.getStack(thread.ref.id).then((result: DebuggerResult) => {
			const stack: VMStack = result.result as VMStack;
			let vmFrames = stack.asyncCausalFrames || stack.frames;
			const totalFrames = vmFrames.length;

			if (!levels)
				levels = totalFrames;
			if (startFrame + levels > totalFrames)
				levels = totalFrames - startFrame;
			vmFrames = vmFrames.slice(startFrame, startFrame + levels);

			const stackFrames: DebugProtocol.StackFrame[] = [];
			const promises: Array<Promise<void>> = [];

			vmFrames.forEach((frame: VMFrame) => {
				const frameId = thread.storeData(frame);

				if (frame.kind === "AsyncSuspensionMarker") {
					const stackFrame: DebugProtocol.StackFrame = new StackFrame(frameId, "<asynchronous gap>");
					stackFrame.presentationHint = "label";
					stackFrames.push(stackFrame);
					return;
				}

				const frameName =
					frame && frame.code && frame.code.name
						? (
							frame.code.name.startsWith(unoptimizedPrefix)
								? frame.code.name.substring(unoptimizedPrefix.length)
								: frame.code.name
						)
						: "<unknown>";
				const location = frame.location;

				if (!location) {
					const stackFrame: DebugProtocol.StackFrame = new StackFrame(frameId, frameName);
					stackFrame.presentationHint = "subtle";
					stackFrames.push(stackFrame);
					return;
				}

				const uri = location.script.uri;
				let sourcePath = this.convertVMUriToSourcePath(uri);
				let canShowSource = sourcePath && fs.existsSync(sourcePath);

				// Download the source if from a "dart:" uri.
				let sourceReference: number | undefined;
				if (uri.startsWith("dart:")) {
					sourcePath = undefined;
					sourceReference = thread.storeData(location.script);
					canShowSource = true;
				}

				const shortName = this.formatUriForShortDisplay(uri);
				const stackFrame: DebugProtocol.StackFrame = new StackFrame(
					frameId,
					frameName,
					canShowSource ? new Source(shortName, sourcePath, sourceReference, undefined, location.script) : undefined,
					0, 0,
				);
				// The top frame is only allowed to be deemphasized when it's an exception (so the editor walks
				// up the stack to user code). If the reson for stopping was a breakpoint, step, etc., then we
				// should always leave the frame focusable.
				const isTopFrame = stackFrames.length === 0;
				const isStoppedAtException = thread.exceptionReference !== 0;
				const allowDeemphasizingFrame = !isTopFrame || isStoppedAtException;
				// If we wouldn't debug this source, then deemphasize in the stack.
				if (stackFrame.source && allowDeemphasizingFrame) {
					if (!this.isValidToDebug(uri) || (this.isSdkLibrary(uri) && !this.debugSdkLibraries)) {
						stackFrame.source.origin = "from the Dart SDK";
						stackFrame.source.presentationHint = "deemphasize";
					} else if (this.isExternalLibrary(uri) && !this.debugExternalLibraries) {
						stackFrame.source.origin = uri.startsWith("package:flutter/") ? "from the Flutter framework" : "from Pub packages";
						stackFrame.source.presentationHint = "deemphasize";
					}
				}
				stackFrames.push(stackFrame);

				// Resolve the line and column information.
				const promise = thread.getScript(location.script).then((script: VMScript) => {
					const fileLocation = this.resolveFileLocation(script, location.tokenPos);
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

	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
		if (!this.vmService) {
			this.errorResponse(response, `No VM service connection`);
			return;
		}

		const variablesReference = args.variablesReference;

		// implement paged arrays
		// let filter = args.filter; // optional; either "indexed" or "named"
		const start = args.start || 0; // (optional) index of the first variable to return; if omitted children start at 0
		const count = args.count; // (optional) number of variables to return. If count is missing or 0, all variables are returned

		const data = this.threadManager.getStoredData(variablesReference);
		const thread = data.thread;

		if (data.data.type === "Frame") {
			const frame: VMFrame = data.data as VMFrame;
			let variables: DebugProtocol.Variable[] = [];
			if (frame.vars) {
				const framePromises = frame.vars
					.filter((variable) => !variable.value || variable.value.type !== "@TypeArguments")
					.map((variable, i) => this.instanceRefToVariable(thread, true, variable.name, variable.name, variable.value, i <= maxValuesToCallToString));
				const frameVariables = await Promise.all(framePromises);
				variables = variables.concat(frameVariables);
			}
			response.body = { variables };
			this.sendResponse(response);
		} else if (data.data.type === "MapEntry") {
			const mapRef = data.data as VMMapEntry;

			const keyResult = this.vmService.getObject(thread.ref.id, mapRef.keyId);
			const valueResult = this.vmService.getObject(thread.ref.id, mapRef.valueId);

			const variables: DebugProtocol.Variable[] = [];
			let canEvaluateValueName = false;
			let valueEvaluateName = "value";

			try {
				const keyDebuggerResult = await keyResult;
				const keyInstanceRef = keyDebuggerResult.result as VMInstanceRef;

				variables.push(await this.instanceRefToVariable(thread, false, "key", "key", keyInstanceRef, true));

				if (this.isSimpleKind(keyInstanceRef.kind) && mapRef.mapEvaluateName) {
					canEvaluateValueName = true;
					valueEvaluateName = `${mapRef.mapEvaluateName}[${this.valueAsString(keyInstanceRef)}]`;
				}
			} catch (error) {
				variables.push({ name: "key", value: this.errorAsDisplayValue(error), variablesReference: 0 });
			}

			try {
				const valueDebuggerResult = await valueResult;
				const valueInstanceRef = valueDebuggerResult.result as VMInstanceRef;
				variables.push(await this.instanceRefToVariable(thread, canEvaluateValueName, valueEvaluateName, "value", valueInstanceRef, true));
			} catch (error) {
				variables.push({ name: "value", value: this.errorAsDisplayValue(error), variablesReference: 0 });
			}

			response.body = { variables };
			this.sendResponse(response);
		} else if (data.data.type === InspectedVariable.type) {
			const variable = data.data as InspectedVariable;
			response.body = {
				variables: [
					{ name: "insp", value: "<inspected variable>", variablesReference: variable.variablesReference },
				],
			};
			this.sendResponse(response);
		} else {
			const instanceRef = data.data as InstanceWithEvaluateName;

			try {
				const result = await this.vmService.getObject(thread.ref.id, instanceRef.id, start, count);
				let variables: DebugProtocol.Variable[] = [];
				// If we're the top-level exception, or our parent has an evaluateName of undefined (its children)
				// we cannot evaluate (this will disable "Add to Watch" etc).
				const canEvaluate = instanceRef.evaluateName !== undefined;

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
						if (this.isSimpleKind(instance.kind)) {
							variables.push(await this.instanceRefToVariable(thread, canEvaluate, `${instanceRef.evaluateName}`, instance.kind, instanceRef, true));
						} else if (instance.elements) {
							const len = instance.elements.length;
							const elementPromises = instance.elements.map(async (element, i) => this.instanceRefToVariable(thread, canEvaluate, `${instanceRef.evaluateName}[${i + start}]`, `[${i + start}]`, element, len <= maxValuesToCallToString));
							// Add them in order.
							const elementVariables = await Promise.all(elementPromises);
							variables = variables.concat(elementVariables);
						} else if (instance.associations) {
							const len = instance.associations.length;
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

							let fieldAndGetterPromises: Array<Promise<DebugProtocol.Variable>> = [];

							const fields = sortBy(instance.fields, (f) => f.decl.name);
							const fieldPromises = fields.map(async (field, i) => this.instanceRefToVariable(thread, canEvaluate, `${instanceRef.evaluateName}.${field.decl.name}`, field.decl.name, field.value, i <= maxValuesToCallToString));
							fieldAndGetterPromises = fieldAndGetterPromises.concat(fieldPromises);

							// Add getters
							if (this.evaluateGettersInDebugViews && instance.class) {
								let getterNames = await this.getGetterNamesForHierarchy(thread.ref, instance.class);
								getterNames = getterNames.sort();

								// Call each getter, adding the result as a variable.
								const getterPromises = getterNames.map(async (getterName, i) => {
									try {
										const getterResult = await this.vmService!.evaluate(thread.ref.id, instanceRef.id, getterName, true);
										if (getterResult.result.type === "@Error") {
											return { name: getterName, value: (getterResult.result as VMErrorRef).message, variablesReference: 0 };
										} else if (getterResult.result.type === "Sentinel") {
											return { name: getterName, value: (getterResult.result as VMSentinel).valueAsString, variablesReference: 0 };
										} else {
											const getterResultInstanceRef = getterResult.result as VMInstanceRef;
											return this.instanceRefToVariable(
												thread, canEvaluate,
												`${instanceRef.evaluateName}.${getterName}`,
												getterName,
												getterResultInstanceRef,
												instance.fields!.length + i <= maxValuesToCallToString,
											);
										}
									} catch (e) {
										return { name: getterName, value: this.errorAsDisplayValue(e), variablesReference: 0 };
									}
								});
								fieldAndGetterPromises = fieldAndGetterPromises.concat(getterPromises);

								const fieldAndGetterVariables = await Promise.all(fieldAndGetterPromises);
								variables = variables.concat(fieldAndGetterVariables);
							}

							await Promise.all(fieldAndGetterPromises);
						} else {
							this.logToUser(`Unknown instance kind: ${instance.kind}. ${pleaseReportBug}\n`);
						}
					} else {
						this.logToUser(`Unknown object type: ${obj.type}. ${pleaseReportBug}\n`);
					}
				}

				response.body = { variables };
				this.sendResponse(response);
			} catch (error) {
				response.body = {
					variables: [
						{ name: "<error>", value: this.errorAsDisplayValue(error), variablesReference: 0 },
					],
				};
				this.sendResponse(response);
			}
		}
	}

	private errorAsDisplayValue(error: any) {
		if (!error)
			return `<unknown error>`;
		const message = `${error.message || error}`;
		if (!message)
			return `<unknown error>`;
		return `<${message.split("\n")[0].trim()}>`;
	}

	private async getGetterNamesForHierarchy(thread: VMIsolateRef, classRef: VMClassRef | undefined): Promise<string[]> {
		let getterNames: string[] = [];
		while (this.vmService && classRef) {
			const classResponse = await this.vmService.getObject(thread.id, classRef.id);
			if (classResponse.result.type !== "Class")
				break;

			const c = classResponse.result as VMClass;

			// TODO: This kinda smells for two reasons:
			// 1. This is supposed to be an @Function but it has loads of extra stuff on it compare to the docs
			// 2. We're accessing _kind to check if it's a getter :/
			getterNames = getterNames.concat(getterNames, c.functions.filter((f) => f._kind === "GetterFunction" && !f.static && !f.const).map((f) => f.name));
			classRef = c.super;
		}

		// Distinct the list; since we may have got dupes from the super-classes.
		getterNames = uniq(getterNames);

		// Remove _identityHashCode because it seems to throw (and probably isn't useful to the user).
		return getterNames.filter((g) => g !== "_identityHashCode");
	}

	private isSimpleKind(kind: string) {
		return kind === "String" || kind === "Bool" || kind === "Int" || kind === "Num" || kind === "Double" || kind === "Null" || kind === "Closure";
	}

	private async callToString(isolate: VMIsolateRef, instanceRef: VMInstanceRef, getFullString: boolean = false): Promise<string | undefined> {
		if (!this.vmService)
			return;

		try {
			const result = this.vmServiceCapabilities.hasInvoke
				? await this.vmService.invoke(isolate.id, instanceRef.id, "toString", [], true)
				: await this.vmService.evaluate(isolate.id, instanceRef.id, "toString()", true);
			if (result.result.type === "@Error") {
				return undefined;
			} else {
				let evalResult: VMInstanceRef = result.result as VMInstanceRef;

				if (evalResult.valueAsStringIsTruncated && getFullString) {
					const result = await this.vmService!.getObject(isolate.id, evalResult.id);
					evalResult = result.result as VMInstanceRef;
				}

				return this.valueAsString(evalResult, undefined, true);
			}
		} catch (e) {
			this.logger.error(e);
			return undefined;
		}
	}

	protected setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): void {
		// const variablesReference: number = args.variablesReference;
		// const name: string = args.name;
		// const value: string = args.value;

		// TODO: Use eval to implement this.
		this.errorResponse(response, "not supported");
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		const thread = this.threadManager.getThreadInfoFromNumber(args.threadId);
		if (!thread) {
			this.errorResponse(response, `No thread with id ${args.threadId}`);
			return;
		}
		thread.resume().then((_) => {
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
		thread.resume(type).then((_) => {
			this.sendResponse(response);
		}).catch((error) => this.errorResponse(response, `${error}`));
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
		const thread = this.threadManager.getThreadInfoFromNumber(args.threadId);
		if (!thread) {
			this.errorResponse(response, `No thread with id ${args.threadId}`);
			return;
		}
		thread.resume("Into").then((_) => {
			this.sendResponse(response);
		}).catch((error) => this.errorResponse(response, `${error}`));
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
		const thread = this.threadManager.getThreadInfoFromNumber(args.threadId);
		if (!thread) {
			this.errorResponse(response, `No thread with id ${args.threadId}`);
			return;
		}
		thread.resume("Out").then((_) => {
			this.sendResponse(response);
		}).catch((error) => this.errorResponse(response, `${error}`));
	}

	protected restartFrameRequest(response: DebugProtocol.RestartFrameResponse, args: DebugProtocol.RestartFrameArguments): void {
		const frameId = args.frameId;
		// const context: string = args.context; // "watch", "repl", "hover"

		if (!frameId) {
			this.errorResponse(response, "unable to restart with no frame");
			return;
		}

		const data = this.threadManager.getStoredData(frameId);
		const thread = data.thread;
		const frame: VMFrame = data.data as VMFrame;

		thread.resume("Rewind", frame.index).then((_) => {
			this.sendResponse(response);
		}).catch((error) => this.errorResponse(response, `${error}`));
	}

	protected reverseContinueRequest(response: DebugProtocol.ReverseContinueResponse, args: DebugProtocol.ReverseContinueArguments): void {
		this.logToUser("Reverse continue is not supported\n");
		this.errorResponse(response, `Reverse continue is not supported for the Dart debugger`);
	}

	protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): Promise<void> {
		const isClipboardContext = args.context === "clipboard";
		const isWatchContext = args.context === "watch";
		const expression: string = args.expression.replace(trailingSemicolonPattern, "");
		// Stack frame scope; if not specified, the expression is evaluated in the global scope.
		const frameId = args.frameId;
		// const context: string = args.context; // "watch", "repl", "hover"

		const data = frameId ? this.threadManager.getStoredData(frameId) : undefined;
		const thread = data ? data.thread : this.threadManager.threads[0];

		try {
			let result: DebuggerResult | undefined;
			if (!data) {
				if (!this.vmService || !thread) {
					this.errorResponse(response, "global evaluation requires a thread to have been loaded");
					return;
				}

				const isolate = (await this.vmService.getIsolate(thread.ref.id)).result as VMIsolate;
				const rootLib = isolate.rootLib;

				if (!rootLib) {
					this.errorResponse(response, "global evaluation requires a rootLib on the initial thread");
					return;
				}

				// Don't wait more than a second for the response:
				//   1. VS Code's watch window behaves badly when there are incomplete evaluate requests
				//      https://github.com/Microsoft/vscode/issues/52317
				//   2. The VM sometimes doesn't respond to your requests at all
				//      https://github.com/flutter/flutter/issues/18595
				result = await Promise.race([
					this.vmService!.evaluate(thread.ref.id, rootLib.id, expression, true),
					new Promise<never>((resolve, reject) => setTimeout(() => reject(new Error("<timed out>")), 1000)),
				]);
			} else {
				const frame = data.data as VMFrame;
				if ((expression === "$e" || expression.startsWith("$e.")) && thread.exceptionReference) {
					const exceptionData = this.threadManager.getStoredData(thread.exceptionReference);
					const exceptionInstanceRef = exceptionData && exceptionData.data as VMInstanceRef;

					if (expression === "$e") {
						response.body = {
							result: await this.fullValueAsString(thread.ref, exceptionInstanceRef) || "<unknown>",
							variablesReference: thread.exceptionReference,
						};
						this.sendResponse(response);
						return;
					}

					const exceptionId = exceptionInstanceRef && exceptionInstanceRef.id;

					if (exceptionId)
						result = await this.vmService!.evaluate(thread.ref.id, exceptionId, expression.substr(3), true);
				}
				if (!result) {
					// Don't wait more than a second for the response:
					//   1. VS Code's watch window behaves badly when there are incomplete evaluate requests
					//      https://github.com/Microsoft/vscode/issues/52317
					//   2. The VM sometimes doesn't respond to your requests at all
					//      https://github.com/flutter/flutter/issues/18595
					result = await Promise.race([
						this.vmService!.evaluateInFrame(thread.ref.id, frame.index, expression, true),
						new Promise<never>((resolve, reject) => setTimeout(() => reject(new Error("<timed out>")), 1000)),
					]);
				}
			}

			if (!result) {
				this.errorResponse(response, "No evaluation result");
			} else if (result.result.type === "@Error") {
				// InstanceRef or ErrorRef
				const error: VMErrorRef = result.result as VMErrorRef;
				let str: string = error.message;
				if (str)
					str = str.split("\n").slice(0, 6).join("\n");
				this.errorResponse(response, str);
			} else {
				const instanceRef: InstanceWithEvaluateName = result.result as InstanceWithEvaluateName;
				instanceRef.evaluateName = expression;
				const text = await this.fullValueAsString(thread.ref, instanceRef, isClipboardContext);
				response.body = {
					result: text || "<unknown>",
					variablesReference: this.isSimpleKind(instanceRef.kind) ? 0 : thread.storeData(instanceRef),
				};
				this.sendResponse(response);
			}
		} catch (e) {
			if (e && e.message && e.message.indexOf("UnimplementedError") !== -1)
				this.errorResponse(response, `<not yet implemented>`);
			else if (isWatchContext && e && e.message && e.message.indexOf("Expression compilation error") !== -1)
				this.errorResponse(response, `not available`);
			else if (isWatchContext && e && e.message && e.message.indexOf("noSuchMethodException") !== -1)
				this.errorResponse(response, `not available`);
			else if (e && e.data && e.data.details)
				this.errorResponse(response, `${e.data.details}`);
			else if (e && e.message)
				this.errorResponse(response, `${e.message}`);
			else
				this.errorResponse(response, `${e}`);
		}
	}

	private urlExposeCompleters: { [key: string]: PromiseCompleter<{ url: string }> } = {};
	protected async exposeUrl(url: string): Promise<{ url: string }> {
		if (this.urlExposeCompleters[url])
			return this.urlExposeCompleters[url].promise;

		const completer = new PromiseCompleter<{ url: string }>();
		this.urlExposeCompleters[url] = completer;

		this.sendEvent(new Event("dart.exposeUrl", { url }));

		return completer.promise;
	}

	protected startProgress(progressID: string, message: string | undefined) {
		message = message || "Working";
		message = message.endsWith("…") || message.endsWith("...") ? message : `${message}…`;
		// TODO: It's not clear if passing an empty string for title is reasonable, but it works better in VS Code.
		// See https://github.com/microsoft/language-server-protocol/issues/1025.

		// TODO: Revert these changes if VS Code removes the delay.
		// https://github.com/microsoft/vscode/issues/101405
		// this.sendEvent(new ProgressStartEvent(progressID, "", e.message));
		this.sendEvent(new Event("dart.progressStart", { progressID, message }));
	}

	protected updateProgress(progressID: string, message: string | undefined) {
		if (!message)
			return;
		message = message.endsWith("…") || message.endsWith("...") ? message : `${message}…`;
		// TODO: Revert these changes if VS Code removes the delay.
		// https://github.com/microsoft/vscode/issues/101405
		// this.sendEvent(new ProgressUpdateEvent(progressID, message));
		this.sendEvent(new Event("dart.progressUpdate", { progressID, message }));
	}

	protected endProgress(progressID: string, message?: string | undefined) {
		// TODO: Revert these changes if VS Code removes the delay.
		// https://github.com/microsoft/vscode/issues/101405
		// this.sendEvent(new ProgressEndEvent(progressID, e.message));
		this.sendEvent(new Event("dart.progressEnd", { progressID, message }));
	}

	protected async customRequest(request: string, response: DebugProtocol.Response, args: any): Promise<void> {
		try {
			switch (request) {
				case "service":
					await this.callService(args.type, args.params);
					this.sendResponse(response);
					break;
				case "exposeUrlResponse":
					const completer = this.urlExposeCompleters[args.originalUrl];
					if (completer)
						completer.resolve({ url: args.exposedUrl });
					break;
				case "updateDebugOptions":
					this.debugExternalLibraries = !!args.debugExternalLibraries;
					this.debugSdkLibraries = !!args.debugSdkLibraries;
					await this.threadManager.setLibrariesDuggableForAllIsolates();
					this.sendResponse(response);
					break;
				// Flutter requests that may be sent during test runs or other places
				// that we don't currently support. TODO: Fix this by moving all the
				// service extension stuff out of Flutter to here, and making it not
				// Flutter-specific. This requires sending all service extensions
				// directly to the VM and not via Flutter's run daemon.
				case "serviceExtension":
				case "checkPlatformOverride":
				case "checkIsWidgetCreationTracked":
				case "hotReload":
				case "hotRestart":
					// TODO: Get rid of this!
					this.log(`Ignoring Flutter customRequest ${request} for non-Flutter-run app`, LogSeverity.Warn);
					this.sendResponse(response);
					break;
				default:
					this.log(`Unknown customRequest ${request}`, LogSeverity.Warn);
					super.customRequest(request, response, args);
					break;
			}
		} catch (e) {
			this.logger.error(`Error handling '${request}' custom request: ${e}`);
			this.errorResponse(response, e && e.message);
		}
	}

	// IsolateStart, IsolateRunnable, IsolateExit, IsolateUpdate, ServiceExtensionAdded
	public async handleIsolateEvent(event: VMEvent): Promise<void> {
		const kind = event.kind;
		if (kind === "IsolateStart" || kind === "IsolateRunnable") {
			await this.threadManager.registerThread(event.isolate!, kind);
		} else if (kind === "IsolateExit") {
			this.threadManager.handleIsolateExit(event.isolate!);
		} else if (kind === "ServiceExtensionAdded") {
			this.handleServiceExtensionAdded(event);
		}
	}

	// Extension
	public handleExtensionEvent(event: VMEvent) {
		// Nothing Dart-specific, but Flutter overrides this
	}

	// Service
	public handleServiceEvent(event: VMEvent) {
		const kind = event.kind;
		if (kind === "ServiceRegistered")
			this.handleServiceRegistered(event);
	}

	// Logging
	private lastLoggingEvent = Promise.resolve();
	public async handleLoggingEvent(event: VMEvent): Promise<void> {
		// Logging may involve async operations (for ex. fetching exception text
		// and call stacks) so we must ensure each log is not processed until
		// the previous one has been processed.
		this.lastLoggingEvent = this.lastLoggingEvent.then(() => this.processLoggingEvent(event));
	}

	// Logging
	public async processLoggingEvent(event: VMEvent): Promise<void> {
		const kind = event.kind;
		if (kind === "Logging" && event.logRecord) {
			const record = event.logRecord;

			if (record) {
				const name = record.loggerName ? this.valueAsString(record.loggerName, false, true) : undefined;
				const logPrefix = `[${name || "log"}] `;
				let indent = " ".repeat(logPrefix.length);

				if (record.message) {
					const message = (record.message.valueAsString || "<empty message>")
						+ (record.message.valueAsStringIsTruncated ? "…" : "");
					const indentedMessage = `${grey(logPrefix)}${message.split("\n").join(`\n${indent}`)}`;
					this.logToUser(`${indentedMessage.trimRight()}\n`);
				}
				indent += "  ";
				if (record.error && record.error.kind !== "Null") {
					const message = await this.fullValueAsString(event.isolate, record.error);
					if (message) {
						const indentedMessage = `${indent}${message.split("\n").join(`\n${indent}`)}`;
						this.logToUser(`${indentedMessage.trimRight()}\n`, "stderr");
					}
				}
				if (record.stackTrace && record.stackTrace.kind !== "Null") {
					const message = await this.fullValueAsString(event.isolate, record.stackTrace);
					if (message) {
						const indentedMessage = `${indent}${message.split("\n").join(`\n${indent}`)}`;
						this.logToUser(`${indentedMessage.trimRight()}\n`, "stderr");
					}
				}
			}
		}
	}

	// PauseStart, PauseExit, PauseBreakpoint, PauseInterrupted, PauseException, Resume,
	// BreakpointAdded, BreakpointResolved, BreakpointRemoved, Inspect, None
	public async handleDebugEvent(event: VMEvent): Promise<void> {
		try {
			const kind = event.kind;

			if (kind.startsWith("Pause")) {
				await this.handlePauseEvent(event);
			} else if (kind === "Inspect") {
				await this.handleInspectEvent(event);
			}
		} catch (e) {
			this.logger.error(e);
		}
	}

	private async handlePauseEvent(event: VMEvent) {
		if (!event.isolate) {
			this.logger.warn(`Unable to handle pause event (${event.kind}) that had no isolate`);
			return;
		}

		const kind = event.kind;
		const thread = this.threadManager.getThreadInfoFromRef(event.isolate);

		if (!thread) {
			this.logger.warn(`ThreadManager couldn't find thread with ref ${event.isolate.id} to handle ${kind}`);
			return;
		}

		if (!this.vmService) {
			this.logger.warn("No VM service connection");
			return;
		}

		// For PausePostRequest we need to re-send all breakpoints; this happens after a flutter restart
		if (kind === "PausePostRequest") {
			try {
				await this.threadManager.resetBreakpoints();
			} catch (e) {
				this.logger.error(e);
			}
			try {
				await this.vmService.resume(event.isolate.id);
			} catch (e) {
				// Ignore failed-to-resume errors https://github.com/flutter/flutter/issues/10934
				if (e.code !== 106)
					throw e;
			}
		} else if (kind === "PauseStart") {
			// "PauseStart" should auto-resume after breakpoints are set if we launched the process.
			if (this.childProcess)
				thread.receivedPauseStart();
			else {
				// Otherwise, if we were attaching, then just issue a step-into to put the debugger
				// right at the start of the application.
				thread.handlePaused(event.atAsyncSuspension, event.exception);
				await thread.resume("Into");
			}
		} else {
			// PauseStart, PauseExit, PauseBreakpoint, PauseInterrupted, PauseException
			let reason = "pause";
			let exceptionText;
			let shouldRemainedStoppedOnBreakpoint = true;

			if (kind === "PauseBreakpoint" && event.pauseBreakpoints && event.pauseBreakpoints.length) {
				reason = "breakpoint";

				const potentialBreakpoints: Array<DebugProtocol.SourceBreakpoint | undefined> = event.pauseBreakpoints.map((bp) => thread.breakpoints[bp.id]);
				// When attaching to an already-stopped process, this event can be handled before the
				// breakpoints have been registered. If that happens, replace any unknown breakpoints with
				// dummy unconditional breakpoints.
				// TODO: Ensure that VM breakpoint state is reconciled with debugger breakpoint state before
				// handling thread state so that this doesn't happen, and remove this check.
				const hasUnknownBreakpoints = potentialBreakpoints.indexOf(undefined) !== -1;

				if (!hasUnknownBreakpoints) {
					// There can't be any undefined here because of the above, but the types don't know that
					// so strip the undefineds.
					const breakpoints = potentialBreakpoints.filter(notUndefined);

					const hasUnconditionalBreakpoints = !!breakpoints.find((bp) => !bp.condition && !bp.logMessage);
					const conditionalBreakpoints = breakpoints.filter((bp) => bp.condition) as Array<DebugProtocol.SourceBreakpoint & { condition: string }>;
					const logPoints = breakpoints.filter((bp) => bp.logMessage);

					// Evalute conditions to see if we should remain stopped or continue.
					shouldRemainedStoppedOnBreakpoint =
						hasUnconditionalBreakpoints
						|| await this.anyBreakpointConditionReturnsTrue(conditionalBreakpoints, thread);

					// Output any logpoint messages.
					for (const logPoint of logPoints) {
						if (!logPoint.logMessage)
							continue;

						const logMessage = logPoint.logMessage
							.replace(/(^|[^\\\$]){/g, "$1\${") // Prefix any {tokens} with $ if they don't have
							.replace(/\\({)/g, "$1") // Remove slashes
							.replace(/"""/g, '\\"\\"\\"'); // Escape triple-quotes
						const printCommand = `print("""${logMessage}""")`;
						await this.evaluateAndSendErrors(thread, printCommand);
					}
				}
			} else if (kind === "PauseBreakpoint") {
				reason = "step";
			} else if (kind === "PauseException") {
				reason = "exception";
				exceptionText =
					event.exception
						? await this.fullValueAsString(event.isolate, event.exception)
						: undefined;
			}

			thread.handlePaused(event.atAsyncSuspension, event.exception);
			if (shouldRemainedStoppedOnBreakpoint) {
				this.sendEvent(new StoppedEvent(reason, thread.num, exceptionText));
			} else {
				await thread.resume();
			}
		}
	}

	protected async handleInspectEvent(event: VMEvent): Promise<void> {
		const isolateRef = event.isolate;
		const instanceRef = (event as any).inspectee as VMInstanceRef;
		const thread = isolateRef ? this.threadManager.getThreadInfoFromRef(isolateRef) : undefined;
		if (isolateRef && instanceRef && thread) {
			const text = await this.fullValueAsString(isolateRef, instanceRef, false);

			this.sendVariable(thread.storeData(new InspectedVariable(thread.storeData(instanceRef))));
		}
	}

	private sendVariable(variablesReference: number) {
		const evt = new OutputEvent("");
		(evt.body as any).variablesReference = variablesReference;
		this.sendEvent(evt);
	}

	// Like valueAsString, but will call toString() if the thing is truncated.
	private async fullValueAsString(isolate: VMIsolateRef | undefined, instanceRef: VMInstanceRef, suppressQuotesAroundStrings = false): Promise<string | undefined> {
		let text: string | undefined;
		if (!instanceRef.valueAsStringIsTruncated)
			text = this.valueAsString(instanceRef, false, suppressQuotesAroundStrings);
		if (!text && isolate)
			text = await this.callToString(isolate, instanceRef, true);
		// If it has a custom toString(), put that in parens after the type name.
		if (instanceRef.kind === "PlainInstance" && instanceRef.class && instanceRef.class.name) {
			if (text === `Instance of '${instanceRef.class.name}'` || text === instanceRef.class.name || !text)
				text = instanceRef.class.name;
			else
				text = `${instanceRef.class.name} (${text})`;
		}
		return text;
	}

	private async anyBreakpointConditionReturnsTrue(breakpoints: Array<DebugProtocol.SourceBreakpoint & { condition: string }>, thread: ThreadInfo) {
		for (const bp of breakpoints) {
			const evalResult = await this.evaluateAndSendErrors(thread, bp.condition);
			if (evalResult) {
				// To be considered true, we need to have a value and either be not-a-bool
				const breakpointconditionEvaluatesToTrue =
					(evalResult.kind === "Bool" && evalResult.valueAsString === "true")
					|| (evalResult.kind === "Int" && evalResult.valueAsString !== "0")
					|| (evalResult.kind === "Double" && evalResult.valueAsString !== "0");
				if (breakpointconditionEvaluatesToTrue)
					return true;

			}
		}
		return false;
	}

	private callService(type: string, args: any): Promise<any> {
		if (!this.vmService)
			throw new Error("VM service connection is not available");
		return this.vmService.callMethod(type, args);
	}

	private async evaluateAndSendErrors(thread: ThreadInfo, expression: string): Promise<VMInstanceRef | undefined> {
		if (!this.vmService)
			return;
		try {
			const result = await this.vmService.evaluateInFrame(thread.ref.id, 0, expression, true);
			if (result.result.type !== "@Error") {
				return result.result as VMInstanceRef;
			} else {
				this.logToUser(`Debugger failed to evaluate expression \`${expression}\`\n`);
			}
		} catch {
			this.logToUser(`Debugger failed to evaluate expression \`${expression}\`\n`);
		}
	}

	public handleServiceExtensionAdded(event: VMEvent) {
		if (event && event.extensionRPC) {
			this.notifyServiceExtensionAvailable(event.extensionRPC, event.isolate ? event.isolate.id : undefined);
		}
	}

	public handleServiceRegistered(event: VMEvent) {
		if (event && event.service) {
			this.notifyServiceRegistered(event.service, event.method);
		}
	}

	private notifyServiceExtensionAvailable(id: string, isolateId: string | undefined) {
		this.sendEvent(new Event("dart.serviceExtensionAdded", { id, isolateId }));
	}

	private notifyServiceRegistered(service: string, method: string | undefined) {
		this.sendEvent(new Event("dart.serviceRegistered", { service, method }));
	}

	public errorResponse(response: DebugProtocol.Response, message: string) {
		response.success = false;
		response.message = message;
		this.sendResponse(response);
	}

	private formatUriForShortDisplay(uri: string): string {
		if (uri.startsWith("file:")) {
			uri = uriToFilePath(uri);
			if (this.cwd)
				uri = path.relative(this.cwd, uri);
		}

		// Split on the separators and return only the first and last two parts.
		const sep = uri.indexOf("/") === -1 && uri.indexOf("\\") !== -1 ? "\\" : "/";
		const parts = uri.split(sep);
		if (parts.length > 3) {
			return [parts[0], "…", parts[parts.length - 2], parts[parts.length - 1]].join(sep);
		} else {
			return uri;
		}
	}

	protected convertVMUriToSourcePath(uri: string, returnWindowsPath?: boolean): string | undefined {
		if (uri.startsWith("file:"))
			return uriToFilePath(uri, returnWindowsPath);

		if (uri.startsWith("package:") && this.packageMap)
			return this.packageMap.resolvePackageUri(uri);

		return uri;
	}

	private valueAsString(ref: VMInstanceRef | VMSentinel, useClassNameAsFallback = true, suppressQuotesAroundStrings = false): string | undefined {
		if (ref.type === "Sentinel")
			return ref.valueAsString;

		const instanceRef = ref as VMInstanceRef;

		if (ref.kind === "String" || ref.valueAsString) {
			let str: string | undefined = instanceRef.valueAsString;
			if (instanceRef.valueAsStringIsTruncated)
				str += "…";
			if (instanceRef.kind === "String" && !suppressQuotesAroundStrings)
				str = `"${str}"`;
			return str;
		} else if (ref.kind === "List") {
			return `List (${instanceRef.length} ${instanceRef.length === 1 ? "item" : "items"})`;
		} else if (ref.kind === "Map") {
			return `Map (${instanceRef.length} ${instanceRef.length === 1 ? "item" : "items"})`;
		} else if (ref.kind === "Type") {
			const typeRef = ref as VMTypeRef;
			return `Type (${typeRef.name})`;
		} else if (useClassNameAsFallback) {
			return this.getFriendlyTypeName(instanceRef);
		} else {
			return undefined;
		}
	}

	private getFriendlyTypeName(ref: VMInstanceRef): string {
		return ref.kind !== "PlainInstance" ? ref.kind : ref.class.name;
	}

	private async instanceRefToVariable(
		thread: ThreadInfo, canEvaluate: boolean, evaluateName: string, name: string, ref: VMInstanceRef | VMSentinel, allowFetchFullString: boolean,
	): Promise<DebugProtocol.Variable> {
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

			const str = this.evaluateToStringInDebugViews && allowFetchFullString && !val.valueAsString
				? await this.fullValueAsString(thread.ref, val)
				: this.valueAsString(val);

			return {
				evaluateName: canEvaluate ? evaluateName : undefined,
				indexedVariables: (val && val.kind && val.kind.endsWith("List") ? val.length : undefined),
				name,
				type: `${val.kind} (${val.class.name})`,
				value: str || "",
				variablesReference: val.valueAsString ? 0 : thread.storeData(val),
			};
		}
	}

	public isValidToDebug(uri: string) {
		return this.supportsDebugInternalLibraries || !uri.startsWith("dart:_");
	}

	public isSdkLibrary(uri: string) {
		return uri.startsWith("dart:");
	}

	public isExternalLibrary(uri: string) {
		// If it's not a package URI, or we don't have a package map, so we assume not external. We don't want
		// to ever disable debugging of something if we're not certain.
		if (!uri.startsWith("package:") || !this.packageMap)
			return false;

		// package:flutter won't be in pub-cache, but should be considered external.
		if (uri.startsWith("package:flutter/") || uri.startsWith("package:flutter_test/"))
			return true;

		const path = this.packageMap.resolvePackageUri(uri);

		// If we don't have the path, we can't tell if it's external or not.
		if (!path)
			return false;

		// HACK: Take a guess at whether it's inside the pubcache (in which case we're considering it external).
		return path.indexOf("/hosted/pub.dartlang.org/") !== -1 || path.indexOf("\\hosted\\pub.dartlang.org\\") !== -1;
	}

	private resolveFileLocation(script: VMScript, tokenPos: number): FileLocation | undefined {
		const table: number[][] = script.tokenPosTable;
		for (const entry of table) {
			// [lineNumber, (tokenPos, columnNumber)*]
			for (let index = 1; index < entry.length; index += 2) {
				if (entry[index] === tokenPos) {
					const line = entry[0];
					return { line, column: entry[index + 1] };
				}
			}
		}

		return undefined;
	}

	private async pollForMemoryUsage(): Promise<void> {
		if (!this.childProcess || this.childProcess.killed || !this.vmService)
			return;

		const result = await this.vmService.getVM();
		const vm = result.result as VM;

		const isolatePromises = vm.isolates.map((isolateRef) => this.vmService!.getIsolate(isolateRef.id));
		const isolatesResponses = await Promise.all(isolatePromises);
		const isolates = isolatesResponses.map((response) => response.result as VMIsolate);

		let current = 0;
		let total = 0;

		for (const isolate of isolates) {
			if (!isolate._heaps)
				continue;
			for (const heap of [isolate._heaps.old, isolate._heaps.new]) {
				current += heap.used + heap.external;
				total += heap.capacity + heap.external;
			}
		}

		this.sendEvent(new Event("dart.debugMetrics", { memory: { current, total } }));

		if (this.pollforMemoryMs)
			setTimeout(() => this.pollForMemoryUsage(), this.pollforMemoryMs).unref();
	}

	private getStackFrameData(message: string): MessageWithUriData | undefined {
		const match = message && stackFrameWithUriPattern.exec(message);
		if (match) {
			// TODO: Handle dart: uris (using source references)?
			return {
				col: parseInt(match[4], 10),
				line: parseInt(match[3], 10),
				prefix: match[1],
				sourceUri: match[2],
			};
		}
		return undefined;
	}

	private getWebStackFrameData(message: string): MessageWithUriData | undefined {
		const match = message && webStackFrameWithUriPattern.exec(message);
		if (match) {
			// TODO: Handle dart: uris (using source references)?
			return {
				col: parseInt(match[3], 10),
				line: parseInt(match[2], 10),
				prefix: match[4],
				sourceUri: match[1],
			};
		}
		return undefined;
	}

	private getMessageWithUriData(message: string): MessageWithUriData | undefined {
		const match = message && messageWithUriPattern.exec(message);
		if (match) {
			return {
				col: parseInt(match[4], 10),
				line: parseInt(match[3], 10),
				prefix: match[1],
				sourceUri: match[2],
			};
		}
		return undefined;
	}

	/// Buffers text and sends to the user when a newline is recieved. This is to handle stderr/stdout which
	/// might arrive in chunks but we need to process in lines.
	///    [5:01:50 PM] [General] [Info] [stderr] tion: Oop
	///    [5:01:50 PM] [General] [Info] [stderr] s
	///    [5:01:50 PM] [General] [Info] [stderr]
	///    [5:01:50 PM] [General] [Info] [stderr] #
	///    [5:01:50 PM] [General] [Info] [stderr] 0
	///    [5:01:50 PM] [General] [Info] [stderr]
	///    [5:01:50 PM] [General] [Info] [stderr]
	///    [5:01:50 PM] [General] [Info] [stderr]     main (file:///D:/a/
	///    [5:01:50 PM] [General] [Info] [stderr] Dart-Code/Dart-Code/src/test/test_projects/hello_world/bin/broken.dart:2:3)
	protected logToUserBuffered(message: string, category: string) {
		this.logBuffer[category] = this.logBuffer[category] || "";
		this.logBuffer[category] += message;

		const lastNewLine = this.logBuffer[category].lastIndexOf("\n");
		if (lastNewLine !== -1) {
			const processString = this.logBuffer[category].substr(0, lastNewLine + 1);
			this.logBuffer[category] = this.logBuffer[category].substr(lastNewLine + 1);
			this.logToUser(processString, category);
		}
	}
	private logBuffer: { [key: string]: string } = {};

	// Logs a message back to the editor. Does not add its own newlines, you must
	// provide them!
	protected logToUser(message: string, category?: string, colorText = (s: string) => s) {
		// Extract stack frames from the message so we can do nicer formatting of them.
		const frame = this.getStackFrameData(message) || this.getWebStackFrameData(message) || this.getMessageWithUriData(message);

		// If we get a multi-line message that contains an error/stack trace, process each
		// line individually, so we can attach location metadata to individual lines.
		const isMultiLine = message.trimRight().indexOf("\n") !== -1;
		if (frame && isMultiLine) {
			message.split("\n").forEach((line) => this.logToUser(`${line}\n`, category));
			return;
		}

		const output = new OutputEvent(`${applyColor(message, colorText)}`, category) as OutputEvent & DebugProtocol.OutputEvent;

		// If the output line looks like a stack frame with users code, attempt to link it up to make
		// it clickable.
		if (frame) {
			const sourcePath: string | undefined = this.convertVMUriToSourcePath(frame.sourceUri);
			const canShowSource = sourcePath && sourcePath !== frame.sourceUri && fs.existsSync(sourcePath);
			const shortName = this.formatUriForShortDisplay(frame.sourceUri);
			const source = canShowSource ? new Source(shortName, sourcePath, undefined, undefined, undefined) : undefined;

			let text = `${frame.prefix} (${frame.sourceUri}:${frame.line}:${frame.col})`;
			if (source) {
				output.body.source = source;
				output.body.line = frame.line;
				output.body.column = frame.col;
				// Replace the output to only the text part to avoid the duplicated uri.
				text = frame.prefix;
			}

			// Colour based on whether it's framework code or not.
			const isFramework = this.isSdkLibrary(frame.sourceUri)
				|| (this.isExternalLibrary(frame.sourceUri) && (frame.sourceUri.startsWith("package:flutter/") || frame.sourceUri.startsWith("package:flutter_test/")));

			const colouredText = isFramework ? applyColor(text, grey) : applyColor(text, grey2);
			output.body.output = `${colouredText}\n`;
		} else if (category === "stderr" && output.body.output.trim().startsWith("<async") && output.body.output.trim().endsWith(">")) {
			output.body.output = `${applyColor(output.body.output.trimRight(), grey)}\n`;
		}

		this.sendEvent(output);
	}
}

export interface InstanceWithEvaluateName extends VMInstanceRef {
	// Undefined means we cannot evaluate
	evaluateName: string | undefined;
}

export type VmExceptionMode = "None" | "Unhandled" | "All";

interface MessageWithUriData {
	col: number;
	line: number;
	prefix: string;
	sourceUri: string;
}

class RemoteEditorTerminalProcess {
	public killed = false;

	constructor(public readonly pid?: number) { }
}

class InspectedVariable {
	public static readonly type = "InspectedVariable";
	get type() { return InspectedVariable.type; }
	constructor(public readonly variablesReference: number) { }
}
