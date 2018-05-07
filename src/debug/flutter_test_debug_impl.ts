import { OutputEvent } from "vscode-debugadapter";
import { DartDebugSession } from "./dart_debug_impl";
import { DoneNotification, ErrorNotification, FlutterTest, Group, Suite, Test, TestDoneNotification } from "./flutter_test";
import { FlutterLaunchRequestArguments } from "./utils";

const tick = "✓";
const cross = "✖";

export class FlutterTestDebugSession extends DartDebugSession {
	protected args: FlutterLaunchRequestArguments;
	private flutter: FlutterTest;
	private observatoryUri: string;
	private suites: Suite[] = [];
	private groups: Group[] = [];
	private tests: Test[] = [];

	constructor() {
		super();

		this.sendStdOutToConsole = false;
	}

	protected spawnProcess(args: FlutterLaunchRequestArguments): any {
		const debug = !args.noDebug;
		let appArgs = [];

		if (args.previewDart2) {
			appArgs.push("--preview-dart-2");
		} else if (args.previewDart2 === false) {
			appArgs.push(`--no-preview-dart-2`);
		}

		if (debug) {
			appArgs.push("--start-paused");
		}

		const sourceFile = this.sourceFileForArgs(args);
		appArgs.push(sourceFile);

		if (args.args) {
			appArgs = appArgs.concat(args.args);
		}

		this.flutter = new FlutterTest(args.flutterPath, args.cwd, appArgs, args.flutterTestLogFile);
		// this.flutter.registerForUnhandledMessages((msg) => this.log(msg));

		// Set up subscriptions.
		this.flutter.registerForTestStartedProcess((n) => this.initObservatory(`${n.observatoryUri}ws`));
		// this.flutter.registerForStart((n) => this.log(JSON.stringify(n)));
		// this.flutter.registerForAllSuites((n) => this.log(JSON.stringify(n)));
		this.flutter.registerForSuite((n) => this.suites[n.suite.id] = n.suite);
		this.flutter.registerForTestStart((n) => this.tests[n.test.id] = n.test);
		this.flutter.registerForTestDone((n) => this.writeTestResult(n));
		this.flutter.registerForGroup((n) => this.groups[n.group.id] = n.group);
		this.flutter.registerForDone((n) => this.writeResult(n));
		this.flutter.registerForUnhandledMessages((n) => this.print({ message: n }));
		this.flutter.registerForPrint((n) => this.print(n));
		this.flutter.registerForError((n) => this.error(n));

		return this.flutter.process;
	}

	private writeTestResult(testDone: TestDoneNotification) {
		if (testDone.hidden)
			return;
		const test = this.tests[testDone.testID];
		const pass = testDone.result === "success";
		const symbol = pass ? tick : cross;
		this.sendEvent(new OutputEvent(`${symbol} ${test.name}\n`, "stdout"));
	}

	private writeResult(testDone: DoneNotification) {
		if (testDone.success)
			this.sendEvent(new OutputEvent(`All tests passed!\n`, "stdout"));
		else
			this.sendEvent(new OutputEvent(`Some tests failed.\n`, "stderr"));
	}

	private print(print: { message: string }) {
		this.sendEvent(new OutputEvent(`${print.message}\n`, "stdout"));
	}

	private error(error: ErrorNotification) {
		this.sendEvent(new OutputEvent(`${error.error}\n`, "stderr"));
		if (error.stackTrace)
			this.sendEvent(new OutputEvent(`${error.stackTrace}\n`, "stderr"));
	}
}
