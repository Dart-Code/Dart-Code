"use strict";

let WebSocket = require("ws");

import { PromiseCompleter } from "./utils";

// Toggle this to view VM debugger wire traffic.
const shouldLogTraffic: boolean = false;

export class DebuggerResult {
	result: VMResponse;

	constructor(result: VMResponse) {
		this.result = result;
	}
}

export interface VMEvent {
	kind: string;
	timestamp: number;
	isolate?: VMIsolateRef;
	exception?: VMInstanceRef;
	pauseBreakpoints?: VMBreakpoint[];
	atAsyncSuspension?: boolean;
}

export interface VMBreakpoint extends VMObj {
	// A number identifying this breakpoint to the user.
	breakpointNumber: number;
	// Has this breakpoint been assigned to a specific program location?
	resolved: boolean;

	// Is this a breakpoint that was added synthetically as part of a step
	// OverAsyncSuspension resume command?
	// isSyntheticAsyncContinuation?: boolean;

	// SourceLocation when breakpoint is resolved, UnresolvedSourceLocation when a breakpoint
	// is not resolved. [location] can be one of [SourceLocation] or [UnresolvedSourceLocation].
	// location: any;
}

export interface VMObj extends VMResponse {
	id: string;
	classRef?: VMClassRef;
	size?: number;
}

export interface VMIsolateRef extends VMResponse {
	id: string;
	name: string;
}

export interface VMIsolate extends VMResponse {
	id: string;
	number: string;
	name: string;
	runnable: boolean;
	pauseEvent: VMEvent;
}

export interface VMObjectRef extends VMResponse {
	id: string;
}

export interface VMStack extends VMResponse {
	frames: VMFrame[];
}

export interface VMFrame extends VMResponse {
	index: number;
	function: VMFuncRef;
	// CodeRef code;
	location: VMSourceLocation;
	vars: VMBoundVariable[];
}

export interface VMSourceLocation extends VMResponse {
	// The script containing the source location.
	script: VMScriptRef;
	// The first token of the location.
	tokenPos: number;
	// The last token of the location if this is a range.
	endTokenPos?: number;
}

export interface VMScriptRef extends VMObjectRef {
	// The uri from which this script was loaded.
	uri: string;
}

export interface VMScript extends VMObj {
	// The uri from which this script was loaded.
	uri: string;
	// The library which owns this script.
	library: VMLibraryRef;
	// The source code for this script. For certain built-in scripts, this may be
	// reconstructed without source comments.
	source: string;
	// A table encoding a mapping from token position to line and column.
	tokenPosTable: number[][];
}

export interface VMInstance extends VMObj {
	kind: string;
	valueAsString?: boolean;
	valueAsStringIsTruncated?: boolean;
	length?: number;
	offset?: number;
	count?: number;
	name?: string;
	typeClass?: VMClassRef;
	parameterizedClass?: VMClassRef;
	// The fields of this Instance.
	fields?: VMBoundField[];
	// The elements of a List instance. Provided for instance kinds: List.
	elements?: any[];
	// The elements of a Map instance. Provided for instance kinds: Map.
	associations?: VMMapAssociation[];
	// TODO: fill in more types

}

export interface VMBoundField {
	decl: VMFieldRef;
	value: VMInstanceRef | VMSentinel;
}

export interface VMMapAssociation {
	key: VMInstanceRef | VMSentinel;
	value: VMInstanceRef | VMSentinel;
}

export interface VMFieldRef extends VMObjectRef {
	// The name of this field.
	name: string;
	// The owner of this field, which can be either a Library or a Class.
	owner: VMObjectRef;
}

export interface VMLibraryRef extends VMObjectRef {
	// The name of this library.
	name: string;
	// The uri of this library.
	uri: string;
}

export interface VMFuncRef extends VMObjectRef {
	name: string;
	// The owner of this function, which can be one of [LibraryRef], [ClassRef] or [FuncRef].
	owner: VMLibraryRef | VMClassRef | VMFuncRef;
	// Is this function static?
	isStatic: boolean;
	// Is this function const?
	isConst: boolean;
}

export interface VMBoundVariable {
	name: string;
	// [value] can be one of [InstanceRef] or [Sentinel].
	value: VMInstanceRef | VMSentinel;
}

export interface VMResponse {
	type: string;
}

export interface VM extends VMResponse {
	architectureBits: number;
	targetCPU: string;
	hostCPU: string;
	version: string;
	pid: number;
	isolates: VMIsolateRef[];
	libraries: VMLibraryRef[];
}

export interface VMSentinel extends VMResponse {
	// SentinelKind
	kind: string;
	// A reasonable string representation of this sentinel.
	valueAsString: string;
}

export interface VMInstanceRef extends VMObjectRef {
	kind: string;
	class: VMClassRef;
	valueAsString?: string;
	valueAsStringIsTruncated?: boolean;
	length?: number;
}

export interface VMErrorRef extends VMObjectRef {
	// The kind of error.
	kind: string;
	// A description of the error.
	message: string;
}

export interface VMClassRef extends VMObjectRef {
	name: string;
}

export class RPCError {
	code: number;
	message: string;
	data;

	constructor(code: number, message: string, data?) {
		this.code = code;
		this.message = message;
		this.data = data;
	}

	details(): string {
		return this.data == null ? null : this.data.details;
	}

	toString(): string {
		return `${this.code} ${this.message}`;
	}
}

export class ObservatoryConnection {
	static portRegex: RegExp = new RegExp("Observatory listening on (http:.+)");

	socket: any;
	private completers: { [key: string]: PromiseCompleter<DebuggerResult> } = {};
	private eventListeners: { [key: string]: any } = {};

	constructor(uri: string) {
		this.socket = new WebSocket(uri);
		this.socket.on("message", (data) => this.handleData(data));
	}

	onOpen(cb: () => void) {
		this.socket.on("open", cb);
	}

	onLogging(callback: (message: string) => void) {
		this.eventListeners['logging'] = callback;
	}

	getVersion(): Promise<DebuggerResult> {
		return this.callMethod("getVersion");
	}

	getVM(): Promise<DebuggerResult> {
		return this.callMethod("getVM");
	}

	getIsolate(isolateId: string): Promise<DebuggerResult> {
		return this.callMethod("getIsolate", { "isolateId": isolateId });
	}

	on(streamId: string, callback: (event: VMEvent) => void) {
		this.streamListen(streamId);
		this.eventListeners[streamId] = callback;
	}

	streamListen(streamId: string) {
		this.callMethod("streamListen", { "streamId": streamId })
	}

	addBreakpointWithScriptUri(isolateId: string, scriptUri: string, line: number, column?: number): Promise<DebuggerResult> {
		let data = { "isolateId": isolateId, "scriptUri": scriptUri, "line": line };
		if (column)
			data["column"] = column;
		return this.callMethod("addBreakpointWithScriptUri", data);
	}

	// None, Unhandled, and All
	setExceptionPauseMode(isolateId: string, mode: string): Promise<DebuggerResult> {
		return this.callMethod("setExceptionPauseMode", { isolateId: isolateId, mode: mode });
	}

	removeBreakpoint(isolateId: string, breakpointId: string) {
		this.callMethod("removeBreakpoint", { "isolateId": isolateId, "breakpointId": breakpointId })
	}

	pause(isolateId: string): Promise<DebuggerResult> {
		return this.callMethod("pause", { isolateId: isolateId });
	}

	// Into, Over, OverAsyncSuspension, and Out
	resume(isolateId: string, step?: string): Promise<DebuggerResult> {
		return this.callMethod("resume", { isolateId: isolateId, step: step });
	}

	getStack(isolateId: string): Promise<DebuggerResult> {
		return this.callMethod("getStack", { isolateId: isolateId });
	}

	getObject(isolateId: string, objectId: string, offset?: number, count?: number): Promise<DebuggerResult> {
		let data = { "isolateId": isolateId, "objectId": objectId };
		if (offset)
			data["offset"] = offset;
		if (count)
			data["count"] = count;
		return this.callMethod("getObject", data);
	}

	evaluate(isolateId: string, targetId: String, expression: string): Promise<DebuggerResult> {
		return this.callMethod("evaluate", {
			isolateId: isolateId,
			targetId: targetId,
			expression: expression
		});
	}

	evaluateInFrame(isolateId: string, frameIndex: number, expression: string): Promise<DebuggerResult> {
		return this.callMethod("evaluateInFrame", {
			isolateId: isolateId,
			frameIndex: frameIndex,
			expression: expression
		});
	}

	nextId: number = 0;

	callMethod(method: string, params?): Promise<DebuggerResult> {
		let id = `${this.nextId++}`;
		let completer = new PromiseCompleter<DebuggerResult>();
		this.completers[id] = completer;

		let json = { id: id, method: method };
		if (params)
			json["params"] = params;
		let str = JSON.stringify(json);
		this.logTraffic(`==> ${str}`);
		this.socket.send(str);

		return completer.promise;
	}

	handleData(data: string) {
		this.logTraffic(`<== ${data}\n`);
		let json = JSON.parse(data);
		let id = json.id;
		let method = json.method;
		let error = json.error;
		let completer: PromiseCompleter<DebuggerResult> = this.completers[id];

		if (completer) {
			delete this.completers[id];

			if (error)
				completer.reject(new RPCError(error.code, error.message, error.data));
			else
				completer.resolve(new DebuggerResult(json.result));
		} else if (method) {
			let params = json.params;
			let streamId = params.streamId;

			let callback = this.eventListeners[streamId];
			if (callback)
				callback(params.event);
		}
	}

	onError(cb: (err: Error) => void) {
		this.socket.on("error", cb);
	}

	onClose(cb: (code: number, message: string) => void) {
		this.socket.on("close", cb);
	}

	// TODO: We could instead log this to a file.
	private logTraffic(message: String): void {
		if (!shouldLogTraffic)
			return;

		let callback = this.eventListeners['logging'];
		if (callback) {
			const max: number = 2000;
			if (message.length > max)
				message = message.substring(0, max) + "...";
			callback(message);
		}
	}

	close() {
		this.socket.close();
	}
}
