import * as path from "path";
import { DebugAdapterDescriptor, DebugAdapterDescriptorFactory, DebugAdapterExecutable, DebugAdapterServer, DebugSession, ExtensionContext } from "vscode";
import { getDebugAdapterPath, getDebugAdapterPort } from "../../shared/utils/debug";

export class DartDebugAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {
	constructor(private readonly extensionContext: ExtensionContext) { }

	public createDebugAdapterDescriptor(session: DebugSession, executable: DebugAdapterExecutable | undefined): DebugAdapterDescriptor {
		const scriptPath = getDebugAdapterPath((p) => this.extensionContext.asAbsolutePath(p), session.configuration.debuggerType);

		if (process.env.DART_CODE_USE_DEBUG_SERVERS) {
			return new DebugAdapterServer(getDebugAdapterPort(path.basename(scriptPath).split(".")[0]));
		}

		const args = [scriptPath];
		return new DebugAdapterExecutable("node", args);
	}
}
