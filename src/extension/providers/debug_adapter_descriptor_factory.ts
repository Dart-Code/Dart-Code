import { DebugAdapterDescriptor, DebugAdapterDescriptorFactory, DebugAdapterExecutable, DebugSession, ExtensionContext } from "vscode";
import { getDebugAdapterPath } from "../../shared/vscode/debugger";

export class DartDebugAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {
	constructor(private readonly extensionContext: ExtensionContext) { }

	public createDebugAdapterDescriptor(session: DebugSession, executable: DebugAdapterExecutable | undefined): DebugAdapterDescriptor {
		const scriptPath = getDebugAdapterPath((p) => this.extensionContext.asAbsolutePath(p), session.configuration.debuggerType);
		const args = [scriptPath];
		return new DebugAdapterExecutable("node", args);
	}
}
