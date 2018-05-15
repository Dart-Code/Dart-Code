import * as assert from "assert";
import { DebugProtocol } from "vscode-debugprotocol";
import { DebugClient } from "./debug_client_ms";

export class DartDebugClient extends DebugClient {
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
			await this.attachRequest(launchArgs);
			await this.waitForEvent("stopped");
			await this.resume();
		} else {
			await this.launchRequest(launchArgs);
		}
	}

	public async getMainThread(): Promise<DebugProtocol.Thread> {
		const threads = await this.threadsRequest();
		assert.equal(threads.body.threads.length, 1);
		return threads.body.threads[0];
	}

	public async resume(): Promise<DebugProtocol.ContinueResponse> {
		const thread = await this.getMainThread();
		return this.continueRequest({ threadId: thread.id });
	}

	public async stepIn(): Promise<DebugProtocol.StepInResponse> {
		const thread = await this.getMainThread();
		return this.stepInRequest({ threadId: thread.id });
	}

	public async getTopFrameVariables(scope: "Exception" | "Locals"): Promise<DebugProtocol.Variable[]> {
		const thread = await this.getMainThread();
		const stack = await this.stackTraceRequest({ threadId: thread.id });
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
		return new Promise((resolve, reject) => this.on("output", (event: DebugProtocol.OutputEvent) => {
			if (event.body.category === category) {
				if (event.body.output.indexOf(text) !== -1)
					resolve();
				else
					reject(new Error(`Didn't find text "${text}" in ${category}`));
			}
		}));
	}
}
