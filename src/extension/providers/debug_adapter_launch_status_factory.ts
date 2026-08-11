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
		if (this.completer.isComplete)
			return;

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
		// Delay showing for 1s so we don't show for short launches because the notification
		// appearing and disappearing can be quite noisy.
		// https://github.com/Dart-Code/Dart-Code/issues/5682
		setTimeout(() => this.startProgress(), 1000);
	}

	public onDidSendMessage(_message: any): void {
		// Things that trigger hiding the progress status:
		// - launch response
		// - Output events
		// - Progress events
		// - Any test being discovered / starting

		const command: string | undefined = _message?.command;
		const event: string | undefined = _message?.event;
		const body: unknown = _message?.body;
		const stopProgress =
			command === "launch"
			|| event === "output"
			|| event?.startsWith("dart.progress")
			|| (event?.startsWith("dart.testNotification") && body && typeof body === "object" && "test" in body);

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
