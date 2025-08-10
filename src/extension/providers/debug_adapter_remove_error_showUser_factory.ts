import * as vs from "vscode";

export class DartDebugAdapterRemoveErrorShowUserFactory implements vs.DebugAdapterTrackerFactory {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	createDebugAdapterTracker(session: vs.DebugSession): vs.DebugAdapterTracker {
		return new DartDebugAdapterRemoveErrorShowUser();
	}
}

class DartDebugAdapterRemoveErrorShowUser implements vs.DebugAdapterTracker {
	onDidSendMessage(message: any): void {
		// Strip any showUser flags so that we use the VS Code default. The behaviour of this
		// flag is not currently well defined and the DAP is sending showUser=true but that
		// can result in additional prompts to users:
		// - https://github.com/Dart-Code/Dart-Code/issues/4930
		// - https://github.com/google/go-dap/issues/87
		// - https://github.com/microsoft/vscode/issues/180488
		if (message?.success === false && message?.body?.error && message?.body?.error?.showUser !== undefined) {
			message.body.error.showUser = undefined;
		}
	}
}
