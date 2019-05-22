import { StdIOService } from "../services/stdio_service";
import { IAmDisposable, LogSeverity } from "./utils";

export class TestRunner extends StdIOService<{ type: string }> {
	constructor(executable: string, projectFolder: string | undefined, args: string[], envOverrides: any, logFile: string, logger: (message: string, severity: LogSeverity) => void, maxLogLineLength: number) {
		super(() => logFile, logger, maxLogLineLength, true, true);

		this.createProcess(projectFolder, executable, args, envOverrides);
	}

	protected shouldHandleMessage(message: string): boolean {
		return (message.startsWith("{") && message.endsWith("}"))
			|| (message.startsWith("[{") && message.endsWith("}]"));
	}
	protected isNotification(msg: any): boolean { return !!(msg.type || msg.event); }
	protected isResponse(msg: any): boolean { return false; }

	protected processUnhandledMessage(message: string): void {
		this.notify(this.unhandledMessageSubscriptions, message);
	}

	private unhandledMessageSubscriptions: Array<(notification: string) => void> = [];
	public registerForUnhandledMessages(subscriber: (notification: string) => void): IAmDisposable {
		return this.subscribe(this.unhandledMessageSubscriptions, subscriber);
	}

	protected handleNotification(evt: any) {
		// console.log(JSON.stringify(evt));
		switch (evt.event) {
			case "test.startedProcess":
				this.notify(this.testStartedProcessSubscriptions, evt.params as TestStartedProcess);
				break;
		}

		// Send all events to the editor.
		this.notify(this.allTestNotificationsSubscriptions, evt);
	}

	// Subscription lists.

	private testStartedProcessSubscriptions: Array<(notification: TestStartedProcess) => void> = [];
	private allTestNotificationsSubscriptions: Array<(notification: any) => void> = [];

	// Subscription methods.

	public registerForTestStartedProcess(subscriber: (notification: TestStartedProcess) => void): IAmDisposable {
		return this.subscribe(this.testStartedProcessSubscriptions, subscriber);
	}

	public registerForAllTestNotifications(subscriber: (notification: { type: string }) => void): IAmDisposable {
		return this.subscribe(this.allTestNotificationsSubscriptions, subscriber);
	}
}

export interface TestStartedProcess {
	observatoryUri: string;
}
