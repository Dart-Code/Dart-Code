import * as child_process from "child_process";
import * as path from "path";
import { Event, OutputEvent, TerminatedEvent } from "vscode-debugadapter";
import { DebugProtocol } from "vscode-debugprotocol";
import { DartDebugSession } from "./dart_debug_impl";
import { VMEvent } from "./dart_debug_protocol";
import { FlutterTest } from "./flutter_test";
import { FlutterLaunchRequestArguments, formatPathForVm, isWin, uriToFilePath } from "./utils";

export class FlutterTestDebugSession extends DartDebugSession {
	protected args: FlutterLaunchRequestArguments;
	public flutter: FlutterTest;
	public observatoryUri: string;

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

		if (args.args) {
			appArgs = appArgs.concat(args.args);
		}

		this.flutter = new FlutterTest(this.args.flutterPath, args.cwd, appArgs, this.args.flutterRunLogFile);
		this.flutter.registerForUnhandledMessages((msg) => this.log(msg));

		// Set up subscriptions.
		this.flutter.registerForStart((n) => this.log(JSON.stringify(n)));
		this.flutter.registerForAllSuites((n) => this.log(JSON.stringify(n)));
		this.flutter.registerForSuite((n) => this.log(JSON.stringify(n)));
		this.flutter.registerForTestStart((n) => this.log(JSON.stringify(n)));
		this.flutter.registerForTestDone((n) => this.log(JSON.stringify(n)));
		this.flutter.registerForGroup((n) => this.log(JSON.stringify(n)));
		this.flutter.registerForDone((n) => this.log(JSON.stringify(n)));

		return this.flutter.process;
	}
}
