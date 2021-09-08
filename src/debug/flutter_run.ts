import * as path from "path";
import { DartCapabilities } from "../shared/capabilities/dart";
import { flutterPath } from "../shared/constants";
import { LogCategory } from "../shared/enums";
import { Logger, WorkspaceConfig } from "../shared/interfaces";
import { CategoryLogger } from "../shared/logging";
import { usingCustomScript } from "../shared/utils";
import { RunDaemonBase, RunMode } from "./run_daemon_base";

export class FlutterRun extends RunDaemonBase {
	constructor(mode: RunMode, dartCapabilties: DartCapabilities, flutterSdkPath: string, wsConfig: WorkspaceConfig | undefined, projectFolder: string | undefined, args: string[], env: { envOverrides?: { [key: string]: string | undefined }, toolEnv: any }, logFile: string | undefined, logger: Logger, urlExposer: (url: string) => Promise<{ url: string }>, maxLogLineLength: number) {
		super(mode, dartCapabilties, logFile, new CategoryLogger(logger, LogCategory.FlutterRun), urlExposer, maxLogLineLength, true, true);

		const command = mode === RunMode.Attach ? "attach" : "run";

		const execution = usingCustomScript(
			path.join(flutterSdkPath, flutterPath),
			[command, "--machine"],
			mode === RunMode.Run ? wsConfig?.flutterRunScript || wsConfig?.flutterScript : undefined ,
		);

		this.createProcess(projectFolder, execution.executable, execution.args.concat(args), env);
	}
}
