import * as vs from "vscode";

/**
 * Forces `allThreadsContinued=false` on `continued` events as a workaround until shipped in the DA.
 *
 * See https://github.com/Dart-Code/Dart-Code/issues/5252 and https://github.com/microsoft/vscode/issues/224832.
 */
export class DartDebugForcedSingleThreadContinueFactory implements vs.DebugAdapterTrackerFactory {
	createDebugAdapterTracker(session: vs.DebugSession): vs.DebugAdapterTracker | undefined {
		return new DartDebugForcedSingleThreadContinue();
	}
}

/**
 * Forces `allThreadsContinued=false` on `continued` events as a workaround until shipped in the DA.
 *
 * See https://github.com/Dart-Code/Dart-Code/issues/5252 and https://github.com/microsoft/vscode/issues/224832.
 */
class DartDebugForcedSingleThreadContinue implements vs.DebugAdapterTracker {
	onDidSendMessage(message: any): void {
		if (message && message.event === "continued" && message.type === "event" && message.body && message.body.allThreadsContinued === undefined)
			message.body.allThreadsContinued = false;
	}
}
