import * as path from "path";
import { DebugAdapterDescriptor, DebugAdapterDescriptorFactory, DebugAdapterExecutable, DebugAdapterServer, DebugSession, ExtensionContext } from "vscode";
import { dartVMPath, debugAdapterPath } from "../../shared/constants";
import { DebuggerType } from "../../shared/enums";
import { DartSdks, Logger } from "../../shared/interfaces";
import { getDebugAdapterName, getDebugAdapterPort } from "../../shared/utils/debug";
import { config } from "../config";

export class DartDebugAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {
	constructor(private readonly sdks: DartSdks, private readonly logger: Logger, private readonly extensionContext: ExtensionContext) { }

	public createDebugAdapterDescriptor(session: DebugSession, executable: DebugAdapterExecutable | undefined): DebugAdapterDescriptor {
		const debuggerName = getDebugAdapterName(session.configuration.debuggerType);
		this.logger.info(`Using ${debuggerName} debugger for ${DebuggerType[session.configuration.debuggerType]}`);

		if (process.env.DART_CODE_USE_DEBUG_SERVERS) {
			const port = getDebugAdapterPort(debuggerName);
			this.logger.info(`Running debugger in server mode on port ${port} because DART_CODE_USE_DEBUG_SERVERS is set`);
			return new DebugAdapterServer(port);
		}

		if (config.experimentalDartDapPath) {
			const args = [config.experimentalDartDapPath, debuggerName];
			this.logger.info(`Running custom Dart debugger using Dart VM with args ${args.join("    ")}`);
			return new DebugAdapterExecutable(path.join(this.sdks.dart, dartVMPath), args);
		} else {
			const args = [this.extensionContext.asAbsolutePath(debugAdapterPath), debuggerName];
			this.logger.info(`Running debugger via node with ${args.join("    ")}`);
			return new DebugAdapterExecutable("node", args);
		}
	}
}
