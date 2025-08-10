import * as path from "path";
import { DebugAdapterDescriptor, DebugAdapterDescriptorFactory, DebugAdapterExecutable, DebugAdapterExecutableOptions, DebugAdapterServer, DebugSession } from "vscode";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { FlutterCapabilities } from "../../shared/capabilities/flutter";
import { dartVMPath, debugAdapterPath, executableNames, flutterPath } from "../../shared/constants";
import { DebuggerType } from "../../shared/enums";
import { DartSdks, Logger } from "../../shared/interfaces";
import { getDebugAdapterName, getDebugAdapterPort } from "../../shared/utils/debug";
import { fsPath, isWithinPathOrEqual } from "../../shared/utils/fs";
import { getDartWorkspaceFolders } from "../../shared/vscode/utils";
import { Context } from "../../shared/vscode/workspace";
import { WorkspaceContext } from "../../shared/workspace";
import { Analytics } from "../analytics";
import { config } from "../config";
import { KnownExperiments } from "../experiments";
import { getToolEnv } from "../utils/processes";

export class DartDebugAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {
	constructor(private readonly analytics: Analytics, private readonly sdks: DartSdks, private readonly logger: Logger, private readonly extensionContext: Context, private readonly dartCapabilities: DartCapabilities, private readonly flutterCapabilities: FlutterCapabilities, private readonly workspaceContext: WorkspaceContext, private readonly experiments: KnownExperiments) { }

	public createDebugAdapterDescriptor(session: DebugSession, _executable: DebugAdapterExecutable | undefined): DebugAdapterDescriptor {
		return this.descriptorForType(session.configuration.debuggerType as DebuggerType, !!session.configuration.noDebug);
	}

	public descriptorForType(debuggerType: DebuggerType, noDebug?: boolean): DebugAdapterDescriptor {
		const debuggerName = getDebugAdapterName(debuggerType);
		this.logger.info(`Using ${debuggerName} debugger for ${DebuggerType[debuggerType]}`);

		const isDartOrDartTest = debuggerType === DebuggerType.Dart || debuggerType === DebuggerType.DartTest;
		const isFlutterOrFlutterTest = debuggerType === DebuggerType.Flutter || debuggerType === DebuggerType.FlutterTest;
		const isDartTestOrFlutterTest = debuggerType === DebuggerType.DartTest || debuggerType === DebuggerType.FlutterTest;
		const isDartTest = debuggerType === DebuggerType.DartTest;
		const isFlutterTest = debuggerType === DebuggerType.FlutterTest;

		let isPreReleaseSdk = false;
		let isInSdkDapExperiment = false;
		if (isDartOrDartTest) {
			isPreReleaseSdk = this.dartCapabilities.version.includes("-");
			isInSdkDapExperiment = this.experiments.dartSdkDaps.applies;
		} else if (isFlutterOrFlutterTest) {
			isPreReleaseSdk = this.flutterCapabilities.version.includes("-");
			isInSdkDapExperiment = this.flutterCapabilities.useLegacyDapExperiment
				? this.experiments.flutterSdkDapsLegacy.applies
				: this.experiments.flutterSdkDaps.applies;
		}

		const forceSdkDap = process.env.DART_CODE_FORCE_SDK_DAP === "true"
			? true
			: process.env.DART_CODE_FORCE_SDK_DAP === "false"
				? false
				: undefined;
		let useSdkDap: boolean;
		let sdkDapReason: string;
		if (forceSdkDap !== undefined) {
			useSdkDap = forceSdkDap;
			sdkDapReason = "DART_CODE_FORCE_SDK_DAP env variable";
		} else {
			if (this.workspaceContext.config.forceFlutterWorkspace) {
				useSdkDap = true;
				sdkDapReason = "workspaceContext.config.forceFlutterWorkspace";
			} else if (config.useLegacyDebugAdapters !== undefined) {
				useSdkDap = !config.useLegacyDebugAdapters;
				sdkDapReason = "config.useLegacyDebugAdapters";
			} else if (isPreReleaseSdk) {
				useSdkDap = true;
				sdkDapReason = "canDefaultToSdkDap and using pre-release SDK";
			} else {
				useSdkDap = isInSdkDapExperiment;
				sdkDapReason = "sdkDaps experiment";
			}
		}
		this.logger.info(`SDK DAP setting is ${useSdkDap}, set by ${sdkDapReason}`);


		const analytics = this.analytics;
		function logDebuggerStart(sdkDap: boolean) {
			analytics.logDebuggerStart(
				DebuggerType[debuggerType],
				noDebug ? "Run" : "Debug",
				sdkDap,
			);
		}

		const toolEnv = getToolEnv();

		// If FLUTTER_ROOT hasn't been set explicitly and any of our open workspace are in the Flutter SDK we're using, then
		// set that SDK path as FLUTTER_ROOT.
		const flutterSdk = this.sdks.flutter;
		if (!process.env.FLUTTER_ROOT && !toolEnv.FLUTTER_ROOT && flutterSdk) {
			const openFlutterSdkFolders = getDartWorkspaceFolders()?.find((wf) => isWithinPathOrEqual(fsPath(wf.uri), flutterSdk));
			if (openFlutterSdkFolders)
				toolEnv.FLUTTER_ROOT = flutterSdk;
		}

		const executableOptions: DebugAdapterExecutableOptions = {
			env: toolEnv,
		};

		if (config.customDartDapPath && isDartOrDartTest) {
			const args = [config.customDartDapPath, "debug_adapter"];
			if (isDartTest)
				args.push("--test");

			this.logger.info(`Running custom Dart debugger using Dart VM with args ${args.join("    ")} and options ${JSON.stringify(executableOptions)}`);
			return new DebugAdapterExecutable(path.join(this.sdks.dart, dartVMPath), args, executableOptions);
		} else if (config.customFlutterDapPath && isFlutterOrFlutterTest) {
			const args = [config.customFlutterDapPath, "debug_adapter"];
			if (isFlutterTest)
				args.push("--test");

			this.logger.info(`Running custom Flutter debugger using Dart VM with args ${args.join("    ")} and options ${JSON.stringify(executableOptions)}`);
			return new DebugAdapterExecutable(path.join(this.sdks.dart, dartVMPath), args, executableOptions);
		} else if (useSdkDap) {
			const executable = isDartOrDartTest
				? path.join(this.sdks.dart, dartVMPath)
				: this.workspaceContext.config.flutterToolsScript?.script ?? (this.sdks.flutter ? path.join(this.sdks.flutter, flutterPath) : executableNames.flutter);

			const args = ["debug_adapter"];
			if (isDartTestOrFlutterTest)
				args.push("--test");

			if (this.workspaceContext.config.flutterSdkHome)
				executableOptions.cwd = this.workspaceContext.config.flutterSdkHome;

			this.logger.info(`Running SDK DAP Dart VM in ${executableOptions.cwd}: ${executable} ${args.join("    ")} and options ${JSON.stringify(executableOptions)}`);
			logDebuggerStart(true);
			return new DebugAdapterExecutable(executable, args, executableOptions);
		}

		if (process.env.DART_CODE_USE_DEBUG_SERVERS) {
			const port = getDebugAdapterPort(debuggerName);
			this.logger.info(`Running debugger in server mode on port ${port} because DART_CODE_USE_DEBUG_SERVERS is set`);
			return new DebugAdapterServer(port);
		}

		const args = [this.extensionContext.asAbsolutePath(debugAdapterPath), debuggerName];
		this.logger.info(`Running debugger via node with ${args.join("    ")}`);
		logDebuggerStart(false);
		return new DebugAdapterExecutable("node", args);
	}
}
