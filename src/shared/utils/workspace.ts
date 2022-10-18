import * as fs from "fs";
import * as path from "path";
import { isWin, MAX_VERSION } from "../constants";
import { CustomScript, Logger, WritableWorkspaceConfig } from "../interfaces";

export function processDartSdkRepository(logger: Logger, config: WritableWorkspaceConfig, dartSdkRoot: string) {
	config.disableAutomaticPackageGet = true;
	// The Dart SDKs tests cannot run using pub, so also force them to use the VM.
	config.useVmForTests = true;
}

export function processFuchsiaWorkspace(logger: Logger, config: WritableWorkspaceConfig, fuchsiaRoot: string) {
	config.disableAutomaticPackageGet = true;
	config.disableSdkUpdateChecks = true;
}

export function processBazelWorkspace(logger: Logger, config: WritableWorkspaceConfig, bazelWorkspaceRoot: string) {
	config.disableAutomaticPackageGet = true;
	config.disableSdkUpdateChecks = true;

	tryProcessBazelFlutterConfig(logger, config, bazelWorkspaceRoot);
}

export function tryProcessBazelFlutterConfig(logger: Logger, config: WritableWorkspaceConfig, bazelWorkspaceRoot: string) {
	// flutter.json does not support windows.
	if (isWin)
		return;

	try {
		const flutterConfigPath = path.join(bazelWorkspaceRoot, "dart/config/ide/flutter.json");
		if (!fs.existsSync(flutterConfigPath))
			return;

		logger.info(`Loading Bazel Flutter config from ${flutterConfigPath}`);
		const flutterConfigJson = fs.readFileSync(flutterConfigPath, "utf8");
		const flutterConfig = JSON.parse(flutterConfigJson) as {
			daemonScript: string | undefined;
			devToolsScript: string | undefined;
			doctorScript: string | undefined;
			runScript: string | undefined;
			sdkHome: string | undefined; // Note: This refers to Flutter SDK home, not Dart.
			testScript: string | undefined;
			toolsScript: string | undefined;
			defaultDartSdk: string | undefined;
			restartMacDaemonMessage: string | undefined;
			localDeviceCommandAdviceMessage: string | undefined;
			localMacWarningMessage: string | undefined;
		};

		function makeFullPath(relOrAbsolute: string | undefined): string | undefined {
			if (!relOrAbsolute)
				return relOrAbsolute;
			if (path.isAbsolute(relOrAbsolute))
				return relOrAbsolute;
			return path.join(bazelWorkspaceRoot, relOrAbsolute);
		}

		function makeScript(relOrAbsolute: string | undefined, replacesArgs = 1): CustomScript | undefined {
			if (relOrAbsolute) {
				return {
					replacesArgs,
					script: makeFullPath(relOrAbsolute),
				};
			}
		}

		config.forceFlutterWorkspace = true;
		config.forceFlutterDebug = true;
		config.skipFlutterInitialization = true;
		config.omitTargetFlag = true;
		config.startDevToolsServerEagerly = true;
		config.flutterVersion = MAX_VERSION;
		config.flutterDevToolsScript = makeScript(flutterConfig.devToolsScript);
		config.flutterDaemonScript = makeScript(flutterConfig.daemonScript);
		config.flutterDoctorScript = makeScript(flutterConfig.doctorScript);
		config.flutterRunScript = makeScript(flutterConfig.runScript);
		config.flutterSdkHome = makeFullPath(flutterConfig.sdkHome);
		config.flutterTestScript = makeScript(flutterConfig.testScript);

		// TODO (helin24): This is a generic script that can be used with some of the Flutter commands, e.g. `debug_adapter`, `doctor`, and `daemon`.
		// We should eventually change over the other scripts to use this one to reduce the number of scripts needed.
		config.flutterToolsScript = makeScript(flutterConfig.toolsScript);
		config.defaultDartSdk = makeFullPath(flutterConfig.defaultDartSdk);

		config.restartMacDaemonMessage = flutterConfig.restartMacDaemonMessage;
		config.localDeviceCommandAdviceMessage = flutterConfig.localDeviceCommandAdviceMessage;
		config.localMacWarningMessage = flutterConfig.localMacWarningMessage;
	} catch (e) {
		logger.error(e);
	}
}
