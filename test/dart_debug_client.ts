import * as assert from "assert";
import { SpawnOptions } from "child_process";
import { DebugSessionCustomEvent } from "vscode";
import { DebugProtocol } from "vscode-debugprotocol";
import { debugLogTypes, handleDebugLogEvent, log } from "../src/utils/log";
import { Notification, Test, TestDoneNotification, TestStartNotification } from "../src/views/test_protocol";
import { DebugClient } from "./debug_client_ms";
import { withTimeout } from "./helpers";

export class DartDebugClient extends DebugClient {
	constructor(runtime: string, executable: string, debugType: string, spwanOptions?: SpawnOptions) {
		super(runtime, executable, debugType, spwanOptions);
		Object.keys(debugLogTypes).forEach((event) => {
			this.on(event, (e: DebugSessionCustomEvent) => handleDebugLogEvent(e.event, e.body.message));
		});
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
	}
	public async launch(launchArgs: any): Promise<void> {
		// We override the base method to swap for attachRequest when required, so that
		// all the existing methods that provide useful functionality but assume launching
		// (for ex. hitBreakpoint) can be used in attach tests.
		const response = await this.initializeRequest();
		if (response.body && response.body.supportsConfigurationDoneRequest) {
			this._supportsConfigurationDoneRequest = true;
		}
		if (launchArgs.request === "attach") {
			// Attach will be paused by default and issue a step when we connect; but our tests
			// generally assume we will automatically resume.
			log("Attaching to process...");
			await this.attachRequest(launchArgs);
			log("Waiting for stopped (step) event...");
			const event = await this.waitForEvent("stopped");
			assert.equal(event.body.reason, "step");
			// HACK: Put a fake delay in after attachRequest to ensure isolates become runnable and breakpoints are transmitted
			// This should help fix the tests so we can be sure they're otherwise good, before we fix this properly.
			// https://github.com/Dart-Code/Dart-Code/issues/911
			await new Promise((resolve) => setTimeout(resolve, 1000));
			// It's possible the resume will never return because the process will terminate as soon as it starts resuming
			// so we will assume that if we get a terminate the resume worked.
			log("Resuming and waiting for success or terminate...");
			await Promise.race([
				this.waitForEvent("terminated").then((_) => log("Terminated!")),
				this.resume().then((_) => log("Resumed!")),
			]);
		} else {
			await this.launchRequest(launchArgs);
		}
	}

	public async getMainThread(): Promise<DebugProtocol.Thread> {
		// HACK: Take the first thread that doesn't look like pub/test.
		const threads = await this.threadsRequest();
		const userThreads = threads.body.threads
			.filter((t) => !t.name.startsWith("pub.dart.snapshot") && !t.name.startsWith("test.dart.snapshot"));
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
		return this.getVariables(exceptionScope.variablesReference);
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

	public assertOutputContains(category: string, text: string) {
		let output = "";
		return withTimeout(
			new Promise((resolve, reject) => this.on("output", (event: DebugProtocol.OutputEvent) => {
				if (event.body.category === category) {
					output += event.body.output;
					if (output.indexOf(text) !== -1)
						resolve();
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
			this.on(type, (event: DebugProtocol.Event) => {
				try {
					const notification = event.body as T;
					if (filter(notification))
						resolve(notification);
				} catch (e) {
					reject(e);
				}
			});
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
		]).then((_) => null);
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
}
