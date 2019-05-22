import { Event } from "vscode-debugadapter";
import { LogCategory, LogSeverity } from "../../shared/enums";
import { globalFlutterArgs } from "../utils/processes";
import { DartTestDebugSession } from "./dart_test_debug_impl";
import { FlutterLaunchRequestArguments, LogMessage } from "./utils";

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

		const logger = (message: string, severity: LogSeverity) => this.sendEvent(new Event("dart.log", new LogMessage(message, severity, LogCategory.FlutterTest)));
		return this.createRunner(args.flutterPath, args.cwd, args.program, globalFlutterArgs.concat(["test", "--machine"]).concat(appArgs), args.env, args.flutterTestLogFile, logger, args.maxLogLineLength);
	}
}
