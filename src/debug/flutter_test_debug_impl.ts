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
		let appArgs: string[] = [];

		if (this.shouldConnectDebugger)
			appArgs.push("--start-paused");

		if (args.toolArgs)
			appArgs = appArgs.concat(args.toolArgs);

		if (args.program)
			appArgs.push(this.sourceFileForArgs(args));

		if (args.args)
			appArgs = appArgs.concat(args.args);

		const { binPath, binArgs } = usingCustomScript(
			path.join(args.flutterSdkPath!, flutterPath),
			["test", "--machine"],
			args.workspaceConfig?.flutterTestScript || args.workspaceConfig?.flutterScript,
		);

		const logger = new DebugAdapterLogger(this, LogCategory.FlutterTest);
		return this.createRunner(binPath, args.cwd, binArgs.concat(appArgs), args.env, args.flutterTestLogFile, logger, args.maxLogLineLength);
	}
}
