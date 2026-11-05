import { DebugProtocol } from "@vscode/debugprotocol";
import * as vs from "vscode";

/**
 * Forces `supportsANSIStyling` on in the server capabilities because VS Code now requires this and
 * it will take a while for the change to ship in the SDK adapters.
 *
 * See https://github.com/Dart-Code/Dart-Code/issues/5302 and https://github.com/microsoft/vscode/pull/227729.
 */
export class DartDebugForcedAnsiColorSupportFactory implements vs.DebugAdapterTrackerFactory {
	createDebugAdapterTracker(): vs.DebugAdapterTracker {
		return new DartDebugForcedAnsiColorSupport();
	}
}

/**
 * Forces `supportsANSIStyling` on in the server capabilities because VS Code now requires this and
 * it will take a while for the change to ship in the SDK adapters.
 *
 * See https://github.com/Dart-Code/Dart-Code/issues/5302 and https://github.com/microsoft/vscode/pull/227729.
 */
class DartDebugForcedAnsiColorSupport implements vs.DebugAdapterTracker {
	onDidSendMessage(message: unknown): void {
		if (message && typeof message === "object" && "command" in message && message.command === "initialize" && "type" in message && message.type === "response") {
			const response = message as DebugProtocol.InitializeResponse;
			if (response.body && response.body.supportsANSIStyling === undefined)
				response.body.supportsANSIStyling = true;
		}
	}
}
