import { Thread, ThreadEvent } from "vscode-debugadapter";
import { DebugProtocol } from "vscode-debugprotocol";
import { LogCategory } from "../../shared/enums";
import { PromiseCompleter } from "../../shared/utils";
import { isKnownInfrastructureThread } from "../../shared/utils/debugger";
import { logError } from "../utils/log";
import { DartDebugSession, InstanceWithEvaluateName, VmExceptionMode } from "./dart_debug_impl";
import { DebuggerResult, VMBreakpoint, VMInstanceRef, VMIsolate, VMIsolateRef, VMResponse, VMScript, VMScriptRef } from "./dart_debug_protocol";

export class ThreadManager {
	public nextThreadId: number = 0;

	public threads: ThreadInfo[] = [];
	public bps: { [uri: string]: DebugProtocol.SourceBreakpoint[] } = {};
	private hasConfigurationDone = false;
	private exceptionMode: VmExceptionMode = "Unhandled";

	constructor(public readonly debugSession: DartDebugSession) { }

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

			if (this.debugSession.observatory) {
				await Promise.all([
					this.debugSession.observatory.setExceptionPauseMode(thread.ref.id, this.exceptionMode),
					this.setLibrariesDebuggable(thread.ref),
					this.resetBreakpoints(),
				]);
				thread.setInitialBreakpoints();
			}
		}
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

	public setExceptionPauseMode(mode: VmExceptionMode) {
		this.exceptionMode = mode;
		if (!this.debugSession.observatory)
			return;

		for (const thread of this.threads) {
			if (thread.runnable) {
				let threadMode = mode;

				// If the mode is set to "All Exceptions" but the thread is a snapshot from pub
				// then downgrade it to Uncaught because the user is unlikely to want to be stopping
				// on internal exceptions such trying to parse versions.
				if (mode === "All" && thread.isInfrastructure)
					threadMode = "Unhandled";

				this.debugSession.observatory.setExceptionPauseMode(thread.ref.id, threadMode);
			}
		}
	}

	private async setLibrariesDebuggable(isolateRef: VMIsolateRef): Promise<void> {
		if (this.debugSession.noDebug || !this.debugSession.observatory)
			return;

		// Helpers to categories libraries as SDK/ExternalLibrary/not.
		// Set whether libraries should be debuggable based on user settings.
		const response = await this.debugSession.observatory.getIsolate(isolateRef.id);
		const isolate: VMIsolate = response.result as VMIsolate;
		await Promise.all(
			isolate.libraries.filter((l) => this.debugSession.isValidToDebug(l.uri)).map((library): Promise<any> => {
				if (!this.debugSession.observatory)
					return Promise.resolve(true);
				// Note: Condition is negated.
				const shouldDebug = !(
					// Inside here is shouldNotDebug!
					(this.debugSession.isSdkLibrary(library.uri) && !this.debugSession.debugSdkLibraries)
					|| (this.debugSession.isExternalLibrary(library.uri) && !this.debugSession.debugExternalLibraries));
				return this.debugSession.observatory.setLibraryDebuggable(isolate.id, library.id, shouldDebug);
			}));
	}

	// Just resends existing breakpoints
	public async resetBreakpoints(): Promise<void> {
		const promises = [];
		for (const uri of Object.keys(this.bps)) {
			promises.push(this.setBreakpoints(uri, this.bps[uri]));
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
				const result = thread.setBreakpoints(uri, breakpoints);
				if (!promise)
					promise = result;
			}
		}

		if (promise)
			return promise;

		const completer = new PromiseCompleter<boolean[]>();
		completer.resolve(breakpoints.map((_) => true));
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
	public data: VMResponse;

	constructor(thread: ThreadInfo, data: VMResponse) {
		this.thread = thread;
		this.data = data;
	}
}

export class ThreadInfo {
	public scriptCompleters: { [key: string]: PromiseCompleter<VMScript> } = {};
	public runnable: boolean = false;
	public vmBps: { [uri: string]: VMBreakpoint[] } = {};
	// TODO: Do we need both sets of breakpoints?
	public breakpoints: { [key: string]: DebugProtocol.SourceBreakpoint } = {};
	public atAsyncSuspension: boolean = false;
	public exceptionReference = 0;
	public paused: boolean = false;

	// Whether this thread is infrastructure (eg. not user code), useful for avoiding breaking
	// on handled exceptions, etc.
	get isInfrastructure(): boolean {
		return this.ref && this.ref.name && isKnownInfrastructureThread(this.ref);
	}

	constructor(
		public readonly manager: ThreadManager,
		public readonly ref: VMIsolateRef,
		public readonly num: number) {
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

	public async setBreakpoints(uri: string, breakpoints: DebugProtocol.SourceBreakpoint[]): Promise<VMBreakpoint[]> {
		// Remove all current bps.
		await this.removeBreakpointsAtUri(uri);
		this.vmBps[uri] = [];

		return Promise.all(
			breakpoints.map(async (bp) => {
				try {
					const result = await this.manager.debugSession.observatory.addBreakpointWithScriptUri(this.ref.id, uri, bp.line, bp.column);
					const vmBp: VMBreakpoint = (result.result as VMBreakpoint);
					this.vmBps[uri].push(vmBp);
					this.breakpoints[vmBp.id] = bp;
					return vmBp;
				} catch (e) {
					logError(e, LogCategory.Observatory);
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
			this.resume();
	}

	public handleResumed() {
		this.manager.removeStoredData(this);
		// TODO: Should we be waiting for acknowledgement before doing this?
		this.atAsyncSuspension = false;
		this.exceptionReference = 0;
		this.paused = false;
	}

	public async resume(step?: string): Promise<void> {
		if (!this.paused || this.hasPendingResume)
			return;

		this.hasPendingResume = true;
		try {
			await this.manager.debugSession.observatory.resume(this.ref.id, step);
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
		if (exception) {
			(exception as InstanceWithEvaluateName).evaluateName = "$e";
			this.exceptionReference = this.storeData(exception);
		}
		this.paused = true;
	}
}
