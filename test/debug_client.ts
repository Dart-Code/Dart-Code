import { DebugProtocol } from "vscode-debugprotocol";
import { DebugClient } from "./debug_client_ms";

export class DartDebugClient extends DebugClient {
	public launch(launchArgs: any): Promise<DebugProtocol.LaunchResponse> {
		if (launchArgs.request === "attach")
			throw new Error("Cannot call launch with an attach config");
		return super.launch(launchArgs);
	}
}
