import * as vs from "vscode";
import { PromiseCompleter } from "../../../shared/utils";

export class DartDebugSessionInformation {
	public observatoryUri?: string;
	public vmServiceUri?: string;
	public readonly sessionStart: Date = new Date();
	public hasEnded = false;
	public progress: { [key: string]: ProgressMessage } = {};
	constructor(public readonly session: vs.DebugSession, public readonly debuggerType: string) { }
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
