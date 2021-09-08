import { DartLaunchArgs } from "../shared/debug/interfaces";
import { LogCategory } from "../shared/enums";
import { Logger } from "../shared/interfaces";
import { FlutterDebugSession } from "./flutter_debug_impl";
import { RunDaemonBase, RunMode } from "./run_daemon_base";
import { WebRun } from "./web_run";

export class WebDebugSession extends FlutterDebugSession {
	constructor() {
		super();

		// There is no observatory web app, so we shouldn't send an ObservatoryURI
		// back to the editor, since that enables "Dart: Open Observatory" and friends.
		this.supportsObservatoryWebApp = false;
		this.logCategory = LogCategory.WebDaemon;
	}

	protected spawnRunDaemon(isAttach: boolean, deviceId: string | undefined, args: DartLaunchArgs, logger: Logger): RunDaemonBase {
		let appArgs: string[] = [];

		// 	if (this.shouldConnectDebugger) {
		// 		appArgs.push("--start-paused");
		// 	}
		// }

		if (args.args) {
			appArgs = appArgs.concat(args.args);
		}

		// TODO: Attach?
		return new WebRun(isAttach ? RunMode.Attach : RunMode.Run, this.dartCapabilities, args.dartSdkPath, args.cwd, appArgs, { envOverrides: args.env, toolEnv: this.toolEnv }, args.webDaemonLogFile, logger, (url) => this.exposeUrl(url), this.maxLogLineLength);
	}
}
