import { Logger } from "../shared/interfaces";
import { RunDaemonBase, RunMode } from "./run_daemon_base";

export class WebRun extends RunDaemonBase {
	constructor(mode: RunMode, pubBinPath: string, projectFolder: string | undefined, args: string[], env: { envOverrides?: { [key: string]: string | undefined }, toolEnv: {} }, logFile: string | undefined, logger: Logger, urlExposer: (url: string) => Promise<{ url: string }>, maxLogLineLength: number) {
		super(mode, logFile, logger, urlExposer, maxLogLineLength, true, true);

		this.createProcess(projectFolder, pubBinPath, ["global", "run", "webdev", "daemon"].concat(args), env);
	}
}
