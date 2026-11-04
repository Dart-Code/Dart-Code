import { DebugProtocol } from "@vscode/debugprotocol";
import * as vs from "vscode";

export class DartDebugAdapterRemoveErrorShowUserFactory implements vs.DebugAdapterTrackerFactory {
	createDebugAdapterTracker(): vs.DebugAdapterTracker {
		return new DartDebugAdapterRemoveErrorShowUser();
	}
}

class DartDebugAdapterRemoveErrorShowUser implements vs.DebugAdapterTracker {
	onDidSendMessage(message: unknown): void {
		// Strip any showUser flags so that we use the VS Code default. The behaviour of this
		// flag is not currently well defined and the DAP is sending showUser=true but that
		// can result in additional prompts to users:
		// - https://github.com/Dart-Code/Dart-Code/issues/4930
		// - https://github.com/google/go-dap/issues/87
		// - https://github.com/microsoft/vscode/issues/180488
		const response = message as DebugProtocol.ErrorResponse | undefined;
		if (response?.success === false && response?.body?.error?.showUser !== undefined) {
			response.body.error.showUser = undefined;
		}
	}
}
