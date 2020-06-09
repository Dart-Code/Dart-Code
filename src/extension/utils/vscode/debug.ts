import * as vs from "vscode";

export class DartDebugSessionInformation {
	public observatoryUri?: string;
	public vmServiceUri?: string;
	public readonly sessionStart: Date = new Date();
	constructor(public readonly session: vs.DebugSession, public readonly debuggerType: string) { }
}
