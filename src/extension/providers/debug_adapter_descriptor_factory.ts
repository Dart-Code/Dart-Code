import * as path from "path";
import { DebugAdapterDescriptor, DebugAdapterDescriptorFactory, DebugAdapterExecutable, DebugAdapterServer, DebugSession } from "vscode";
import { dartVMPath, debugAdapterPath } from "../../shared/constants";
import { DebuggerType } from "../../shared/enums";
import { DartSdks, Logger } from "../../shared/interfaces";
import { getDebugAdapterName, getDebugAdapterPort } from "../../shared/utils/debug";
import { Context } from "../../shared/vscode/workspace";
import { config } from "../config";

export class DartDebugAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {
	constructor(private readonly sdks: DartSdks, private readonly logger: Logger, private readonly extensionContext: Context) { }

	public createDebugAdapterDescriptor(session: DebugSession, executable: DebugAdapterExecutable | undefined): DebugAdapterDescriptor {
		return this.descriptorForType(session.configuration.debuggerType);
	}

	public descriptorForType(debuggerType: DebuggerType): DebugAdapterDescriptor {
		const debuggerName = getDebugAdapterName(debuggerType);
		this.logger.info(`Using ${debuggerName} debugger for ${DebuggerType[debuggerType]}`);

		if (config.experimentalDartDapPath && (debuggerType === DebuggerType.Dart || debuggerType === DebuggerType.PubTest)) {
			const args = [config.experimentalDartDapPath, "debug_adapter"];
			if (debuggerType === DebuggerType.PubTest)
				args.push("--test");
			this.logger.info(`Running custom Dart debugger using Dart VM with args ${args.join("    ")}`);
			return new DebugAdapterExecutable(path.join(this.sdks.dart, dartVMPath), args);
		} else if (config.experimentalFlutterDapPath && (debuggerType === DebuggerType.Flutter || debuggerType === DebuggerType.FlutterTest)) {
			const args = [config.experimentalFlutterDapPath, "debug_adapter"];
			if (debuggerType === DebuggerType.FlutterTest)
				args.push("--test");
			this.logger.info(`Running custom Flutter debugger using Dart VM with args ${args.join("    ")}`);
			return new DebugAdapterExecutable(path.join(this.sdks.dart, dartVMPath), args);
		}

		if (process.env.DART_CODE_USE_DEBUG_SERVERS) {
			const port = getDebugAdapterPort(debuggerName);
			this.logger.info(`Running debugger in server mode on port ${port} because DART_CODE_USE_DEBUG_SERVERS is set`);
			return new DebugAdapterServer(port);
		}

		const args = [this.extensionContext.asAbsolutePath(debugAdapterPath), debuggerName];
		this.logger.info(`Running debugger via node with ${args.join("    ")}`);
		return new DebugAdapterExecutable("node", args);
	}
}
