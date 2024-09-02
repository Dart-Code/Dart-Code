import * as vs from "vscode";
import { forceWindowsDriveLetterToUppercaseInUriString } from "../../shared/utils/fs";
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
				// Don't escape colons in drive letters, as the shipped DAP code here
				// will call `lookupPackageUris` on this URI and it won't match. Also normalize
				// the drive letter because otherwise it might not work for Windows -> Android
				// (see https://github.com/Dart-Code/Dart-Code/issues/5237).
				message.arguments.context = forceWindowsDriveLetterToUppercaseInUriString(doc.uri.toString(true));
			}
		}
	}
}
