import { FlutterDebugSession } from "./flutter_debug_impl";
import { FlutterRunBase, RunMode } from "./flutter_run_base";
import { FlutterWebRun } from "./flutter_web_run";
import { FlutterLaunchRequestArguments, LogCategory, LogSeverity } from "./utils";

export class FlutterWebDebugSession extends FlutterDebugSession {
	constructor() {
		super();

		// There is no observatory web app, so we shouldn't send an ObservatoryURI
		// back to the editor, since that enables "Dart: Open Observatory" and friends.
		this.supportsObservatory = false;
		this.logCategory = LogCategory.WebDaemon;
	}

	protected spawnRunDaemon(isAttach: boolean, args: FlutterLaunchRequestArguments, logger: (message: string, severity: LogSeverity) => void): FlutterRunBase {
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
		return new FlutterWebRun(isAttach ? RunMode.Attach : RunMode.Run, args.pubPath, args.cwd, appArgs, args.env, args.webDaemonLogFile, logger, this.maxLogLineLength);
	}
}
