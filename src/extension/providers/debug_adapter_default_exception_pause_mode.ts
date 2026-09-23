import * as vs from "vscode";
import { config } from "../config";

export class DartDebugDefaultExceptionPauseModeFactory implements vs.DebugAdapterTrackerFactory {
	createDebugAdapterTracker(): vs.DebugAdapterTracker {
		return new DartDebugDefaultExceptionPauseModeSupport();
	}
}

class DartDebugDefaultExceptionPauseModeSupport implements vs.DebugAdapterTracker {
	onDidSendMessage(message: any): void {
		if (message?.command === "initialize" && message.type === "response" && message.body && Array.isArray(message.body.exceptionBreakpointFilters)) {
			// Only tick All if it was explicitly set.
			const allExceptionsDefault = config.defaultExceptionPauseMode === "all";
			// Unhandled is always ticked unless we got None (it's also ticked for
			// all, and for unknown values).
			const unhandledExceptionsDefault = config.defaultExceptionPauseMode !== "none";

			for (const filter of message.body.exceptionBreakpointFilters) {
				if (filter.filter === "All")
					filter.default = allExceptionsDefault;
				else if (filter.filter === "Unhandled")
					filter.default = unhandledExceptionsDefault;
			}
		}
	}
}
