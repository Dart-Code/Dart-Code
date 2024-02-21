import { DebugAdapterTracker, DebugAdapterTrackerFactory, DebugSession, ProgressLocation, window } from "vscode";
import { PromiseCompleter } from "../../shared/utils";

export class DartDebugAdapterLaunchStatusFactory implements DebugAdapterTrackerFactory {
	createDebugAdapterTracker(session: DebugSession): DebugAdapterTracker {
		return new DartDebugAdapterLaunchStatus();
	}
}

class DartDebugAdapterLaunchStatus implements DebugAdapterTracker {
	private readonly completer = new PromiseCompleter<void>();

	private startProgress() {
		void window.withProgress(
			{
				cancellable: false,
				location: ProgressLocation.Notification,
				title: "Starting debug session…",
			},
			() => this.completer.promise,
		);
	}

	private endProgress() {
		this.completer.resolve();
	}

	public onWillStartSession(): void {
		this.startProgress();
	}

	public onDidSendMessage(message: any): void {
		this.endProgress();
	}

	public onWillStopSession(): void {
		this.endProgress();
	}

	public onExit(code: number | undefined, signal: string | undefined): void {
		this.endProgress();
	}
}
