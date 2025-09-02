import { TerminatedEvent } from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol";
import { DartLaunchArgs } from "../shared/debug/interfaces";
import { LogCategory } from "../shared/enums";
import { Logger } from "../shared/interfaces";
import { getPubExecutionInfo } from "../shared/processes";
import { usingCustomScript } from "../shared/utils";
import { FlutterDebugSession } from "./flutter_debug_impl";
import { RunDaemonBase } from "./run_daemon_base";
import { WebRun } from "./web_run";

export class WebDebugSession extends FlutterDebugSession {
	constructor() {
		super();

		this.logCategory = LogCategory.WebDaemon;
	}

	protected async attachRequest(_response: DebugProtocol.AttachResponse, args: DartLaunchArgs): Promise<void> {
		this.logToUser("Attach is not supported for Dart web projects\n");
		this.sendEvent(new TerminatedEvent());
	}

	protected spawnRunDaemon(args: DartLaunchArgs, logger: Logger): RunDaemonBase {
		let allArgs: string[] = ["global", "run", "webdev", "daemon"];

		// 	if (this.shouldConnectDebugger) {
		// 		appArgs.push("--start-paused");
		// 	}
		// }

		if (args.toolArgs)
			allArgs = allArgs.concat(args.toolArgs);

		const pubExecution = getPubExecutionInfo(
			this.dartCapabilities,
			args.dartSdkPath,
			allArgs,
		);

		const customTool = {
			replacesArgs: args.customToolReplacesArgs,
			script: args.customTool,
		};
		let execution = usingCustomScript(
			pubExecution.executable,
			pubExecution.args,
			customTool,
		);
		allArgs = execution.args;

		if (args.args)
			allArgs = allArgs.concat(args.args);

		execution = {
			args: allArgs,
			executable: execution.executable,
		};

		// TODO: Attach?
		return new WebRun(this.dartCapabilities, execution, args.cwd, { envOverrides: args.env, toolEnv: this.toolEnv }, args.webDaemonLogFile, logger, (url) => this.exposeUrl(url), this.maxLogLineLength);
	}
}
