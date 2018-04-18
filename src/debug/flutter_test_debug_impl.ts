import * as child_process from "child_process";
import * as path from "path";
import { Event, OutputEvent, TerminatedEvent } from "vscode-debugadapter";
import { DebugProtocol } from "vscode-debugprotocol";
import { DartDebugSession } from "./dart_debug_impl";
import { VMEvent } from "./dart_debug_protocol";
import { FlutterTest, Test, TestDoneNotification, Group, Suite, DoneNotification, PrintNotification, ErrorNotification } from "./flutter_test";
import { FlutterLaunchRequestArguments, formatPathForVm, isWin, uriToFilePath } from "./utils";

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

		if (this.sourceFile) {
			appArgs.push(this.sourceFile);
		}

		if (args.args) {
			appArgs = appArgs.concat(args.args);
		}

		this.flutter = new FlutterTest(this.args.flutterPath, args.cwd, appArgs, this.args.flutterTestLogFile);
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

	/***
	 * Converts a source path to an array of possible uris.
	 *
	 * For flutter test we need to extend the Dart implementation by also providing
	 * uris using the exact file path for Windows.
	 * See https://github.com/flutter/flutter/issues/15513
	 */
	protected getPossibleSourceUris(sourcePath: string): string[] {
		const allUris = super.getPossibleSourceUris(sourcePath);
		if (isWin && allUris.indexOf(sourcePath) === -1)
			allUris.push(sourcePath);

		return allUris;
	}
}
