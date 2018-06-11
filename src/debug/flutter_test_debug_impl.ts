import { Event } from "vscode-debugadapter";
import { DartTestDebugSession } from "./dart_test_debug_impl";
import { FlutterTest } from "./flutter_test";
import { FlutterLaunchRequestArguments } from "./utils";

export class FlutterTestDebugSession extends DartTestDebugSession {
	private flutter: FlutterTest;

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
}
