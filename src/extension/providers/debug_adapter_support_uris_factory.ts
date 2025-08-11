import * as vs from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";

export class DartDebugAdapterSupportsUrisFactory implements vs.DebugAdapterTrackerFactory {
	constructor(private readonly dartCapabilities: DartCapabilities) { }

	createDebugAdapterTracker(): vs.DebugAdapterTracker {
		return new DartDebugAdapterSupportsUris(this.dartCapabilities);
	}
}

class DartDebugAdapterSupportsUris implements vs.DebugAdapterTracker {
	constructor(private readonly dartCapabilities: DartCapabilities) { }

	onWillReceiveMessage(message: any): void {
		if (message?.command === "initialize" && message.arguments && this.dartCapabilities.supportsMacroGeneratedFiles) {
			message.arguments.supportsDartUris = true;
		}
	}
}
