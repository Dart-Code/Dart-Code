import { DartCapabilities } from "../shared/capabilities/dart";
import { LogCategory } from "../shared/enums";
import { Logger } from "../shared/interfaces";
import { CategoryLogger } from "../shared/logging";
import { ExecutionInfo } from "../shared/processes";
import { RunDaemonBase, RunMode } from "./run_daemon_base";

export class FlutterRun extends RunDaemonBase {
	constructor(mode: RunMode, dartCapabilties: DartCapabilities, execution: ExecutionInfo, projectFolder: string | undefined, env: { envOverrides?: { [key: string]: string | undefined }, toolEnv: any }, logFile: string | undefined, logger: Logger, urlExposer: (url: string) => Promise<{ url: string }>, maxLogLineLength: number) {
		super(mode, dartCapabilties, logFile, new CategoryLogger(logger, LogCategory.FlutterRun), urlExposer, maxLogLineLength, true, true);

		this.createProcess(projectFolder, execution.executable, execution.args, env);
	}
}
