import * as vs from "vscode";
import { PromiseCompleter } from "../../../shared/utils";

export class DartDebugSessionInformation {
	public observatoryUri?: string;
	public vmServiceUri?: string;
	/// Reporting for the launch step.
	public readonly launchProgressPromise = new PromiseCompleter<void>();
	public launchProgressReporter?: vs.Progress<{ message?: string; increment?: number; }>; // Set to undefined when launch finishes as a signal.
	// Reporting for any operation that happens outside of launching.
	public progressPromise?: PromiseCompleter<void>;
	public progressReporter?: vs.Progress<{ message?: string; increment?: number; }>;
	public progressID?: string;
	/// Reporting for the waiting to terminate step.
	public readonly terminatingProgressPromise = new PromiseCompleter<void>();
	public terminatingProgressReporter?: vs.Progress<{ message?: string; increment?: number; }>; // Set to undefined when launch finishes as a signal.
	public readonly sessionStart: Date = new Date();
	constructor(public readonly session: vs.DebugSession, public readonly debuggerType: string) { }
}
