import * as path from "path";
import { DebugAdapterDescriptor, DebugAdapterDescriptorFactory, DebugAdapterExecutable, DebugAdapterServer, DebugSession } from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { dartVMPath, debugAdapterPath, executableNames, flutterPath } from "../../shared/constants";
import { DebuggerType } from "../../shared/enums";
import { CustomScript, DartSdks, Logger } from "../../shared/interfaces";
import { getDebugAdapterName, getDebugAdapterPort } from "../../shared/utils/debug";
import { Context } from "../../shared/vscode/workspace";
import { config } from "../config";

export class DartDebugAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {
	constructor(private readonly sdks: DartSdks, private readonly logger: Logger, private readonly extensionContext: Context, private readonly dartCapabilities: DartCapabilities, private readonly flutterCapabilities: FlutterCapabilities, private readonly flutterToolsScript?: CustomScript, private readonly cwd?: string) { }

	public createDebugAdapterDescriptor(session: DebugSession, executable: DebugAdapterExecutable | undefined): DebugAdapterDescriptor {
		return this.descriptorForType(session.configuration.debuggerType as DebuggerType);
	}

	public descriptorForType(debuggerType: DebuggerType): DebugAdapterDescriptor {
		const debuggerName = getDebugAdapterName(debuggerType);
		this.logger.info(`Using ${debuggerName} debugger for ${DebuggerType[debuggerType]}`);

		const isDartOrDartTest = debuggerType === DebuggerType.Dart || debuggerType === DebuggerType.DartTest;
		const isFlutterOrFlutterTest = debuggerType === DebuggerType.Flutter || debuggerType === DebuggerType.FlutterTest;
		const isDartTestOrFlutterTest = debuggerType === DebuggerType.DartTest || debuggerType === DebuggerType.FlutterTest;
		const isDartTest = debuggerType === DebuggerType.DartTest;
		const isFlutterTest = debuggerType === DebuggerType.FlutterTest;

		let isSdkDapSupported = false;
		if (isDartOrDartTest)
			isSdkDapSupported = this.dartCapabilities.supportsSdkDap;
		else if (isFlutterOrFlutterTest)
			isSdkDapSupported = this.flutterCapabilities.supportsSdkDap;

		const forceSdkDap = process.env.DART_CODE_FORCE_SDK_DAP === "true"
			? true
			: process.env.DART_CODE_FORCE_SDK_DAP === "false"
				? false
				: undefined;
		const useSdkDap = forceSdkDap !== undefined
			? forceSdkDap
			: config.previewSdkDaps && isSdkDapSupported;

		if (useSdkDap) {
			const executable = isDartOrDartTest
				? path.join(this.sdks.dart, dartVMPath)
				: this.flutterToolsScript?.script ?? (this.sdks.flutter ? path.join(this.sdks.flutter, flutterPath) : executableNames.flutter);

			const args = ["debug_adapter"];
			if (isDartTestOrFlutterTest)
				args.push("--test");
			if (isFlutterTest && this.flutterCapabilities.requiresDdsDisabledForSdkDapTestRuns)
				args.push("--no-dds");

			this.logger.info(`Running SDK DAP Dart VM: ${executable} ${args.join("    ")}`);
			return new DebugAdapterExecutable(executable, args, this.cwd ? {cwd: this.cwd} : {});
		} else if (config.customDartDapPath && isDartOrDartTest) {
			const args = [config.customDartDapPath, "debug_adapter"];
			if (isDartTest)
				args.push("--test");
			this.logger.info(`Running custom Dart debugger using Dart VM with args ${args.join("    ")}`);
			return new DebugAdapterExecutable(path.join(this.sdks.dart, dartVMPath), args);
		} else if (config.customFlutterDapPath && isFlutterOrFlutterTest) {
			const args = [config.customFlutterDapPath, "debug_adapter"];
			if (isFlutterTest)
				args.push("--test");
			if (isFlutterTest && this.flutterCapabilities.requiresDdsDisabledForSdkDapTestRuns)
				args.push("--no-dds");
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
