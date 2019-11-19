import { LogCategory } from "../shared/enums";
import { Logger } from "../shared/interfaces";
import { FlutterDebugSession } from "./flutter_debug_impl";
import { RunDaemonBase, RunMode } from "./run_daemon_base";
import { FlutterLaunchRequestArguments } from "./utils";
import { WebRun } from "./web_run";

export class WebDebugSession extends FlutterDebugSession {
	constructor() {
		super();

		// There is no observatory web app, so we shouldn't send an ObservatoryURI
		// back to the editor, since that enables "Dart: Open Observatory" and friends.
		this.supportsObservatory = false;
		this.logCategory = LogCategory.WebDaemon;
	}

	protected spawnRunDaemon(isAttach: boolean, args: FlutterLaunchRequestArguments, logger: Logger): RunDaemonBase {
		let appArgs: string[] = [];

		// TODO: Is any of this relevant?
		// if (!isAttach) {
		// 	if (args.flutterMode === "profile") {
		// 		appArgs.push("--profile");
		// 	} else if (args.flutterMode === "release") {
		// 		appArgs.push("--release");
		// 	} else {
		// 		// Debug mode

		// 		if (this.flutterTrackWidgetCreation) {
		// 			appArgs.push("--track-widget-creation");
		// 		}
		// 	}

		// 	if (this.shouldConnectDebugger) {
		// 		appArgs.push("--start-paused");
		// 	}
		// }

		if (args.args) {
			appArgs = appArgs.concat(args.args);
		}

		// TODO: Attach?
		return new WebRun(isAttach ? RunMode.Attach : RunMode.Run, args.pubPath, args.cwd, appArgs, args.env, args.webDaemonLogFile, logger, this.maxLogLineLength);
	}
}
