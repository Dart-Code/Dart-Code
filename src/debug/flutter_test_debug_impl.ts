import { Event } from "vscode-debugadapter";
import { DartTestDebugSession } from "./dart_test_debug_impl";
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
		if (args.program)
			appArgs.push(this.sourceFileForArgs(args));

		const logger = (message: string) => this.sendEvent(new Event("dart.log.flutter.test", { message }));
		return this.createRunner(args.flutterPath, args.cwd, args.program, globalFlutterArgs.concat(["test", "--machine"]).concat(appArgs), args.flutterTestLogFile, logger);
	}
}
