import { Logger } from "../shared/interfaces";
import { FlutterRunBase, RunMode } from "./flutter_run_base";

export class FlutterWebRun extends FlutterRunBase {
	constructor(mode: RunMode, pubBinPath: string, projectFolder: string, args: string[], envOverrides: any, logFile: string, logger: Logger, maxLogLineLength: number) {
		super(mode, () => logFile, logger, maxLogLineLength, true, true);

		this.createProcess(projectFolder, pubBinPath, ["global", "run", "webdev", "daemon"].concat(args), envOverrides);
	}
}
