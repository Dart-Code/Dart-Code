import { Event, OutputEvent } from "vscode-debugadapter";
import { ErrorNotification, PrintNotification, TestDoneNotification, TestStartNotification } from "../views/test_protocol";
import { DartDebugSession } from "./dart_debug_impl";
import { TestRunner } from "./test_runner";
import { DartLaunchRequestArguments, FlutterLaunchRequestArguments } from "./utils";

const tick = "✓";
const cross = "✖";

export class DartTestDebugSession extends DartDebugSession {
	protected args: FlutterLaunchRequestArguments;
	constructor() {
		super();

		this.sendStdOutToConsole = false;
	}

	protected spawnProcess(args: DartLaunchRequestArguments): any {
		const debug = !args.noDebug;
		let envOverrides: any;
		let appArgs: string[] = [];

		if (debug) {
			envOverrides = {
				DART_VM_OPTIONS: "--enable-vm-service=0 --pause_isolates_on_start=true",
			};
		}

		if (args.args) {
			appArgs = appArgs.concat(args.args);
		}

		// TODO: Validate that args.program is always absolute (we use it as a key for notifications).
		appArgs.push(this.sourceFileForArgs(args));

		return this.createRunner(args.pubPath, args.cwd, args.program, ["run", "test", "-r", "json"].concat(appArgs), args.pubTestLogFile, envOverrides);
	}

	protected createRunner(executable: string, projectFolder: string, program: string, args: string[], logFile: string, envOverrides?: any) {
		const runner = new TestRunner(executable, projectFolder, args, logFile, envOverrides);

		// Set up subscriptions.
		// this.flutter.registerForUnhandledMessages((msg) => this.log(msg));
		runner.registerForTestStartedProcess((n) => this.initObservatory(`${n.observatoryUri}ws`));
		runner.registerForAllTestNotifications((n) => this.handleTestEvent(program, n));

		return runner.process;
	}

	// TODO: currentTest somewhat relies on ordering of test results coming after the test starts...
	private currentTest: any;
	protected handleTestEvent(suitePath: string, notification: any) {
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
