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
	}
}
