import * as path from "path";
import { Event, OutputEvent } from "vscode-debugadapter";
import { ErrorNotification, GroupNotification, PrintNotification, SuiteNotification, Test, TestDoneNotification, TestStartNotification } from "../views/test_protocol";
import { DartDebugSession } from "./dart_debug_impl";
import { ObservatoryConnection } from "./dart_debug_protocol";
import { TestRunner } from "./test_runner";
import { DartLaunchRequestArguments, FlutterLaunchRequestArguments } from "./utils";

const tick = "✓";
const cross = "✖";

export class DartTestDebugSession extends DartDebugSession {
	protected args: FlutterLaunchRequestArguments;
	constructor() {
		super();

		this.sendStdOutToConsole = false;
		this.requiresProgram = false;
	}

	protected spawnProcess(args: DartLaunchRequestArguments): any {
		const debug = !args.noDebug;
		let envOverrides: any;
		let appArgs: string[] = [];

		// To use the test framework in the supported debugging way we should
		// send this flag; which will pause the tests at each suite start (this is
		// deifferent to the isolates being paused). To do that, we need to change
		// how our "unpause" logic works in the base debug adapter (since it won't
		// be paused at startup).
		// if (debug) {
		// 	appArgs.push("--pause-after-load");
		// }

		// Instead, we do it the VM way for now...
		if (debug) {
			envOverrides = {
				DART_VM_OPTIONS: "--enable-vm-service=0 --pause_isolates_on_start=true",
			};
		}

		// Only run single-threaded in the runner.
		appArgs.push("-j1");

		if (args.args) {
			appArgs = appArgs.concat(args.args);
		}

		if (args.program)
			appArgs.push(this.sourceFileForArgs(args));

		const logger = (message: string) => this.sendEvent(new Event("dart.log.pub.test", { message }));
		return this.createRunner(args.pubPath, args.cwd, args.program, ["run", "test", "-r", "json"].concat(appArgs), args.pubTestLogFile, logger, envOverrides);
	}

	protected createRunner(executable: string, projectFolder: string, program: string, args: string[], logFile: string, logger: (message: string) => void, envOverrides?: any) {
		const runner = new TestRunner(executable, projectFolder, args, logFile, logger, envOverrides);

		// Set up subscriptions.
		// this.flutter.registerForUnhandledMessages((msg) => this.log(msg));
		runner.registerForUnhandledMessages((msg) => this.logToUserIfAppropriate(msg, "stdout"));
		runner.registerForTestStartedProcess((n) => this.initObservatory(`${n.observatoryUri}ws`));
		runner.registerForAllTestNotifications((n) => {
			try {
				this.handleTestEvent(n);
			} catch (e) {
				this.log(e);
				this.logToUser(e);
			}
			try {
				this.sendTestEventToEditor(n);
			} catch (e) {
				this.log(e);
				this.logToUser(e);
			}
		});

		return runner.process;
	}

	protected logToUserIfAppropriate(message: string, category?: string) {
		// Filter out these messages taht come to stdout that we don't want to send to the user.
		if (message && message.startsWith("Observatory listening on"))
			return;
		if (message && message.startsWith("Press Control-C again"))
			return;

		this.logToUser(message, category);
	}

	private readonly suitePaths: string[] = [];
	private readonly tests: Test[] = [];
	protected handleTestEvent(notification: any) {
		// Handle basic output
		switch (notification.type) {
			case "start":
				const pid = notification.pid;
				if (pid) {
					this.additionalPidsToTerminate.push(pid);
				}
				break;
			case "debug":
				const observatoryUri = notification.observatory;
				if (observatoryUri) {
					const match = ObservatoryConnection.httpLinkRegex.exec(observatoryUri);
					if (match) {
						this.initObservatory(this.websocketUriForObservatoryUri(match[1]));
					}
				}
				break;
			case "suite":
				const suite = notification as SuiteNotification;
				// HACK: If we got a relative path, fix it up.
				if (!path.isAbsolute(suite.suite.path) && this.cwd)
					suite.suite.path = path.join(this.cwd, suite.suite.path);
				this.suitePaths[suite.suite.id] = suite.suite.path;
				break;
			case "testStart":
				const testStart = notification as TestStartNotification;
				this.tests[testStart.test.id] = testStart.test;
				break;
			case "testDone":
				const testDone = notification as TestDoneNotification;
				if (testDone.hidden)
					return;
				const pass = testDone.result === "success";
				const symbol = pass ? tick : cross;
				this.sendEvent(new OutputEvent(`${symbol} ${this.tests[testDone.testID].name}\n`, "stdout"));
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

	protected sendTestEventToEditor(notification: any) {
		let suiteID: number;
		switch (notification.type) {
			case "suite":
				const suite = notification as SuiteNotification;
				suiteID = suite.suite.id;
				break;
			case "group":
				const group = notification as GroupNotification;
				suiteID = group.group.suiteID;
				break;
			case "testStart":
				const testStart = notification as TestStartNotification;
				suiteID = testStart.test.suiteID;
				break;
			case "testDone":
				const testDone = notification as TestDoneNotification;
				suiteID = this.tests[testDone.testID].suiteID;
				break;
			case "print":
				const print = notification as PrintNotification;
				suiteID = this.tests[print.testID].suiteID;
				break;
			case "error":
				const error = notification as ErrorNotification;
				suiteID = this.tests[error.testID].suiteID;
				break;
		}

		const suitePath = this.suitePaths[suiteID];
		if (suitePath) {
			this.sendEvent(new Event(
				"dart.testRunNotification",
				{ suitePath, notification },
			));
		}
	}
}
