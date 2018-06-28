// This is a copy of MS's DebugClient with minimal changes made to aid extending. debug_client.ts includes
// a subclass to provide most additional functionality to keep it easy to update this as MS update theirs.
//
// Original source:
// https://raw.githubusercontent.com/Microsoft/vscode-debugadapter-node/master/testSupport/src/debugClient.ts

/* tslint:disable */

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs = require('fs');
import constants = require('constants');
import cp = require('child_process');
import assert = require('assert');
import net = require('net');
import { ProtocolClient } from 'vscode-debugadapter-testsupport/lib/protocolClient';
import { DebugProtocol } from 'vscode-debugprotocol';

export interface ILocation {
	path: string;
	line: number;
	column?: number;
	verified?: boolean;
}

export interface IPartialLocation {
	path?: string;
	line?: number;
	column?: number;
	verified?: boolean;
}

export class DebugClient extends ProtocolClient {

	private static CASE_INSENSITIVE_FILESYSTEM: boolean;

	private _runtime: string;
	private _executable: string;
	private _adapterProcess: cp.ChildProcess;
	private _spawnOptions: cp.SpawnOptions;
	private _enableStderr: boolean;
	private _debugType: string;
	private _socket: net.Socket;

	protected _supportsConfigurationDoneRequest: boolean;

	public defaultTimeout = 5000;

	/**
	 * Creates a DebugClient object that provides a promise-based API to write
	 * debug adapter tests.
	 * A simple mocha example for setting and hitting a breakpoint in line 15 of a program 'test.js' looks like this:
	 *
	 * var dc;
	 * setup( () => {
	 *     dc = new DebugClient('node', './out/node/nodeDebug.js', 'node');
	 *     return dc.start();
	 * });
	 * teardown( () => dc.stop() );
	 *
	 * test('should stop on a breakpoint', () => {
	 *     return dc.hitBreakpoint({ program: 'test.js' }, 'test.js', 15);
	 * });
	 */
	constructor(runtime: string, executable: string, debugType: string, spwanOptions?: cp.SpawnOptions) {
		super();
		this._runtime = runtime;
		this._executable = executable;
		this._spawnOptions = spwanOptions;
		this._enableStderr = false;
		this._debugType = debugType;
		this._supportsConfigurationDoneRequest = false;

		if (DebugClient.CASE_INSENSITIVE_FILESYSTEM === undefined) {
			try {
				fs.accessSync(process.execPath.toLowerCase(), constants.F_OK);
				fs.accessSync(process.execPath.toUpperCase(), constants.F_OK);
				DebugClient.CASE_INSENSITIVE_FILESYSTEM = true;
			} catch (err) {
				DebugClient.CASE_INSENSITIVE_FILESYSTEM = false;
			}
		}
	}

	// ---- life cycle --------------------------------------------------------------------------------------------------------

	/**
	 * Starts a new debug adapter and sets up communication via stdin/stdout.
	 * If a port number is specified the adapter is not launched but a connection to
	 * a debug adapter running in server mode is established. This is useful for debugging
	 * the adapter while running tests. For this reason all timeouts are disabled in server mode.
	 */
	public start(port?: number): Promise<void> {

		return new Promise<void>((resolve, reject) => {
			if (typeof port === 'number') {
				this._socket = net.createConnection(port, '127.0.0.1', () => {
					this.connect(this._socket, this._socket);
					resolve();
				});
			} else {
				this._adapterProcess = cp.spawn(this._runtime, [this._executable], this._spawnOptions);
				const sanitize = (s: string) => s.toString().replace(/\r?\n$/mg, '');
				this._adapterProcess.stderr.on('data', (data: string) => {
					if (this._enableStderr) {
						console.log(sanitize(data));
					}
				});

				this._adapterProcess.on('error', (err) => {
					console.log(err);
					reject(err);
				});
				this._adapterProcess.on('exit', (code: number, signal: string) => {
					if (code) {
						// done(new Error('debug adapter exit code: ' + code));
					}
				});

				this.connect(this._adapterProcess.stdout, this._adapterProcess.stdin);
				resolve();
			}
		});
	}

	/**
	 * Shutdown the debuggee and the debug adapter (or disconnect if in server mode).
	 */
	public stop(): Promise<void> {

		return this.disconnectRequest().then(() => {
			this.stopAdapter();
		}).catch(() => {
			this.stopAdapter();
		});
	}

	private stopAdapter() {
		if (this._adapterProcess) {
			this._adapterProcess.kill();
			this._adapterProcess = null;
		}
		if (this._socket) {
			this._socket.end();
			this._socket = null;
		}
	}

	// ---- protocol requests -------------------------------------------------------------------------------------------------

	public initializeRequest(args?: DebugProtocol.InitializeRequestArguments): Promise<DebugProtocol.InitializeResponse> {
		if (!args) {
			args = {
				adapterID: this._debugType,
				linesStartAt1: true,
				columnsStartAt1: true,
				pathFormat: 'path'
			};
		}
		return this.send('initialize', args);
	}

	public configurationDoneRequest(args?: DebugProtocol.ConfigurationDoneArguments): Promise<DebugProtocol.ConfigurationDoneResponse> {
		return this.send('configurationDone', args);
	}

	public launchRequest(args: DebugProtocol.LaunchRequestArguments): Promise<DebugProtocol.LaunchResponse> {
		return this.send('launch', args);
	}

	public attachRequest(args: DebugProtocol.AttachRequestArguments): Promise<DebugProtocol.AttachResponse> {
		return this.send('attach', args);
	}

	public restartRequest(args: DebugProtocol.RestartArguments): Promise<DebugProtocol.RestartResponse> {
		return this.send('restart', args);
	}

	public disconnectRequest(args?: DebugProtocol.DisconnectArguments): Promise<DebugProtocol.DisconnectResponse> {
		return this.send('disconnect', args);
	}

	public setBreakpointsRequest(args: DebugProtocol.SetBreakpointsArguments): Promise<DebugProtocol.SetBreakpointsResponse> {
		return this.send('setBreakpoints', args);
	}

	public setFunctionBreakpointsRequest(args: DebugProtocol.SetFunctionBreakpointsArguments): Promise<DebugProtocol.SetFunctionBreakpointsResponse> {
		return this.send('setFunctionBreakpoints', args);
	}

	public setExceptionBreakpointsRequest(args: DebugProtocol.SetExceptionBreakpointsArguments): Promise<DebugProtocol.SetExceptionBreakpointsResponse> {
		return this.send('setExceptionBreakpoints', args);
	}

	public continueRequest(args: DebugProtocol.ContinueArguments): Promise<DebugProtocol.ContinueResponse> {
		return this.send('continue', args);
	}

	public nextRequest(args: DebugProtocol.NextArguments): Promise<DebugProtocol.NextResponse> {
		return this.send('next', args);
	}

	public stepInRequest(args: DebugProtocol.StepInArguments): Promise<DebugProtocol.StepInResponse> {
		return this.send('stepIn', args);
	}

	public stepOutRequest(args: DebugProtocol.StepOutArguments): Promise<DebugProtocol.StepOutResponse> {
		return this.send('stepOut', args);
	}

	public stepBackRequest(args: DebugProtocol.StepBackArguments): Promise<DebugProtocol.StepBackResponse> {
		return this.send('stepBack', args);
	}

	public reverseContinueRequest(args: DebugProtocol.ReverseContinueArguments): Promise<DebugProtocol.ReverseContinueResponse> {
		return this.send('reverseContinue', args);
	}

	public restartFrameRequest(args: DebugProtocol.RestartFrameArguments): Promise<DebugProtocol.RestartFrameResponse> {
		return this.send('restartFrame', args);
	}

	public gotoRequest(args: DebugProtocol.GotoArguments): Promise<DebugProtocol.GotoResponse> {
		return this.send('goto', args);
	}

	public pauseRequest(args: DebugProtocol.PauseArguments): Promise<DebugProtocol.PauseResponse> {
		return this.send('pause', args);
	}

	public stackTraceRequest(args: DebugProtocol.StackTraceArguments): Promise<DebugProtocol.StackTraceResponse> {
		return this.send('stackTrace', args);
	}

	public scopesRequest(args: DebugProtocol.ScopesArguments): Promise<DebugProtocol.ScopesResponse> {
		return this.send('scopes', args);
	}

	public variablesRequest(args: DebugProtocol.VariablesArguments): Promise<DebugProtocol.VariablesResponse> {
		return this.send('variables', args);
	}

	public setVariableRequest(args: DebugProtocol.SetVariableArguments): Promise<DebugProtocol.SetVariableResponse> {
		return this.send('setVariable', args);
	}

	public sourceRequest(args: DebugProtocol.SourceArguments): Promise<DebugProtocol.SourceResponse> {
		return this.send('source', args);
	}

	public threadsRequest(): Promise<DebugProtocol.ThreadsResponse> {
		return this.send('threads');
	}

	public modulesRequest(args: DebugProtocol.ModulesArguments): Promise<DebugProtocol.ModulesResponse> {
		return this.send('modules');
	}

	public evaluateRequest(args: DebugProtocol.EvaluateArguments): Promise<DebugProtocol.EvaluateResponse> {
		return this.send('evaluate', args);
	}

	public stepInTargetsRequest(args: DebugProtocol.StepInTargetsArguments): Promise<DebugProtocol.StepInTargetsResponse> {
		return this.send('stepInTargets', args);
	}

	public gotoTargetsRequest(args: DebugProtocol.GotoTargetsArguments): Promise<DebugProtocol.GotoTargetsResponse> {
		return this.send('gotoTargets', args);
	}

	public completionsRequest(args: DebugProtocol.CompletionsArguments): Promise<DebugProtocol.CompletionsResponse> {
		return this.send('completions', args);
	}

	public exceptionInfoRequest(args: DebugProtocol.ExceptionInfoArguments): Promise<DebugProtocol.ExceptionInfoResponse> {
		return this.send('exceptionInfo', args);
	}

	public customRequest(command: string, args?: any): Promise<DebugProtocol.Response> {
		return this.send(command, args);
	}

	// ---- convenience methods -----------------------------------------------------------------------------------------------

	/*
	 * Returns a promise that will resolve if an event with a specific type was received within some specified time.
	 * The promise will be rejected if a timeout occurs.
	 */
	public waitForEvent(eventType: string, timeout?: number): Promise<DebugProtocol.Event> {

		timeout = timeout || this.defaultTimeout;

		return new Promise((resolve, reject) => {
			this.once(eventType, (event: any) => {
				resolve(event);
			});
			if (!this._socket) {	// no timeouts if debugging the tests
				setTimeout(() => {
					reject(new Error(`no event '${eventType}' received after ${timeout} ms`));
				}, timeout!);
			}
		});
	}

	/*
	 * Returns a promise that will resolve if an 'initialized' event was received within some specified time
	 * and a subsequent 'configurationDone' request was successfully executed.
	 * The promise will be rejected if a timeout occurs or if the 'configurationDone' request fails.
	 */
	public configurationSequence(): Promise<any> {

		return this.waitForEvent('initialized').then(event => {
			return this.configurationDone();
		});
	}

	/**
	 * Returns a promise that will resolve if a 'initialize' and a 'launch' request were successful.
	 */
	public launch(launchArgs: any): Promise<void> {

		return this.initializeRequest().then(response => {
			if (response.body && response.body.supportsConfigurationDoneRequest) {
				this._supportsConfigurationDoneRequest = true;
			}
			return this.launchRequest(launchArgs);
		}).then((_) => { });
	}

	private configurationDone(): Promise<DebugProtocol.Response> {
		if (this._supportsConfigurationDoneRequest) {
			return this.configurationDoneRequest();
		} else {
			// if debug adapter doesn't support the configurationDoneRequest we have to send the setExceptionBreakpointsRequest.
			return this.setExceptionBreakpointsRequest({ filters: ['all'] });
		}
	}

	/*
	 * Returns a promise that will resolve if a 'stopped' event was received within some specified time
	 * and the event's reason and line number was asserted.
	 * The promise will be rejected if a timeout occurs, the assertions fail, or if the 'stackTrace' request fails.
	 */
	public assertStoppedLocation(reason: string, expected: { path?: string | RegExp, line?: number, column?: number }): Promise<DebugProtocol.StackTraceResponse> {

		return this.waitForEvent('stopped').then(event => {
			assert.equal(event.body.reason, reason);
			return this.stackTraceRequest({
				threadId: event.body.threadId
			});
		}).then(response => {
			const frame = response.body.stackFrames[0];
			if (typeof expected.path === 'string' || expected.path instanceof RegExp) {
				this.assertPath(frame.source.path, expected.path, 'stopped location: path mismatch');
			}
			if (typeof expected.line === 'number') {
				assert.equal(frame.line, expected.line, 'stopped location: line mismatch');
			}
			if (typeof expected.column === 'number') {
				assert.equal(frame.column, expected.column, 'stopped location: column mismatch');
			}
			return response;
		});
	}

	private assertPartialLocationsEqual(locA: IPartialLocation, locB: IPartialLocation): void {
		if (locA.path) {
			this.assertPath(locA.path, locB.path, 'breakpoint verification mismatch: path');
		}
		if (typeof locA.line === 'number') {
			assert.equal(locA.line, locB.line, 'breakpoint verification mismatch: line');
		}
		if (typeof locB.column === 'number' && typeof locA.column === 'number') {
			assert.equal(locA.column, locB.column, 'breakpoint verification mismatch: column');
		}
	}

	/*
	 * Returns a promise that will resolve if enough output events with the given category have been received
	 * and the concatenated data match the expected data.
	 * The promise will be rejected as soon as the received data cannot match the expected data or if a timeout occurs.
	 */
	public assertOutput(category: string, expected: string, timeout?: number): Promise<DebugProtocol.Event> {

		timeout = timeout || this.defaultTimeout;

		return new Promise((resolve, reject) => {
			let output = '';
			this.on('output', (event: any) => {
				const e = <DebugProtocol.OutputEvent>event;
				if (e.body.category === category) {
					output += e.body.output;
					if (output.indexOf(expected) === 0) {
						resolve(event);
					} else if (expected.indexOf(output) !== 0) {
						const sanitize = (s: string) => s.toString().replace(/\r/mg, '\\r').replace(/\n/mg, '\\n');
						reject(new Error(`received data '${sanitize(output)}' is not a prefix of the expected data '${sanitize(expected)}'`));
					}
				}
			});
			if (!this._socket) {	// no timeouts if debugging the tests
				setTimeout(() => {
					reject(new Error(`not enough output data received after ${timeout} ms`));
				}, timeout!);
			}
		});
	}

	public assertPath(path: string, expected: string | RegExp, message?: string) {

		if (expected instanceof RegExp) {
			assert.ok((<RegExp>expected).test(path), message);
		} else {
			if (DebugClient.CASE_INSENSITIVE_FILESYSTEM) {
				if (typeof path === 'string') {
					path = path.toLowerCase();
				}
				if (typeof expected === 'string') {
					expected = (<string>expected).toLowerCase();
				}
			}
			assert.equal(path, expected, message);
		}
	}

	// ---- scenarios ---------------------------------------------------------------------------------------------------------

	/**
	 * Returns a promise that will resolve if a configurable breakpoint has been hit within some time
	 * and the event's reason and line number was asserted.
	 * The promise will be rejected if a timeout occurs, the assertions fail, or if the requests fails.
	 */
	public hitBreakpoint(launchArgs: any, location: ILocation, expectedStopLocation?: IPartialLocation, expectedBPLocation?: IPartialLocation): Promise<any> {

		// If we're an attach request, we'll automatically pause at startup, so we need to wait for that then resume before asserting
		// the stop.
		const setupBreakpointWait = launchArgs.request === "attach"
			? async () => {
				const event = await this.waitForEvent("stopped") as DebugProtocol.StoppedEvent;
				assert.equal(event.body.reason, "step");

				// We don't need to send a resume, as this is done in the launch method; we can just wait.
				return this.assertStoppedLocation('breakpoint', expectedStopLocation || location);
			}
			: () => this.assertStoppedLocation('breakpoint', expectedStopLocation || location);

		return Promise.all([

			this.waitForEvent('initialized').then(event => {
				return this.setBreakpointsRequest({
					lines: [location.line],
					breakpoints: [{ line: location.line, column: location.column }],
					source: { path: location.path }
				});
			}).then(response => {

				const bp = response.body.breakpoints[0];

				const verified = (typeof location.verified === 'boolean') ? location.verified : true;
				assert.equal(bp.verified, verified, 'breakpoint verification mismatch: verified');

				const actualLocation: ILocation = {
					column: bp.column,
					line: bp.line,
					path: bp.source && bp.source.path
				};
				this.assertPartialLocationsEqual(actualLocation, expectedBPLocation || location);

				return this.configurationDone();
			}),

			this.launch(launchArgs),

			setupBreakpointWait(),
		]);
	}
}
