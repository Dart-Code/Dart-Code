import { DebugProtocol } from "@vscode/debugprotocol";
import * as vs from "vscode";
import { forceWindowsDriveLetterToUppercaseInUriString } from "../../shared/utils/fs";
import { getActiveRealFileEditor, isDartDocument } from "../../shared/vscode/editors";

export class DartDebugAdapterGlobalEvaluationContextFactory implements vs.DebugAdapterTrackerFactory {
	createDebugAdapterTracker(): vs.DebugAdapterTracker {
		return new DartDebugAdapterGlobalEvaluationContext();
	}
}

class DartDebugAdapterGlobalEvaluationContext implements vs.DebugAdapterTracker {
	onWillReceiveMessage(message: unknown): void {
		const request = message as DebugProtocol.EvaluateRequest;
		if (request.command === "evaluate" && request.arguments?.context === "repl") {
			const doc = getActiveRealFileEditor()?.document;
			if (doc && isDartDocument(doc)) {
				// Don't escape colons in drive letters, as the shipped DAP code here
				// will call `lookupPackageUris` on this URI and it won't match. Also normalize
				// the drive letter because otherwise it might not work for Windows -> Android
				// (see https://github.com/Dart-Code/Dart-Code/issues/5237).
				request.arguments.context = forceWindowsDriveLetterToUppercaseInUriString(doc.uri.toString(true));
			}
		}
	}
}
