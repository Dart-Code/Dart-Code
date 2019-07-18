import { globalFlutterArgs } from "../extension/utils/processes";
import { LogCategory } from "../shared/enums";
import { Logger } from "../shared/interfaces";
import { CategoryLogger } from "../shared/logging";
import { FlutterRunBase, RunMode } from "./flutter_run_base";

export class FlutterRun extends FlutterRunBase {
	constructor(mode: RunMode, flutterBinPath: string, projectFolder: string, args: string[], envOverrides: any, logFile: string, logger: Logger, maxLogLineLength: number) {
		super(mode, () => logFile, new CategoryLogger(logger, LogCategory.FlutterRun), maxLogLineLength, true, true);

		const command = mode === RunMode.Attach ? "attach" : "run";

		this.createProcess(projectFolder, flutterBinPath, globalFlutterArgs.concat([command, "--machine"]).concat(args), envOverrides);
	}
}
