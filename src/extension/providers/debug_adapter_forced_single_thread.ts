import { DebugProtocol } from "@vscode/debugprotocol";
import * as vs from "vscode";

/**
 * Forces `allThreadsContinued=false` on `continued` events and `allThreadsStopped=false` on `stopped` events
 * as a workaround until shipped in the DA (and then for older SDK versions!).
 *
 * See https://github.com/Dart-Code/Dart-Code/issues/5252 and https://github.com/microsoft/vscode/issues/224832.
 */
export class DartDebugForcedSingleThreadFactory implements vs.DebugAdapterTrackerFactory {
	createDebugAdapterTracker(): vs.DebugAdapterTracker {
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
	onDidSendMessage(message: unknown): void {
		if (message && typeof message === "object" && "type" in message && message.type === "event" && "event" in message) {
			if (message.event === "continued") {
				const event = message as DebugProtocol.ContinuedEvent;
				if (event.body && event.body.allThreadsContinued === undefined)
					event.body.allThreadsContinued = false;
			} else if (message.event === "stopped") {
				const event = message as DebugProtocol.StoppedEvent;
				if (event.body && event.body.allThreadsStopped === undefined)
					event.body.allThreadsStopped = false;
			}
		}
	}
}
