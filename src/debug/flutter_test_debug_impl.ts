import { globalFlutterArgs } from "../extension/utils/processes";
import { LogCategory } from "../shared/enums";
import { DartTestDebugSession } from "./dart_test_debug_impl";
import { DebugAdapterLogger } from "./logging";
import { FlutterLaunchRequestArguments } from "./utils";

export class FlutterTestDebugSession extends DartTestDebugSession {

	protected spawnProcess(args: FlutterLaunchRequestArguments): any {
		let appArgs: string[] = [];

		if (this.shouldConnectDebugger) {
			appArgs.push("--start-paused");
		}

		if (args.args) {
			appArgs = appArgs.concat(args.args);
		}

		if (args.program)
			appArgs.push(this.sourceFileForArgs(args));

		const logger = new DebugAdapterLogger(this, LogCategory.FlutterTest);
		return this.createRunner(args.flutterPath, args.cwd, args.program, globalFlutterArgs.concat(["test", "--machine"]).concat(appArgs), args.env, args.flutterTestLogFile, logger, args.maxLogLineLength);
	}
}
