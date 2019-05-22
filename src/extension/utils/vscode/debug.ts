import * as vs from "vscode";
import { PromiseCompleter } from "../../debug/utils";

const observatoryPortRegex = /:([0-9]+)\/?$/;
// TODO: Remove this once --debug-uri support in `flutter attach` (v1.5.4) hits
// stable.
export function extractObservatoryPort(observatoryUri: string): number | undefined {
	const matches = observatoryPortRegex.exec(observatoryUri);
	return matches ? parseInt(matches[1], 10) : undefined;
}

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
	public readonly sessionStart: Date = new Date();
	constructor(public readonly session: vs.DebugSession) { }
}
