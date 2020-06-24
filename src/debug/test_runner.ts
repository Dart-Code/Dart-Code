import { IAmDisposable, Logger } from "../shared/interfaces";
import { StdIOService } from "../shared/services/stdio_service";

export class TestRunner extends StdIOService<{ type: string }> {
	constructor(executable: string, projectFolder: string | undefined, args: string[], env: { envOverrides?: { [key: string]: string | undefined }, toolEnv: {} }, logFile: string | undefined, logger: Logger, maxLogLineLength: number) {
		super(logger, maxLogLineLength, true, true, logFile);

		this.createProcess(projectFolder, executable, args, env);
	}

	protected shouldHandleMessage(message: string): boolean {
		return (message.startsWith("{") && message.endsWith("}"))
			|| (message.startsWith("[{") && message.endsWith("}]"));
	}
	protected isNotification(msg: any): boolean { return !!(msg.type || msg.event); }
	protected isResponse(msg: any): boolean { return false; }

	protected async processUnhandledMessage(message: string): Promise<void> {
		await this.notify(this.unhandledMessageSubscriptions, message);
	}

	private unhandledMessageSubscriptions: Array<(notification: string) => void> = [];
	public registerForUnhandledMessages(subscriber: (notification: string) => void): IAmDisposable {
		return this.subscribe(this.unhandledMessageSubscriptions, subscriber);
	}

	protected async handleNotification(evt: any): Promise<void> {
		// console.log(JSON.stringify(evt));
		switch (evt.event) {
			case "test.startedProcess":
				await this.notify(this.testStartedProcessSubscriptions, evt.params as TestStartedProcess);
				break;
		}

		// Send all events to the editor.
		await this.notify(this.allTestNotificationsSubscriptions, evt);
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
