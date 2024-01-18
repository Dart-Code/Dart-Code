import * as vs from "vscode";
import { getActiveRealFileEditor, isDartDocument } from "../editors";

export class DartDebugAdapterGlobalEvaluationContextFactory implements vs.DebugAdapterTrackerFactory {
	createDebugAdapterTracker(session: vs.DebugSession): vs.DebugAdapterTracker {
		return new DartDebugAdapterGlobalEvaluationContext();
	}
}

class DartDebugAdapterGlobalEvaluationContext implements vs.DebugAdapterTracker {
	onWillReceiveMessage(message: any): void {
		if (message.command === "evaluate" && message.arguments?.context === "repl") {
			const doc = getActiveRealFileEditor()?.document;
			if (doc && isDartDocument(doc)) {
				message.arguments.context = doc?.uri.toString();
			}
		}
	}
}
