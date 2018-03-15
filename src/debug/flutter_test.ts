import { StdIOService, Request, UnknownResponse, UnknownNotification } from "../services/stdio_service";
import { Disposable } from "vscode";
import { flutterEnv } from "./utils";

export class FlutterTest extends StdIOService<Notification> {
	constructor(flutterBinPath: string, projectFolder: string, args: string[], logFile: string) {
		super(logFile, true, true);

		this.createProcess(projectFolder, flutterBinPath, ["test", "--machine"].concat(args), flutterEnv);
	}

	protected shouldHandleMessage(message: string): boolean {
		// Everything in flutter is wrapped in [] so we can tell what to handle.
		return message.startsWith("{") && message.endsWith("}");
	}

	protected processUnhandledMessage(message: string): void {
		this.notify(this.unhandledMessageSubscriptions, message);
	}

	private unhandledMessageSubscriptions: Array<(notification: string) => void> = [];
	public registerForUnhandledMessages(subscriber: (notification: string) => void): Disposable {
		return this.subscribe(this.unhandledMessageSubscriptions, subscriber);
	}

	protected handleNotification(evt: Notification) {
		// console.log(JSON.stringify(evt));
		switch (evt.type) {
			case "start":
				this.notify(this.startSubscriptions, evt as StartNotification);
				break;
			case "allSuites":
				this.notify(this.allSuitesSubscriptions, evt as AllSuitesNotification);
				break;
			case "suite":
				this.notify(this.suiteSubscriptions, evt as SuiteNotification);
				break;
			case "testStart":
				this.notify(this.testStartSubscriptions, evt as TestStartNotification);
				break;
			case "testDone":
				this.notify(this.testDoneSubscriptions, evt as TestDoneNotification);
				break;
			case "group":
				this.notify(this.groupSubscriptions, evt as GroupNotification);
				break;
			case "done":
				this.notify(this.doneSubscriptions, evt as DoneNotification);
				break;
		}
	}

	// Subscription lists.

	private startSubscriptions: Array<(notification: StartNotification) => void> = [];
	private allSuitesSubscriptions: Array<(notification: AllSuitesNotification) => void> = [];
	private suiteSubscriptions: Array<(notification: SuiteNotification) => void> = [];
	private testStartSubscriptions: Array<(notification: TestStartNotification) => void> = [];
	private testDoneSubscriptions: Array<(notification: TestDoneNotification) => void> = [];
	private groupSubscriptions: Array<(notification: GroupNotification) => void> = [];
	private doneSubscriptions: Array<(notification: DoneNotification) => void> = [];

	// Subscription methods.

	public registerForStart(subscriber: (notification: StartNotification) => void): Disposable {
		return this.subscribe(this.startSubscriptions, subscriber);
	}

	public registerForAllSuites(subscriber: (notification: AllSuitesNotification) => void): Disposable {
		return this.subscribe(this.allSuitesSubscriptions, subscriber);
	}

	public registerForSuite(subscriber: (notification: SuiteNotification) => void): Disposable {
		return this.subscribe(this.suiteSubscriptions, subscriber);
	}

	public registerForTestStart(subscriber: (notification: TestStartNotification) => void): Disposable {
		return this.subscribe(this.testStartSubscriptions, subscriber);
	}

	public registerForTestDone(subscriber: (notification: TestDoneNotification) => void): Disposable {
		return this.subscribe(this.testDoneSubscriptions, subscriber);
	}

	public registerForGroup(subscriber: (notification: GroupNotification) => void): Disposable {
		return this.subscribe(this.groupSubscriptions, subscriber);
	}

	public registerForDone(subscriber: (notification: DoneNotification) => void): Disposable {
		return this.subscribe(this.doneSubscriptions, subscriber);
	}
}

interface Notification {
	type: string;
	time: number;
}

interface StartNotification extends Notification {
	protocolVersion: string;
	runnerVersion?: string;
}
interface AllSuitesNotification extends Notification {
	count: number;
}

interface SuiteNotification extends Notification {
	suite: Suite;
}

interface Suite {
	id: number;
	platform: string;
	path: string;
}

interface TestNotification extends Notification {
	test: Test;
}

interface Item {
	id: number;
	name?: string;
	suiteID: number;
	metadata: Metadata;
	line?: number;
	column?: number;
	url?: string;
}

interface Test extends Item {
	groupIDs: Group[];
}

interface Metadata {
	skip: boolean;
	skipReason?: string;
}

interface TestDoneNotification extends Notification {
	testID: number;
	result: string;
	skipped: boolean;
	hidden: boolean;
}

interface GroupNotification extends Notification {
	group: Group;
}

interface Group extends Item {
	parentID?: number;
	testCount: number;
}

interface TestStartNotification extends Notification {
	test: Test;
}

interface TestDoneNotification extends Notification {
	testID: number;
	result: string;
	skipped: boolean;
	hidden: boolean;
}

interface DoneNotification extends Notification {
	success: boolean;
}
