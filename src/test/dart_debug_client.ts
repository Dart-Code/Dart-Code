import * as assert from "assert";
import { SpawnOptions } from "child_process";
import { DebugSession, DebugSessionCustomEvent } from "vscode";
import { DebugProtocol } from "vscode-debugprotocol";
import { debugSessions } from "../extension/commands/debug";
import { not } from "../extension/utils/array";
import { isKnownInfrastructureThread } from "../extension/utils/debugger";
import { log } from "../extension/utils/log";
import { DebugCommandHandler } from "../shared/interfaces";
import { Notification, Test, TestDoneNotification, TestStartNotification } from "../shared/test_protocol";
import { TestResultsProvider } from "../shared/vscode/interfaces";
import { DebugClient, ILocation, IPartialLocation } from "./debug_client_ms";
import { delay, watchPromise, withTimeout } from "./helpers";

const customEventsToForward = ["dart.log", "dart.serviceExtensionAdded", "dart.serviceRegistered", "dart.debuggerUris"];

export class DartDebugClient extends DebugClient {
	private currentSession: DebugSession;
	constructor(runtime: string, executable: string, debugType: string, spawnOptions: SpawnOptions, private debugCommands: DebugCommandHandler, testProvider: TestResultsProvider) {
		super(runtime, executable, debugType, spawnOptions);

		// Set up handlers for any custom events our tests may rely on (can't find
		// a way to just do them all 🤷‍♂️).
		customEventsToForward.forEach((evt) => this.on(evt, (e) => this.handleCustomEvent(e)));

		// Log important events to make troubleshooting tests easier.
		this.on("output", (event: DebugProtocol.OutputEvent) => {
			log(`[${event.body.category}] ${event.body.output}`);
		});
		this.on("terminated", (event: DebugProtocol.TerminatedEvent) => {
			log(`[terminated]`);
		});
		this.on("stopped", (event: DebugProtocol.StoppedEvent) => {
			log(`[stopped] ${event.body.reason}`);
		});
		this.on("initialized", (event: DebugProtocol.InitializedEvent) => {
			log(`[initialized]`);
		});
		// If we were given a test provider, forward the test notifications on to
		// it as it won't receive the events normally because this is not a Code-spawned
		// debug session.
		if (testProvider) {
			this.on("dart.testRunNotification", (e: DebugSessionCustomEvent) => testProvider.handleDebugSessionCustomEvent(e));
			this.on("terminated", (e: DebugProtocol.TerminatedEvent) => testProvider.handleDebugSessionEnd(this.currentSession));
		}
	}

	private handleCustomEvent(e: DebugSessionCustomEvent) {
		this.debugCommands.handleDebugSessionCustomEvent({
			body: e.body,
			event: e.event,
			session: this.currentSession,
		});
	}

	public async launch(launchArgs: any): Promise<void> {
		// Tests only run one debug session at a time so clear out any orphaned sessions (these
		// can happen if a session is forcefully terminated and the TerminateEvent is never received).
		debugSessions.length = 0;

		this.currentSession = {
			configuration: {
				name: "Dart & Flutter",
				request: "launch",
				type: "dart",
			},
			customRequest: (cmd, args) => this.customRequest(cmd, args),
			id: "INTEGRATION-TEST",
			name: "Dart & Flutter",
			type: "dart",
			workspaceFolder: undefined,
		};
		this.debugCommands.handleDebugSessionStart(this.currentSession);
		this.on("terminated", (e: DebugProtocol.TerminatedEvent) => this.debugCommands.handleDebugSessionEnd(this.currentSession));

		// We override the base method to swap for attachRequest when required, so that
		// all the existing methods that provide useful functionality but assume launching
		// (for ex. hitBreakpoint) can be used in attach tests.
		const response = await watchPromise("launch->initializeRequest", this.initializeRequest());
		if (response.body && response.body.supportsConfigurationDoneRequest) {
			this._supportsConfigurationDoneRequest = true;
		}
		// Attach will be paused by default and issue a step when we connect; but our tests
		// generally assume we will automatically resume.
		// TODO: For Flutter attach, the process isn't likely to be paused, so this code will
		// stall on the waitForEvent(stopped). As a workaround, just follow the launchRequest
		// path for Flutter tests, but we should probably come back and resolve these to work the
		// same and just push the unpause logic up into a test helper.
		if (launchArgs.request === "attach" && launchArgs.deviceId !== "flutter-tester") {
			log("Attaching to process...");
			await watchPromise("launch->attach->attachRequest", this.attachRequest(launchArgs));
			log("Waiting for stopped (step) event...");
			const event = await watchPromise("launch->attach->waitForEvent:stopped", this.waitForEvent("stopped"));
			assert.equal(event.body.reason, "step");
			// HACK: Put a fake delay in after attachRequest to ensure isolates become runnable and breakpoints are transmitted
			// This should help fix the tests so we can be sure they're otherwise good, before we fix this properly.
			// https://github.com/Dart-Code/Dart-Code/issues/911
			await new Promise((resolve) => setTimeout(resolve, 1000));
			// It's possible the resume will never return because the process will terminate as soon as it starts resuming
			// so we will assume that if we get a terminate the resume worked.
			log("Resuming and waiting for success or terminate...");
			await watchPromise(
				"launch()->attach->terminate/resume",
				Promise.race([
					this.waitForEvent("terminated"),
					this.resume(),
				]),
			);
		} else {
			await watchPromise("launch()->launchRequest", this.launchRequest(launchArgs));
		}
	}

	public setBreakpointWithoutHitting(launchArgs: any, location: ILocation, expectedBPLocation?: IPartialLocation): Promise<any> {
		return this.hitBreakpoint(launchArgs, location, undefined, expectedBPLocation, true);
	}

	public async getMainThread(): Promise<DebugProtocol.Thread> {
		// HACK: Take the first thread that doesn't look like pub/test.
		const threads = await this.threadsRequest();
		const userThreads = threads.body.threads.filter(not(isKnownInfrastructureThread));
		assert.equal(userThreads.length, 1);
		return userThreads[0];
	}

	public async resume(): Promise<DebugProtocol.ContinueResponse> {
		const thread = await this.getMainThread();
		return this.continueRequest({ threadId: thread.id });
	}

	public async stepIn(): Promise<DebugProtocol.StepInResponse> {
		const thread = await this.getMainThread();
		return this.stepInRequest({ threadId: thread.id });
	}

	public async getStack(): Promise<DebugProtocol.StackTraceResponse> {
		const thread = await this.getMainThread();
		return this.stackTraceRequest({ threadId: thread.id });
	}

	public async getTopFrameVariables(scope: "Exception" | "Locals"): Promise<DebugProtocol.Variable[]> {
		const stack = await this.getStack();
		const scopes = await this.scopesRequest({ frameId: stack.body.stackFrames[0].id });
		const exceptionScope = scopes.body.scopes.find((s) => s.name === scope);
		assert.ok(exceptionScope);
		return this.getVariables(exceptionScope!.variablesReference);
	}

	public async getVariables(variablesReference: number): Promise<DebugProtocol.Variable[]> {
		const variables = await this.variablesRequest({ variablesReference });
		return variables.body.variables;
	}

	public async evaluate(expression: string): Promise<{
		result: string;
		type?: string;
		variablesReference: number;
		namedVariables?: number;
		indexedVariables?: number;
	}> {
		const thread = await this.getMainThread();
		const stack = await this.stackTraceRequest({ threadId: thread.id });
		const result = await this.evaluateRequest({ expression, frameId: stack.body.stackFrames[0].id });
		return result.body;
	}

	public assertOutputContains(category: string, text: string): Promise<DebugProtocol.OutputEvent> {
		let output = "";
		return withTimeout(
			new Promise((resolve, reject) => this.on("output", (event: DebugProtocol.OutputEvent) => {
				if (event.body.category === category) {
					output += event.body.output;
					if (output.indexOf(text) !== -1)
						resolve(event);
				}
			})),
			() => `Didn't find text "${text}" in ${category}\nGot: ${output}`,
		);
	}

	public waitForCustomEvent<T>(type: string, filter: (notification: T) => boolean): Promise<T> {
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
					if (filter(notification)) {
						resolve(notification);
						this.removeListener(type, handler);
					}
				} catch (e) {
					reject(e);
					this.removeListener(type, handler);
				}
			};
			this.on(type, handler);
		});
	}

	public async waitForTestNotification<T extends Notification>(type: string, filter: (notification: T) => boolean): Promise<void> {
		await this.waitForCustomEvent<{ suitePath: string, notification: T }>(
			"dart.testRunNotification",
			(event) => event.notification.type === type && filter(event.notification as T),
		);
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
		]).then((_) => undefined);
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

	public async hotReload(): Promise<void> {
		// If we reload too fast, things fail :-/
		await delay(500);

		await Promise.all([
			this.assertOutputContains("stdout", "Reloaded"),
			this.customRequest("hotReload"),
		]);
	}
}
