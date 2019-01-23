import * as vs from "vscode";
import { PromiseCompleter } from "../debug/utils";

const observatoryPortRegex = /:([0-9]+)\/?$/;
export function extractObservatoryPort(observatoryUri: string): number | undefined {
	const matches = observatoryPortRegex.exec(observatoryUri);
	return matches ? parseInt(matches[1], 10) : undefined;
}

export class DartDebugSessionInformation {
	public observatoryUri?: string;
	public progressPromise?: PromiseCompleter<void>;
	public readonly sessionStart: Date = new Date();
	constructor(public readonly session: vs.DebugSession) { }
}
