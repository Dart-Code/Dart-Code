import { DartCapabilities } from "../shared/capabilities/dart";
import { Logger } from "../shared/interfaces";
import { ExecutionInfo } from "../shared/processes";
import { RunDaemonBase, RunMode } from "./run_daemon_base";

export class WebRun extends RunDaemonBase {
	constructor(mode: RunMode, dartCapabilties: DartCapabilities, execution: ExecutionInfo, projectFolder: string | undefined, env: { envOverrides?: { [key: string]: string | undefined }, toolEnv: any }, logFile: string | undefined, logger: Logger, urlExposer: (url: string) => Promise<{ url: string }>, maxLogLineLength: number) {
		super(mode, dartCapabilties, logFile, logger, urlExposer, maxLogLineLength, true, true);

		this.createProcess(projectFolder, execution.executable, execution.args, env);
	}
}
