import { Event } from "vscode-debugadapter";
import { DartTestDebugSession } from "./dart_test_debug_impl";
import { TestRunner } from "./test_runner";
import { FlutterLaunchRequestArguments, globalFlutterArgs } from "./utils";

export class FlutterTestDebugSession extends DartTestDebugSession {

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
		this.runner = new TestRunner(args.flutterPath, args.cwd, globalFlutterArgs.concat(["test", "--machine"]).concat(appArgs), args.flutterTestLogFile, logger);
		// this.flutter.registerForUnhandledMessages((msg) => this.log(msg));

		// Set up subscriptions.
		// this.flutter.registerForUnhandledMessages((msg) => this.log(msg));
		this.runner.registerForTestStartedProcess((n) => this.initObservatory(`${n.observatoryUri}ws`));
		this.runner.registerForAllTestNotifications((n) => this.handleTestEvent(args.program, n));

		return this.runner.process;
	}
}
