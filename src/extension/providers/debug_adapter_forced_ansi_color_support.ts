import * as vs from "vscode";

/**
 * Forces `supportsANSIStyling` on in the server capabilities because VS Code now requires this and
 * it will take a while for the change to ship in the SDK adapters.
 *
 * See https://github.com/Dart-Code/Dart-Code/issues/5302 and https://github.com/microsoft/vscode/pull/227729.
 */
export class DartDebugForcedAnsiColorSupportFactory implements vs.DebugAdapterTrackerFactory {
	createDebugAdapterTracker(session: vs.DebugSession): vs.DebugAdapterTracker | undefined {
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
	onDidSendMessage(message: any): void {
		if (message && message.command === "initialize" && message.type === "response" && message.body && message.body.supportsANSIStyling === undefined)
			message.body.supportsANSIStyling = true;
	}
}
