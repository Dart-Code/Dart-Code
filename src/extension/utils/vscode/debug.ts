import * as vs from "vscode";
import { DartVsCodeLaunchArgs } from "../../../shared/debug/interfaces";
import { DebuggerType, VmServiceExtension } from "../../../shared/enums";
import { PromiseCompleter } from "../../../shared/utils";

export class DartDebugSessionInformation {
	public observatoryUri?: string;
	public vmServiceUri?: string;
	public clientVmServiceUri?: string;
	public readonly sessionStart: Date = new Date();
	public hasStarted = false;
	public flutterMode: string | undefined;
	public flutterDeviceId: string | undefined;
	public supportsHotReload: boolean | undefined;
	public hasEnded = false;
	public progress: { [key: string]: ProgressMessage } = {};
	public readonly loadedServiceExtensions: VmServiceExtension[] = [];
	public readonly debuggerType: DebuggerType;
	public readonly projectRootPath: string | undefined;
	constructor(public readonly session: vs.DebugSession, configuration: vs.DebugConfiguration) {
		configuration = configuration as unknown as vs.DebugConfiguration & DartVsCodeLaunchArgs;
		this.debuggerType = configuration.debuggerType as DebuggerType;
		this.projectRootPath = configuration.projectRootPath;
	}
}

export class ProgressMessage {
	constructor(private readonly reporter: vs.Progress<{ message?: string }>, private readonly completer: PromiseCompleter<void>) { }

	public report(message: string): void {
		this.reporter.report({ message });
	}

	public complete(): void {
		this.completer.resolve();
	}
}
