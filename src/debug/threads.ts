import { Thread, ThreadEvent } from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol";
import { DebuggerResult, VMBreakpoint, VMEvent, VMIsolate, VMIsolateRef, VMLibraryRef, VMResponse, VMScript, VMScriptRef, VmExceptionMode } from "../shared/debug/dart_debug_protocol";
import { LogCategory } from "../shared/enums";
import { Logger } from "../shared/interfaces";
import { PromiseCompleter, errorString } from "../shared/utils";
import { DartDebugSession, InstanceWithEvaluateName } from "./dart_debug_impl";

export class ThreadManager {
	public nextThreadId = 0;

	public threads: ThreadInfo[] = [];
	public bps: { [uri: string]: DebugProtocol.SourceBreakpoint[] } = {};
	private hasConfigurationDone = false;
	private exceptionMode: VmExceptionMode = "Unhandled";

	constructor(private readonly logger: Logger, public readonly debugSession: DartDebugSession) { }

	public async registerThread(ref: VMIsolateRef, eventKind: string): Promise<void> {
		let thread = this.getThreadInfoFromRef(ref);

		if (!thread) {
			thread = new ThreadInfo(this, ref, this.nextThreadId);
			this.nextThreadId++;
			this.threads.push(thread);

			// If this is the first time we've seen it, fire an event
			this.debugSession.sendEvent(new ThreadEvent("started", thread.num));

			if (this.hasConfigurationDone)
				thread.receivedConfigurationDone();
		}

		// If it's just become runnable (IsolateRunnable), then set breakpoints.
		if (eventKind === "IsolateRunnable" && !thread.runnable) {
			thread.runnable = true;

			if (this.debugSession.vmService) {
				await Promise.all([
					this.setThreadExceptionPauseMode(thread.ref, this.exceptionMode),
					this.setLibrariesDebuggable(thread.ref),
					this.resendThreadBreakpoints(thread),
				]);
				thread.setInitialBreakpoints();
			}
		}
	}

	private async setThreadExceptionPauseMode(isolateRef: VMIsolateRef, mode: VmExceptionMode): Promise<void> {
		if (!this.debugSession?.vmService)
			return;

		if (this.debugSession.vmServiceCapabilities.supportsSetIsolatePauseMode && this.debugSession.dartCapabilities.supportsSetIsolatePauseModeForWeb) {
			await this.debugSession.vmService.setIsolatePauseMode(isolateRef.id, { exceptionPauseMode: mode });
		} else {
			await this.debugSession.vmService.setExceptionPauseMode(isolateRef.id, mode);
		}
	}

	public async setLibrariesDuggableForAllIsolates() {
		await Promise.all(this.threads.map((thread) => this.setLibrariesDebuggable(thread.ref)));
	}

	public receivedConfigurationDone() {
		this.hasConfigurationDone = true;

		for (const thread of this.threads)
			thread.receivedConfigurationDone();
	}

	public getThreadInfoFromRef(ref: VMIsolateRef): ThreadInfo | undefined {
		for (const thread of this.threads) {
			if (thread.ref.id === ref.id)
				return thread;
		}
		return undefined;
	}

	public getThreadInfoFromNumber(num: number): ThreadInfo | undefined {
		for (const thread of this.threads) {
			if (thread.num === num)
				return thread;
		}
		return undefined;
	}

	public getThreads(): Thread[] {
		return this.threads.map((thread: ThreadInfo) => new Thread(thread.num, thread.ref.name));
	}

	public async setExceptionPauseMode(mode: VmExceptionMode, persist = true) {
		if (persist) {
			this.exceptionMode = mode;
		}
		if (!this.debugSession.vmService)
			return;

		await Promise.all(this.threads.map(async (thread) => {
			if (!thread.runnable || !this.debugSession.vmService)
				return;

			await this.setThreadExceptionPauseMode(thread.ref, mode);
		}));
	}

	private async setLibrariesDebuggable(isolateRef: VMIsolateRef): Promise<void> {
		if (this.debugSession.noDebug || !this.debugSession.vmService)
			return;

		// Helpers to categories libraries as SDK/ExternalLibrary/not.
		// Set whether libraries should be debuggable based on user settings.
		const response = await this.debugSession.vmService.getIsolate(isolateRef.id);
		const isolate: VMIsolate = response.result as VMIsolate;
		const validDebugLibraries = isolate.libraries?.filter((l) => this.debugSession.isValidToDebug(l.uri)) || [];
		if (validDebugLibraries.length === 0)
			return;

		const debugSession = this.debugSession;
		function setLibrary(library: VMLibraryRef): Promise<any> {
			if (!debugSession.vmService)
				return Promise.resolve(true);
			// Note: Condition is negated.
			const shouldDebug = !(
				// Inside here is shouldNotDebug!
				(debugSession.isSdkLibrary(library.uri) && !debugSession.debugSdkLibraries)
				|| (debugSession.isExternalLibrary(library.uri) && !debugSession.debugExternalPackageLibraries));
			return debugSession.vmService.setLibraryDebuggable(isolate.id, library.id, shouldDebug);
		}

		// We usually send these requests all concurrently, however on web this is not currently
		// supported (https://github.com/dart-lang/webdev/issues/606) which results in a lot of
		// bloat in the logs. Instead, send the first one, and if it works successfully, then
		// do the whole lot.
		const firstLib = validDebugLibraries[0];
		try {
			await setLibrary(firstLib);
		} catch (e) {
			this.logger.info(errorString(e));
			return;
		}
		// Do all.
		await Promise.all(validDebugLibraries.map(setLibrary)).catch((e) => this.logger.info(errorString(e)));
	}

	// Just resends existing breakpoints for a single thread.
	public async resendThreadBreakpoints(thread: ThreadInfo): Promise<void> {
		const promises = [];
		for (const uri of Object.keys(this.bps)) {
			promises.push(thread.setBreakpoints(this.logger, uri, this.bps[uri]));
		}
		await Promise.all(promises);
	}

	public setBreakpoints(uri: string, breakpoints: DebugProtocol.SourceBreakpoint[]): Promise<any[]> {
		// Remember these bps for when new threads start.
		if (breakpoints.length === 0)
			delete this.bps[uri];
		else
			this.bps[uri] = breakpoints;

		let promise;

		for (const thread of this.threads) {
			if (thread.runnable) {
				const result = thread.setBreakpoints(this.logger, uri, breakpoints);
				if (!promise)
					promise = result;
			}
		}

		if (promise)
			return promise;

		const completer = new PromiseCompleter<boolean[]>();
		completer.resolve(breakpoints.map(() => true));
		return completer.promise;
	}

	public nextDataId = 1;
	public storedData: { [id: number]: StoredData } = {};

	public storeData(thread: ThreadInfo, data: StorableData): number {
		const id = this.nextDataId;
		this.nextDataId++;
		this.storedData[id] = new StoredData(thread, data);
		return id;
	}

	public getStoredData(id: number): StoredData {
		return this.storedData[id];
	}

	public removeStoredData(thread: ThreadInfo) {
		for (const id of Object.keys(this.storedData).map((k) => parseInt(k, 10))) {
			if (this.storedData[id].thread.num === thread.num)
				delete this.storedData[id];
		}
	}

	public removeAllStoredData() {
		for (const id of Object.keys(this.storedData).map((k) => parseInt(k, 10))) {
			delete this.storedData[id];
		}
	}

	public handleIsolateExit(ref: VMIsolateRef) {
		const threadInfo = this.getThreadInfoFromRef(ref);
		if (threadInfo) {
			this.debugSession.sendEvent(new ThreadEvent("exited", threadInfo.num));
			this.threads.splice(this.threads.indexOf(threadInfo), 1);
			this.removeStoredData(threadInfo);
		}
	}
}

class StoredData {
	public thread: ThreadInfo;
	public data: StorableData;

	constructor(thread: ThreadInfo, data: StorableData) {
		this.thread = thread;
		this.data = data;
	}
}

export class ThreadInfo {
	public scriptCompleters: { [key: string]: PromiseCompleter<VMScript> } = {};
	public runnable = false;
	public vmBps: { [uri: string]: VMBreakpoint[] } = {};
	// TODO: Do we need both sets of breakpoints?
	public breakpoints: { [key: string]: DebugProtocol.SourceBreakpoint } = {};
	public atAsyncSuspension = false;
	public exceptionReference = 0;
	public paused = false;
	public pauseEvent: VMEvent | undefined;

	constructor(
		public readonly manager: ThreadManager,
		public readonly ref: VMIsolateRef,
		public readonly num: number) {
	}

	private removeBreakpointsAtUri(uri: string): Promise<any> {
		const removeBreakpointPromises = [];
		const breakpoints = this.vmBps[uri];
		if (breakpoints) {
			if (this.manager.debugSession.vmService) {
				for (const bp of breakpoints) {
					removeBreakpointPromises.push(this.manager.debugSession.vmService.removeBreakpoint(this.ref.id, bp.id));
				}
			}
			delete this.vmBps[uri];
		}
		return Promise.all(removeBreakpointPromises);
	}

	public removeAllBreakpoints(): Promise<any> {
		const removeBreakpointPromises = [];
		for (const uri of Object.keys(this.vmBps)) {
			removeBreakpointPromises.push(this.removeBreakpointsAtUri(uri));
		}
		return Promise.all(removeBreakpointPromises);
	}

	public async setBreakpoints(logger: Logger, uri: string, breakpoints: DebugProtocol.SourceBreakpoint[]): Promise<Array<VMBreakpoint | undefined>> {
		// Remove all current bps.
		await this.removeBreakpointsAtUri(uri);
		this.vmBps[uri] = [];

		return Promise.all(
			breakpoints.map(async (bp) => {
				try {
					if (!this.manager.debugSession.vmService)
						return undefined;

					const result = await this.manager.debugSession.vmService.addBreakpointWithScriptUri(this.ref.id, uri, bp.line, bp.column);
					const vmBp: VMBreakpoint = (result.result as VMBreakpoint);
					this.vmBps[uri]?.push(vmBp);
					this.breakpoints[vmBp.id] = bp;
					return vmBp;
				} catch (e) {
					logger.error(e, LogCategory.VmService);
					return undefined;
				}
			}),
		);
	}

	private gotPauseStart = false;
	private initialBreakpoints = false;
	private hasConfigurationDone = false;
	private hasPendingResume = false;

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
			void this.resume();
	}

	public handleResumed() {
		this.manager.removeStoredData(this);
		// TODO: Should we be waiting for acknowledgement before doing this?
		this.atAsyncSuspension = false;
		this.exceptionReference = 0;
		this.paused = false;
		this.pauseEvent = undefined;
	}

	public async resume(step?: string, frameIndex?: number): Promise<void> {
		if (!this.paused || this.hasPendingResume || !this.manager.debugSession.vmService)
			return;

		this.hasPendingResume = true;
		try {
			await this.manager.debugSession.vmService.resume(this.ref.id, step, frameIndex);
			this.handleResumed();
		} finally {
			this.hasPendingResume = false;
		}
	}

	public getScript(scriptRef: VMScriptRef): Promise<VMScript> {
		const scriptId = scriptRef.id;

		if (this.scriptCompleters[scriptId]) {
			const completer: PromiseCompleter<VMScript> = this.scriptCompleters[scriptId];
			return completer.promise;
		} else {
			const completer: PromiseCompleter<VMScript> = new PromiseCompleter();
			this.scriptCompleters[scriptId] = completer;

			if (this.manager.debugSession.vmService) {
				this.manager.debugSession.vmService.getObject(this.ref.id, scriptRef.id).then((result: DebuggerResult) => {
					const script: VMScript = result.result as VMScript;
					completer.resolve(script);
				}).catch((error) => {
					completer.reject(error);
				});
			} else {
				completer.reject(`VM service connection is no longer available`);
			}

			return completer.promise;
		}
	}

	public storeData(data: VMResponse): number {
		return this.manager.storeData(this, data);
	}

	public handlePaused(pauseEvent: VMEvent) {
		this.atAsyncSuspension = pauseEvent.atAsyncSuspension === true;
		if (pauseEvent.exception) {
			const exception = pauseEvent.exception;
			(exception as InstanceWithEvaluateName).evaluateName = "$_threadException";
			this.exceptionReference = this.storeData(exception);
		}
		this.paused = true;
		this.pauseEvent = pauseEvent;
	}
}

export interface StorableData {
	type: string;
}
