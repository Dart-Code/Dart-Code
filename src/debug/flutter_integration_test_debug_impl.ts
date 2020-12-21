import path = require("path");
import { TerminatedEvent } from "vscode-debugadapter";
import { DebugProtocol } from "vscode-debugprotocol";
import { flutterPath } from "../shared/constants";
import { FlutterLaunchRequestArguments } from "../shared/debug/interfaces";
import { LogCategory } from "../shared/enums";
import { safeSpawn } from "../shared/processes";
import { DartDebugSession } from "./dart_debug_impl";

export class FlutterIntegrationTestDebugSession extends DartDebugSession {
	constructor() {
		super();

		this.allowWriteServiceInfo = false;
		this.parseVmServiceUriFromStdOut = false;
		this.logCategory = LogCategory.FlutterTest;
	}

	protected async attachRequest(response: DebugProtocol.AttachResponse, args: any): Promise<void> {
		return this.launchRequest(response, args);
	}

	protected spawnProcess(args: FlutterLaunchRequestArguments): any {
		// TODO: Do we support this?
		const isAttach = args.request === "attach";
		this.allowTerminatingVmServicePid = !isAttach;

		if (!args.flutterDriverScript || !args.program) {
			this.logToUser("Unable to launch Flutter integration test. flutterDriverScript and program required.");
			this.sendEvent(new TerminatedEvent());
			return;
		}

		// TODO: Debug arguments and Flutter drive additional args.
		const appArgs = ["drive", "--driver", args.flutterDriverScript, "--target", args.program];
		const flutterBinPath = path.join(args.flutterSdkPath, flutterPath);

		this.log(`Spawning ${flutterBinPath} with args ${JSON.stringify(appArgs)}`);
		if (args.cwd)
			this.log(`..  in ${args.cwd}`);
		// TODO: Flutter global args?
		const process = safeSpawn(args.cwd, flutterBinPath, appArgs, { envOverrides: args.env, toolEnv: args.toolEnv });

		this.log(`    PID: ${process.pid}`);

		return process;
	}

}
