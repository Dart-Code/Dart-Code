import { FlutterRunBase, RunMode } from "./flutter_run_base";
import { LogSeverity } from "./utils";

export class FlutterWebRun extends FlutterRunBase {
	constructor(mode: RunMode, pubBinPath: string, projectFolder: string, args: string[], envOverrides: any, logFile: string, logger: (message: string, severity: LogSeverity) => void, maxLogLineLength: number) {
		super(mode, () => logFile, logger, maxLogLineLength, true, true);

		this.createProcess(projectFolder, pubBinPath, ["global", "run", "webdev", "daemon"].concat(args), envOverrides);
	}
}
