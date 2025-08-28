import { DebugAdapterTracker, DebugAdapterTrackerFactory, ProgressLocation, window } from "vscode";
import { PromiseCompleter } from "../../shared/utils";

export class DartDebugAdapterLaunchStatusFactory implements DebugAdapterTrackerFactory {
	createDebugAdapterTracker(): DebugAdapterTracker {
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

	public onDidSendMessage(_message: any): void {
		// Things that trigger hiding the progress status:
		// - Output events
		// - Progress events

		const event: string | undefined = _message?.event;
		const stopProgress = event === "output" || event?.startsWith("dart.progress");

		if (stopProgress)
			this.endProgress();
	}

	public onWillStopSession(): void {
		this.endProgress();
	}

	public onExit(): void {
		this.endProgress();
	}
}
