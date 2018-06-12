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
		let appArgs = [];
		if (debug) {
			appArgs.push("--enable-vm-service=0");
			appArgs.push("--pause_isolates_on_start=true");
		}
		if (args.checkedMode) {
			appArgs.push("--checked");
		}
		if (args.vmAdditionalArgs) {
			appArgs = appArgs.concat(args.vmAdditionalArgs);
		}
		appArgs.push(this.sourceFileForArgs(args));
		if (args.args) {
			appArgs = appArgs.concat(args.args);
		}

		const logger = (message: string) => this.sendEvent(new Event("dart.log.dart.test", { message }));
		return this.createRunner(args.dartPath, args.cwd, args.program, appArgs, args.dartTestLogFile, logger, { DART_TEST_REPORTER: "json" });
	}

	protected createRunner(executable: string, projectFolder: string, program: string, args: string[], logFile: string, logger: (message: string) => void, envOverrides?: any) {
		const runner = new TestRunner(executable, projectFolder, args, logFile, logger, envOverrides);

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
