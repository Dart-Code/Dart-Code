import { DebugAdapterDescriptor, DebugAdapterDescriptorFactory, DebugAdapterExecutable, DebugSession, ExtensionContext } from "vscode";
import { DebuggerType } from "../../shared/enums";

export class DartDebugAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {
	constructor(private readonly extensionContext: ExtensionContext) { }

	public createDebugAdapterDescriptor(session: DebugSession, executable: DebugAdapterExecutable | undefined): DebugAdapterDescriptor {
		let debuggerScript: string;
		switch (session.configuration.debuggerType) {
			case DebuggerType.Flutter:
				debuggerScript = "flutter_debug_entry";
				break;
			case DebuggerType.FlutterTest:
				debuggerScript = "flutter_test_debug_entry";
				break;
			case DebuggerType.Web:
				debuggerScript = "web_debug_entry";
				break;
			case DebuggerType.WebTest:
				debuggerScript = "web_test_debug_entry"
				break;
			case DebuggerType.Dart:
				debuggerScript = "dart_debug_entry";
				break;
			case DebuggerType.PubTest:
				debuggerScript = "dart_test_debug_entry";
				break;
			default:
				throw new Error("Unknown debugger type");
		}

		const scriptPath = this.extensionContext.asAbsolutePath(`./out/src/debug/${debuggerScript}.js`);
		const args = [scriptPath];
		return new DebugAdapterExecutable("node", args);
	}
}
