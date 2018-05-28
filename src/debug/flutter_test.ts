import { Disposable } from "vscode";
import { StdIOService } from "../services/stdio_service";
import { globalFlutterArgs } from "./utils";

export class FlutterTest extends StdIOService<{ type: string }> {
	constructor(flutterBinPath: string, projectFolder: string, args: string[], logFile: string, logger: (message: string) => void) {
		super(() => logFile, logger, true, true);

		this.createProcess(projectFolder, flutterBinPath, globalFlutterArgs.concat(["test", "--machine"]).concat(args));
	}

	protected shouldHandleMessage(message: string): boolean {
		// Everything in flutter is wrapped in [] so we can tell what to handle.
		return (message.startsWith("{") && message.endsWith("}"))
			|| (message.startsWith("[") && message.endsWith("]"));
	}
	protected isNotification(msg: any): boolean { return !!(msg.type || msg.event); }
	protected isResponse(msg: any): boolean { return false; }

	protected processUnhandledMessage(message: string): void {
		this.notify(this.unhandledMessageSubscriptions, message);
	}

	private unhandledMessageSubscriptions: Array<(notification: string) => void> = [];
	public registerForUnhandledMessages(subscriber: (notification: string) => void): Disposable {
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

	public registerForTestStartedProcess(subscriber: (notification: TestStartedProcess) => void): Disposable {
		return this.subscribe(this.testStartedProcessSubscriptions, subscriber);
	}

	public registerForAllTestNotifications(subscriber: (notification: { type: string }) => void): Disposable {
		return this.subscribe(this.allTestNotificationsSubscriptions, subscriber);
	}
}

export interface TestStartedProcess {
	observatoryUri: string;
}
