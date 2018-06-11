import { Event, OutputEvent } from "vscode-debugadapter";
import { ErrorNotification, PrintNotification, TestDoneNotification, TestStartNotification } from "../views/test_protocol";
import { DartDebugSession } from "./dart_debug_impl";
import { FlutterTest } from "./flutter_test";
import { FlutterLaunchRequestArguments } from "./utils";

const tick = "✓";
const cross = "✖";

export class FlutterTestDebugSession extends DartDebugSession {
	protected args: FlutterLaunchRequestArguments;
	private flutter: FlutterTest;
	private observatoryUri: string;

	constructor() {
		super();

		this.sendStdOutToConsole = false;
	}

	protected spawnProcess(args: FlutterLaunchRequestArguments): any {
		const debug = !args.noDebug;
		let appArgs: string[] = [];

		if (debug) {
			appArgs.push("--start-paused");
		}

		if (args.args) {
			appArgs = appArgs.concat(args.args);
		}

		// TODO: Validate that args.program is always absolute (we use it as a key for notifications).
		appArgs.push(this.sourceFileForArgs(args));

		const logger = (message: string) => this.sendEvent(new Event("dart.log.flutter.test", { message }));
		this.flutter = new FlutterTest(args.flutterPath, args.cwd, appArgs, args.flutterTestLogFile, logger);
		// this.flutter.registerForUnhandledMessages((msg) => this.log(msg));

		// Set up subscriptions.
		// this.flutter.registerForUnhandledMessages((msg) => this.log(msg));
		this.flutter.registerForTestStartedProcess((n) => this.initObservatory(`${n.observatoryUri}ws`));
		this.flutter.registerForAllTestNotifications((n) => this.handleTestEvent(args.program, n));

		return this.flutter.process;
	}

	private currentTest: any;
	private handleTestEvent(suitePath: string, notification: any) {
		// Send to the editor.
		this.sendEvent(new Event(
			"dart.testRunNotification",
			{ suitePath, notification },
		));
		// Handle basic output
		switch (notification.type) {
			case "testStart":
				const testStart = notification as TestStartNotification;
				this.currentTest = testStart.test;
				break;
			case "testDone":
				const testDone = notification as TestDoneNotification;
				if (testDone.hidden)
					return;
				const pass = testDone.result === "success";
				const symbol = pass ? tick : cross;
				this.sendEvent(new OutputEvent(`${symbol} ${this.currentTest.name}\n`, "stdout"));
				break;
			case "print":
				const print = notification as PrintNotification;
				this.sendEvent(new OutputEvent(`${print.message}\n`, "stdout"));
				break;
			case "error":
				const error = notification as ErrorNotification;
				this.sendEvent(new OutputEvent(`${error.error}\n`, "stderr"));
				this.sendEvent(new OutputEvent(`${error.stackTrace}\n`, "stderr"));
				break;
		}
	}
}
