import * as path from "path";
import { flutterPath } from "../shared/constants";
import { FlutterLaunchRequestArguments } from "../shared/debug/interfaces";
import { LogCategory } from "../shared/enums";
import { usingCustomScript } from "../shared/utils";
import { DartTestDebugSession } from "./dart_test_debug_impl";
import { DebugAdapterLogger } from "./logging";

export class FlutterTestDebugSession extends DartTestDebugSession {

	protected spawnProcess(args: FlutterLaunchRequestArguments): any {
		let appArgs: string[] = [];

		if (this.shouldConnectDebugger) {
			appArgs.push("--start-paused");
		}

		if (args.args) {
			appArgs = appArgs.concat(args.args);
		}

		if (args.deviceId) {
			appArgs.push("-d");
			appArgs.push(args.deviceId);
		}

		if (args.program)
			appArgs.push(this.sourceFileForArgs(args));

		const { binPath, binArgs } = usingCustomScript(
			path.join(args.flutterSdkPath, flutterPath),
			["test", "--machine"],
			args.workspaceConfig?.flutterTestScript || args.workspaceConfig?.flutterScript,
		);

		const logger = new DebugAdapterLogger(this, LogCategory.FlutterTest);
		return this.createRunner(binPath, args.cwd, args.program, (args.globalFlutterArgs || []).concat(binArgs).concat(appArgs), args.env, args.flutterTestLogFile, logger, args.maxLogLineLength);
	}
}
