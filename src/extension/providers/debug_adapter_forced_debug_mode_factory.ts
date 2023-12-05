import * as vs from "vscode";
import { DartLaunchArgs } from "../../shared/debug/interfaces";

/**
 * Forces debug mode in the launchRequest if the 'forceDisableDebugging' flag was set by the debug config provider.
 *
 * This enables functionality like the widget inspectors ToolEvent navigation.
 *
 * See https://github.com/Dart-Code/Dart-Code/issues/4878.
 */
export class DartDebugForcedDebugModeFactory implements vs.DebugAdapterTrackerFactory {
	createDebugAdapterTracker(session: vs.DebugSession): vs.DebugAdapterTracker | undefined {
		// Only set up the forced debug mode if this magic flag was set (in debug_config_provider).
		// Checking capabilities etc. is done there, not here.
		if ((session.configuration as DartLaunchArgs).forceEnableDebugging) {
			return new DartDebugForcedDebugMode(this, session);
		}

		return undefined;
	}
}

/**
 * Forces debug mode in the launchRequest so that the debug adapter sets up a connection to the VM Service.
 *
 * This enables functionality like the widget inspectors ToolEvent navigation.
 *
 * See https://github.com/Dart-Code/Dart-Code/issues/4878.
 */
class DartDebugForcedDebugMode implements vs.DebugAdapterTracker {
	constructor(private readonly factory: DartDebugForcedDebugModeFactory, private readonly session: vs.DebugSession) {
	}

	onWillReceiveMessage(message: any): void {
		if (message.command === "launch") {
			message.arguments.noDebug = undefined;
		}
	}
}
