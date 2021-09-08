import { DartCapabilities } from "../shared/capabilities/dart";
import { Logger } from "../shared/interfaces";
import { getPubExecutionInfo } from "../shared/processes";
import { RunDaemonBase, RunMode } from "./run_daemon_base";

export class WebRun extends RunDaemonBase {
	constructor(mode: RunMode, dartCapabilties: DartCapabilities, dartSdkPath: string, projectFolder: string | undefined, args: string[], env: { envOverrides?: { [key: string]: string | undefined }, toolEnv: any }, logFile: string | undefined, logger: Logger, urlExposer: (url: string) => Promise<{ url: string }>, maxLogLineLength: number) {
		super(mode, dartCapabilties, logFile, logger, urlExposer, maxLogLineLength, true, true);

		const pubExecution = getPubExecutionInfo(this.dartCapabilities, dartSdkPath, ["global", "run", "webdev", "daemon"].concat(args));

		this.createProcess(projectFolder, pubExecution.executable, pubExecution.args, env);
	}
}
