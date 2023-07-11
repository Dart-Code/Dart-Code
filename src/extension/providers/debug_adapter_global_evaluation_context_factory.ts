import * as vs from "vscode";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { disposeAll } from "../../shared/utils";
import { getActiveRealFileEditor, isDartDocument } from "../editors";

export class DartDebugAdapterGlobalEvaluationContextFactory implements vs.DebugAdapterTrackerFactory, IAmDisposable {
	protected readonly disposables: IAmDisposable[] = [];
	public readonly trackers = new Set<DartDebugAdapterGlobalEvaluationContext>();

	public supportsFormatting = false;

	constructor(private readonly logger: Logger) { }

	createDebugAdapterTracker(session: vs.DebugSession): vs.DebugAdapterTracker {
		const tracker = new DartDebugAdapterGlobalEvaluationContext(this, this.logger, session);
		this.trackers.add(tracker);
		return tracker;
	}

	public dispose(): any {
		this.trackers.clear();
		disposeAll(this.disposables);
	}
}

class DartDebugAdapterGlobalEvaluationContext implements vs.DebugAdapterTracker {
	constructor(private readonly factory: DartDebugAdapterGlobalEvaluationContextFactory, private readonly logger: Logger, private readonly session: vs.DebugSession) { }

	onExit(code: number | undefined, signal: string | undefined): void {
		this.factory.trackers.delete(this);
	}

	onWillReceiveMessage(message: any): void {
		if (message.command === "evaluate" && message.arguments?.context === "repl") {
			const doc = getActiveRealFileEditor()?.document;
			if (doc && isDartDocument(doc)) {
				message.arguments.context = doc?.uri.toString();
			}
		}
	}
}
