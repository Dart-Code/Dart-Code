import { LogCategory } from "../shared/enums";
import { Logger } from "../shared/interfaces";
import { CategoryLogger } from "../shared/logging";
import { RunDaemonBase, RunMode } from "./run_daemon_base";

export class FlutterRun extends RunDaemonBase {
	constructor(mode: RunMode, flutterBinPath: string, globalFlutterArgs: string[], projectFolder: string | undefined, args: string[], envOverrides: any, logFile: string | undefined, logger: Logger, maxLogLineLength: number) {
		super(mode, logFile, new CategoryLogger(logger, LogCategory.FlutterRun), maxLogLineLength, true, true);

		const command = mode === RunMode.Attach ? "attach" : "run";

		this.createProcess(projectFolder, flutterBinPath, globalFlutterArgs.concat([command, "--machine"]).concat(args), envOverrides);
	}
}
