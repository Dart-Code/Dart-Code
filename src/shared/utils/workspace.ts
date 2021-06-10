import * as fs from "fs";
import * as path from "path";
import { isWin, MAX_VERSION } from "../constants";
import { CustomScript, Logger, WritableWorkspaceConfig } from "../interfaces";

export function processKnownGitRepositories(logger: Logger, config: WritableWorkspaceConfig, gitRoot: string) {
	const isDartSdkRepo = fs.existsSync(path.join(gitRoot, "README.dart-sdk")) && fs.existsSync(path.join(gitRoot, ".packages"));
	if (isDartSdkRepo) {
		config.disableAutomaticPackageGet = true;
		// The Dart SDKs tests cannot run using pub, so also force them to use the VM.
		config.useVmForTests = true;
	}
}

export function processFuchsiaWorkspace(logger: Logger, config: WritableWorkspaceConfig, fuchsiaRoot: string) {
	config.disableAutomaticPackageGet = true;
	config.disableSdkUpdateChecks = true;
}

export function processBazelWorkspace(logger: Logger, config: WritableWorkspaceConfig, bazelWorkspaceRoot: string, parseFlutterJson: boolean) {
	config.disableAutomaticPackageGet = true;
	config.disableSdkUpdateChecks = true;

	if (parseFlutterJson)
		tryProcessBazelFlutterConfig(logger, config, bazelWorkspaceRoot);
}

export function tryProcessBazelFlutterConfig(logger: Logger, config: WritableWorkspaceConfig, bazelWorkspaceRoot: string) {
	// flutter.json does not support windows.
	if (isWin)
		return;

	try {
		const flutterConfigPath = path.join(bazelWorkspaceRoot, "dart/config/intellij-plugins/flutter.json");
		if (!fs.existsSync(flutterConfigPath))
			return;

		logger.info(`Loading Bazel Flutter config from ${flutterConfigPath}`);
		const flutterConfigJson = fs.readFileSync(flutterConfigPath, "utf8");
		const flutterConfig = JSON.parse(flutterConfigJson);

		function makeFullPath(relOrAbsolute: string): string {
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

		config.forceFlutterMode = true;
		config.skipFlutterInitialization = true;
		config.flutterVersion = MAX_VERSION;
		config.flutterDaemonScript = makeScript(flutterConfig.daemonScript);
		config.flutterDoctorScript = makeScript(flutterConfig.doctorScript);
		config.flutterRunScript = makeScript(flutterConfig.runScript);
		config.flutterSdkHome = makeFullPath(flutterConfig.sdkHome);
		config.flutterTestScript = makeScript(flutterConfig.testScript);
	} catch (e) {
		logger.error(e);
	}
}
