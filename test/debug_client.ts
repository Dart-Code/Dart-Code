import { DebugProtocol } from "vscode-debugprotocol";
import { DebugClient } from "./debug_client_ms";

export class DartDebugClient extends DebugClient {
	public async launch(launchArgs: any): Promise<DebugProtocol.LaunchResponse> {
		// We override the base method to swap for attachRequest when required, so that
		// all the existing methods that provide useful functionality but assume launching
		// (for ex. hitBreakpoint) can be used in attach tests.
		const response = await this.initializeRequest();
		if (response.body && response.body.supportsConfigurationDoneRequest) {
			this._supportsConfigurationDoneRequest = true;
		}
		if (launchArgs.request === "attach") {
			return this.attachRequest(launchArgs);
		} else {
			return this.launchRequest(launchArgs);
		}
	}
}
