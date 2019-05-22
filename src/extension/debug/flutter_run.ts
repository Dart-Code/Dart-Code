import { LogSeverity } from "../../shared/enums";
import { globalFlutterArgs } from "../utils/processes";
import { FlutterRunBase, RunMode } from "./flutter_run_base";

export class FlutterRun extends FlutterRunBase {
	constructor(mode: RunMode, flutterBinPath: string, projectFolder: string, args: string[], envOverrides: any, logFile: string, logger: (message: string, severity: LogSeverity) => void, maxLogLineLength: number) {
		super(mode, () => logFile, logger, maxLogLineLength, true, true);

		const command = mode === RunMode.Attach ? "attach" : "run";

		this.createProcess(projectFolder, flutterBinPath, globalFlutterArgs.concat([command, "--machine"]).concat(args), envOverrides);
	}
}
