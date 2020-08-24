import { DebugAdapterDescriptor, DebugAdapterDescriptorFactory, DebugAdapterExecutable, DebugAdapterServer, DebugSession } from "vscode";
import { debugAdapterPath } from "../../shared/constants";
import { getDebugAdapterName, getDebugAdapterPort } from "../../shared/utils/debug";

export class DartDebugAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {
	public createDebugAdapterDescriptor(session: DebugSession, executable: DebugAdapterExecutable | undefined): DebugAdapterDescriptor {
		const debuggerName = getDebugAdapterName(session.configuration.debuggerType);

		if (process.env.DART_CODE_USE_DEBUG_SERVERS) {
			return new DebugAdapterServer(getDebugAdapterPort(debuggerName));
		}

		return new DebugAdapterExecutable("node", [debugAdapterPath, debuggerName]);
	}
}
