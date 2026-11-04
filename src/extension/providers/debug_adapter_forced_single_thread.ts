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
		const event = message as DebugProtocol.ContinuedEvent | DebugProtocol.StoppedEvent | undefined;
		if (event?.type === "event" && event.body) {
			if (event.event === "continued" && (event as DebugProtocol.ContinuedEvent).body.allThreadsContinued === undefined)
				(event as DebugProtocol.ContinuedEvent).body.allThreadsContinued = false;
			if (event.event === "stopped" && (event as DebugProtocol.StoppedEvent).body.allThreadsStopped === undefined)
				(event as DebugProtocol.StoppedEvent).body.allThreadsStopped = false;
		}
	}
}
