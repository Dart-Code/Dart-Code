import * as path from "path";
import { flutterPath } from "../shared/constants";
import { DartLaunchArgs } from "../shared/debug/interfaces";
import { LogCategory } from "../shared/enums";
import { SpawnedProcess } from "../shared/interfaces";
import { usingCustomScript } from "../shared/utils";
import { DartTestDebugSession } from "./dart_test_debug_impl";
import { DebugAdapterLogger } from "./logging";

export class FlutterTestDebugSession extends DartTestDebugSession {

	protected async spawnProcess(args: DartLaunchArgs): Promise<SpawnedProcess> {
		let allArgs: string[] = ["test", "--machine"];

		if (this.shouldConnectDebugger)
			allArgs.push("--start-paused");

		// Replace in any custom tool.
		const customTool = {
			replacesArgs: args.customToolReplacesArgs,
			script: args.customTool,
		};
		const execution = usingCustomScript(
			path.join(args.flutterSdkPath!, flutterPath),
			allArgs,
			customTool,
		);
		allArgs = execution.args;

		if (args.toolArgs)
			allArgs = allArgs.concat(args.toolArgs);

		// For `flutter test`, arguments cannot go after the script name or they will be interpreted
		// as test scripts and fail, so insert them before [program]. If `flutter` is updated to work
		// like `pub run test` and dart run test:test` in future, this should be moved below for consistency.
		if (args.args)
			allArgs = allArgs.concat(args.args);

		if (args.program)
			allArgs.push(this.sourceFileForArgs(args));

		const logger = new DebugAdapterLogger(this, LogCategory.FlutterTest);
		return this.createRunner(execution.executable, args.cwd, allArgs, args.env, args.flutterTestLogFile, logger, args.maxLogLineLength);
	}
}
