import * as vs from "vscode";

/**
 * Forces `allThreadsContinued=false` on `continued` events and `allThreadsStopped=false` on `stopped` events
 * as a workaround until shipped in the DA (and then for older SDK versions!).
 *
 * See https://github.com/Dart-Code/Dart-Code/issues/5252 and https://github.com/microsoft/vscode/issues/224832.
 */
export class DartDebugForcedSingleThreadFactory implements vs.DebugAdapterTrackerFactory {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	createDebugAdapterTracker(session: vs.DebugSession): vs.DebugAdapterTracker | undefined {
		return new DartDebugForcedSingleThread();
	}
}

/**
 * Forces `allThreadsContinued=false` on `continued` events and `allThreadsStopped=false` on `stopped` events
 * as a workaround until shipped in the DA (and then for older SDK versions!).
 *
 * See https://github.com/Dart-Code/Dart-Code/issues/5252 and https://github.com/microsoft/vscode/issues/224832.
 */
class DartDebugForcedSingleThread implements vs.DebugAdapterTracker {
	onDidSendMessage(message: any): void {
		if (message && message.type === "event" && message.body) {
			if (message.event === "continued" && message.body.allThreadsContinued === undefined)
				message.body.allThreadsContinued = false;
			if (message.event === "stopped" && message.body.allThreadsStopped === undefined)
				message.body.allThreadsStopped = false;
		}
	}
}
