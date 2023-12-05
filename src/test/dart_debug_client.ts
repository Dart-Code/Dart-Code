import { DebugProtocol } from "@vscode/debugprotocol";
import { strict as assert } from "assert";
import { Writable } from "stream";
import { DebugAdapterTracker, DebugAdapterTrackerFactory, DebugSession, DebugSessionCustomEvent, window } from "vscode";
import { tenMinutesInMs } from "../shared/constants";
import { DartVsCodeLaunchArgs } from "../shared/debug/interfaces";
import { TestSessionCoordinator } from "../shared/test/coordinator";
import { Notification, Test, TestDoneNotification, TestStartNotification } from "../shared/test_protocol";
import { withTimeout } from "../shared/utils";
import { getRandomInt } from "../shared/utils/fs";
import { waitFor } from "../shared/utils/promises";
import { DebugCommandHandler } from "../shared/vscode/interfaces";
import { DebugClient, ILocation, IPartialLocation } from "./debug_client_ms";
import { delay, extApi, logger, watchPromise } from "./helpers";

const customEventsToForward = ["dart.log", "dart.serviceExtensionAdded", "dart.serviceRegistered", "dart.debuggerUris", "dart.startTerminalProcess", "dart.exposeUrl", "flutter.appStart", "flutter.appStarted"];

type DebugClientArgs = { runtime: string, executable: string, args: string[], port?: undefined } | { runtime?: undefined, executable?: undefined, args?: undefined, port: number };

export class DartDebugClient extends DebugClient {
	private readonly port: number | undefined;
	public currentSession?: DebugSession;
	public currentTrackers: DebugAdapterTracker[] = [];
	public hasStarted = false;
	public hasTerminated = false;
	public readonly isDartDap: boolean;

	constructor(args: DebugClientArgs, private readonly debugCommands: DebugCommandHandler, readonly testCoordinator: TestSessionCoordinator | undefined, private readonly debugTrackerFactories: DebugAdapterTrackerFactory[]) {
		super(args.runtime, args.executable, args.args, "dart", { shell: args.runtime?.endsWith(".sh") ? true : undefined }, true);
		this.isDartDap = args.runtime !== undefined && args.runtime !== "node";
		this.port = args.port;

		// HACK to handle incoming requests..
		const me = (this as unknown as { dispatch(body: string): void });
		const oldDispatch = me.dispatch;
		me.dispatch = (body: string) => {
			const rawData = JSON.parse(body);
			for (const tracker of this.currentTrackers) {
				if (tracker.onDidSendMessage)
					tracker.onDidSendMessage(rawData);
			}
			if (rawData.type === "request") {
				const request = rawData as DebugProtocol.Request;
				this.emit(request.command, request);
			} else {
				oldDispatch.bind(this)(body);
			}
		};

		// Set up handlers for any custom events our tests may rely on (can't find
		// a way to just do them all 🤷‍♂️).
		customEventsToForward.forEach((evt) => this.on(evt, (e: DebugSessionCustomEvent) => this.handleCustomEvent(e)));

		// Log important events to make troubleshooting tests easier.
		this.on("output", (event: DebugProtocol.OutputEvent) => {
			logger.info(`[${event.body.category}] ${event.body.output}`);
		});
		this.on("terminated", (event: DebugProtocol.TerminatedEvent) => {
			this.hasTerminated = true;
			logger.info(`[terminated]`);
		});
		this.on("stopped", (event: DebugProtocol.StoppedEvent) => {
			logger.info(`[stopped] ${event.body.reason}`);
		});
		this.on("initialized", (event: DebugProtocol.InitializedEvent) => {
			logger.info(`[initialized]`);
		});
		this.on("runInTerminal", (request: DebugProtocol.RunInTerminalRequest) => {
			logger.info(`[runInTerminal]`);

			const terminal = window.createTerminal({
				cwd: request.arguments.cwd,
				env: request.arguments.env,
				name: request.arguments.title,
				shellArgs: request.arguments.args.slice(1),
				shellPath: request.arguments.args[0],
			});

			terminal.show();
			void terminal.processId.then((pid) => {
				this.sendResponse(request, { shellProcessId: pid });
			});
		});
		// If we were given a test provider, forward the test notifications on to
		// it as it won't receive the events normally because this is not a Code-spawned
		// debug session.
		if (testCoordinator) {
			this.on("dart.testNotification", (e: DebugSessionCustomEvent) => testCoordinator.handleDebugSessionCustomEvent(this.currentSession!.id, this.currentSession!.configuration.dartCodeDebugSessionID as string | undefined, e.event, e.body));
			this.on("terminated", (e: DebugProtocol.TerminatedEvent) => testCoordinator.handleDebugSessionEnd(this.currentSession!.id, this.currentSession!.configuration.dartCodeDebugSessionID as string | undefined));
		}
	}

	public send(command: string, args?: any): Promise<any> {
		for (const tracker of this.currentTrackers) {
			if (tracker.onWillReceiveMessage)
				tracker.onWillReceiveMessage({ command, arguments: args });
		}
		return super.send(command, args);
	}

	public start(port?: number): Promise<void> {
		this.hasStarted = true;
		if (port)
			throw new Error("Do not provide a port to DartDebugClient.start!");
		return super.start(this.port);
	}

	private sendResponse(request: DebugProtocol.Request, body: any): void {
		// Hack: Underlyung class doesn't have response support.
		const me = (this as unknown as { outputStream: Writable, sequence: number });

		const response: DebugProtocol.Response = {
			body,
			command: request.command,
			// eslint-disable-next-line camelcase
			request_seq: request.seq,
			seq: me.sequence++,
			success: true,
			type: "response",
		};

		const json = JSON.stringify(response);
		me.outputStream.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`, "utf8");
	}

	private handleCustomEvent(e: DebugSessionCustomEvent) {
		this.debugCommands.handleDebugSessionCustomEvent({
			body: e.body,
			event: e.event,
			session: this.currentSession!,
		});
	}

	public async launch(launchArgs: DartVsCodeLaunchArgs & DebugProtocol.LaunchRequestArguments): Promise<void> {
		// The new DAP doesn't default to breaking on any exceptions so to simplify tests
		// set it based on whether we'd in debug mode or not.
		const isDebugging = !(launchArgs.noDebug ?? false);
		if (isDebugging)
			await this.setExceptionBreakpointsRequest({ filters: ["Unhandled"] });
		const configuration = Object.assign(
			{
				name: "Dart & Flutter",
				request: "launch",
				type: "dart",
			},
			launchArgs,
		);
		const currentSession = this.currentSession = {
			configuration,
			customRequest: async (cmd, args) => (await this.customRequest(cmd, args)).body,
			getDebugProtocolBreakpoint: () => { throw new Error("Not implemented for tests"); },
			id: `INTEGRATION-TEST-${getRandomInt(0x1000, 0x10000).toString(16)}`,
			name: configuration.name,
			type: configuration.type,
			workspaceFolder: undefined,
		};

		// Set up logging.
		for (const trackerFactory of this.debugTrackerFactories) {
			const tracker = (await trackerFactory.createDebugAdapterTracker(currentSession))!;
			this.currentTrackers.push(tracker);
			if (tracker.onWillStartSession)
				tracker.onWillStartSession();
		}
		this.on("terminated", (e: DebugProtocol.TerminatedEvent) => {
			for (const tracker of this.currentTrackers) {
				if (tracker.onWillStopSession)
					tracker.onWillStopSession();
			}
		});

		this.debugCommands.handleDebugSessionStart(currentSession);
		this.waitForEvent("terminated", "for handleDebugSessionEnd", tenMinutesInMs)
			.then(() => {
				this.debugCommands.handleDebugSessionEnd(currentSession);
				extApi.testController.handleDebugSessionEnd(currentSession);
			})
			.catch((e) => console.error(`Error while waiting for termination: ${e}`));

		// We override the base method to swap for attachRequest when required, so that
		// all the existing methods that provide useful functionality but assume launching
		// (for ex. hitBreakpoint) can be used in attach tests.
		const response = await watchPromise("launch->initializeRequest", this.initializeRequest());
		if (response.body && response.body.supportsConfigurationDoneRequest) {
			this._supportsConfigurationDoneRequest = true;
		}
		// Attach will be paused by default and issue a step when we connect; but our tests
		// generally assume we will automatically resume.
		if (launchArgs.request === "attach" && (this.isDartDap || launchArgs.deviceId !== "flutter-tester")) {
			logger.info("Attaching to process...");
			const stoppedEvent = watchPromise("launch->attach->waitForEvent:stopped", this.waitForEvent("stopped", "waiting for stop event on attach to paused"));
			await watchPromise("launch->attach->attachRequest", this.attachRequest(launchArgs));
			logger.info("Waiting for stopped (step/entry) event...");
			const event = await stoppedEvent;
			// Allow either step (old DC DA) or entry (SDK DA).
			if (event.body.reason !== "step")
				assert.equal(event.body.reason, "entry");
			// HACK: Put a fake delay in after attachRequest to ensure isolates become runnable and breakpoints are transmitted
			// This should help fix the tests so we can be sure they're otherwise good, before we fix this properly.
			// https://github.com/Dart-Code/Dart-Code/issues/911
			await new Promise((resolve) => setTimeout(resolve, 1000));
			// It's possible the resume will never return because the process will terminate as soon as it starts resuming
			// so we will assume that if we get a terminate the resume worked.
			logger.info("Resuming and waiting for success or terminate...");
			await watchPromise(
				"launch()->attach->terminate/resume",
				Promise.race([
					this.waitForEvent("terminated", "waiting for termination or resume completion")
						.catch(() => {
							// Swallow errors, we're only using this to avoid waiting on a resume response forever.
							// It's possible it'll time out after some period because the test finished more quickly/slowly.
						}),
					this.resume(),
				]),
			);
		} else if (launchArgs.request === "attach") {
			// For Flutter, we don't need all the crazy stuff above, just issue a standard
			// attach request.
			logger.info("Attaching to flutter-tester process...");
			await watchPromise("launch->attach->attachRequest", this.attachRequest(launchArgs));
		} else {
			await watchPromise("launch()->launchRequest", this.launchRequest(launchArgs));
		}
	}

	public setBreakpointWithoutHitting(launchArgs: any, location: ILocation, expectedBPLocation?: IPartialLocation): Promise<any> {
		return this.hitBreakpoint(launchArgs, location, undefined, expectedBPLocation, true);
	}

	public async getMainThread(): Promise<DebugProtocol.Thread> {
		// For tests, we can assume the last thread is the "main" one, as dartdev, pub etc. will all
		// be spawned first.
		const threadsResponse = await this.threadsRequest();
		const threads = threadsResponse.body.threads;
		return threads[threads.length - 1];
	}

	public async resume(): Promise<DebugProtocol.ContinueResponse> {
		const thread = await this.getMainThread();
		return this.continueRequest({ threadId: thread.id });
	}

	public async stepIn(): Promise<DebugProtocol.StepInResponse> {
		const thread = await this.getMainThread();
		return this.stepInRequest({ threadId: thread.id });
	}

	public async getStack(startFrame?: number, levels?: number): Promise<DebugProtocol.StackTraceResponse> {
		const thread = await this.getMainThread();
		return this.stackTraceRequest({ threadId: thread.id, startFrame, levels });
	}

	public async getTopFrameVariables(scope: "Exceptions" | "Locals"): Promise<DebugProtocol.Variable[]> {
		const stack = await this.getStack();
		const scopes = await this.scopesRequest({ frameId: stack.body.stackFrames[0].id });
		const s = scopes.body.scopes.find((s) => s.name === scope);
		assert.ok(s);
		return this.getVariables(s.variablesReference);
	}

	public async getVariables(variablesReference: number): Promise<DebugProtocol.Variable[]> {
		const variables = await this.variablesRequest({ variablesReference });
		return variables.body.variables;
	}

	public async evaluateForFrame(expression: string, context?: string): Promise<{
		result: string;
		type?: string;
		variablesReference: number;
		namedVariables?: number;
		indexedVariables?: number;
	}> {
		const thread = await this.getMainThread();
		const stack = await this.stackTraceRequest({ threadId: thread.id });
		const result = await this.evaluateRequest({ expression, frameId: stack.body.stackFrames[0].id, context });
		return result.body;
	}

	public assertOutputContains(category: string | undefined, text: string): Promise<DebugProtocol.OutputEvent> {
		let output = "";
		let cleanup = () => { }; // tslint:disable-line: no-empty
		const textLF = text.replace(/\r/g, "");
		const textCRLF = textLF.replace(/\n/g, "\r\n");
		return withTimeout(
			new Promise<DebugProtocol.OutputEvent>((resolve) => {
				function handleOutput(event: DebugProtocol.OutputEvent) {
					if (!category || (event.body.category ?? "console" === category)) {
						output += event.body.output;
						if (output.includes(textLF) || output.includes(textCRLF)) {
							resolve(event);
						}
					}
				}
				cleanup = () => this.removeListener("output", handleOutput);
				this.on("output", handleOutput);
			}),
			() => `Didn't find text "${text}" in ${category}\nGot: ${output}`,
		).finally(() => cleanup());
	}

	public async debuggerReady(): Promise<void> {
		await this.waitForCustomEvent("dart.debuggerUris");
		await delay(100);
	}

	public async flutterAppStarted(): Promise<void> {
		await this.waitForCustomEvent("flutter.appStarted");
		await delay(100);
	}

	public waitForCustomEvent<T>(type: string, filter?: (notification: T) => boolean): Promise<T> {
		return new Promise((resolve, reject) => {
			setTimeout(
				() => {
					reject(new Error(`No customEvent '${type}' matching ${filter} received after ${this.defaultTimeout} ms`));
				},
				this.defaultTimeout,
			);
			const handler = (event: DebugProtocol.Event) => {
				try {
					const notification = event.body as T;
					if (!filter || filter(notification)) {
						this.removeListener(type, handler);
						resolve(notification);
					}
				} catch (e) {
					this.removeListener(type, handler);
					reject(e);
				}
			};
			this.on(type, handler);
			this.on("terminated", () => this.removeListener(type, handler));
		});
	}

	public async waitForTestNotification<T extends Notification>(type: string, filter: (notification: T) => boolean): Promise<void> {
		await this.waitForCustomEvent<T>(
			"dart.testNotification",
			(event) => event.type === type && filter(event),
		);
	}
	public async tryWaitUntilGlobalEvaluationIsAvailable(): Promise<void> {
		// We can't evaluate until the main thread is runnable (which there's no event for) so
		// just retry for a short period until it works (or times out).
		await waitFor(() => this.evaluateRequest({ expression: `"test"` }).then(() => true, () => false));
	}

	private assertTestStatus(testName: string, expectedStatus: "success" | "failure" | "error"): Promise<void> {
		let test: Test;
		return Promise.all([
			this.waitForTestNotification<TestStartNotification>(
				"testStart",
				(e) => {
					if (e.test.name === testName) {
						test = e.test;
						return true;
					} else {
						return false;
					}
				},
			),
			this.waitForTestNotification<TestDoneNotification>(
				"testDone",
				(e) => {
					if (test && e.testID === test.id) {
						assert.equal(e.result, expectedStatus, `Test ${test.name} result was not as expected`);
						return true;
					} else {
						return false;
					}
				},
			),
		]).then(() => undefined);
	}

	public assertPassingTest(testName: string) {
		return this.assertTestStatus(testName, "success");
	}

	public assertFailingTest(testName: string) {
		return this.assertTestStatus(testName, "failure");
	}

	public assertErroringTest(testName: string) {
		return this.assertTestStatus(testName, "error");
	}

	public async waitForHotReload(): Promise<void> {
		// We might get the text in either stderr or stdout depending on
		// whether an error occurred during reassemble.
		await Promise.race([
			this.assertOutputContains("stdout", "Reloaded"),
			this.assertOutputContains("stderr", "Reloaded"),
			// TODO: Remove these two when web isn't doing restarts for reloads.
			this.assertOutputContains("stdout", "Restarted"),
			this.assertOutputContains("stderr", "Restarted"),
		]);
	}

	public async hotReload(): Promise<void> {
		// If we reload too fast, things fail :-/
		await delay(500);

		await Promise.all([
			this.waitForHotReload(),
			this.customRequest("hotReload"),
		]);
	}
}
