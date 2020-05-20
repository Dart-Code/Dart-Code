import * as fs from "fs";
import * as path from "path";
import { Logger, WritableWorkspaceConfig } from "../interfaces";

export function processKnownGitRepositories(logger: Logger, config: WritableWorkspaceConfig, gitRoot: string) {
	// Disable automatic package fetching in the Dart SDK repo.
	const isDartSdkRepo = fs.existsSync(path.join(gitRoot, "README.dart-sdk")) && fs.existsSync(path.join(gitRoot, ".packages"));
	if (isDartSdkRepo) {
		config.disableAutomaticPackageGet = true;
		config.useVmForTests = true;
	}
}

export function processFuchsiaWorkspace(logger: Logger, config: WritableWorkspaceConfig, fuchsiaRoot: string) {
	config.disableAutomaticPackageGet = true;
	config.disableSdkUpdateChecks = true;
}

export function processBazelWorkspace(logger: Logger, config: WritableWorkspaceConfig, bazelWorkspaceRoot: string) {
	// For all bazel workspaces, we disabled automatically running pub get.
	config.disableAutomaticPackageGet = true;
	config.disableSdkUpdateChecks = true;

	// Load config from the flutter.json file.
	tryProcessBazelFlutterConfig(logger, config, bazelWorkspaceRoot);
}

export function tryProcessBazelFlutterConfig(logger: Logger, config: WritableWorkspaceConfig, bazelWorkspaceRoot: string) {
	try {
		const flutterConfigPath = path.join(bazelWorkspaceRoot, "dart/config/intellij-plugins/flutter.json");
		if (!fs.existsSync(flutterConfigPath))
			return;

		logger.info(`Loading bazel Flutter config from ${flutterConfigPath}`);
		const flutterConfigJson = fs.readFileSync(flutterConfigPath, "utf8");
		const flutterConfig = JSON.parse(flutterConfigJson);

		function makeFullPath(relOrAbsolute: string | undefined): string | undefined {
			if (!relOrAbsolute)
				return undefined;
			if (path.isAbsolute(relOrAbsolute))
				return relOrAbsolute;
			return path.join(bazelWorkspaceRoot!, relOrAbsolute);
		}

		config.activateDevToolsEagerly = !!flutterConfig.devtoolsActivateScript;
		config.dartSdkHomeLinux = makeFullPath(flutterConfig.dartSdkHome?.linux);
		config.dartSdkHomeMac = makeFullPath(flutterConfig.dartSdkHome?.macos);
		config.devtoolsActivateScript = makeFullPath(flutterConfig.devtoolsActivateScript);
		config.devtoolsRunScript = makeFullPath(flutterConfig.devtoolsRunScript);
		config.flutterDaemonScript = makeFullPath(flutterConfig.daemonScript);
		config.flutterDoctorScript = makeFullPath(flutterConfig.doctorScript);
		config.flutterRunScript = makeFullPath(flutterConfig.runScript);
		config.flutterSdkHome = makeFullPath(flutterConfig.sdkHome);
		config.flutterTestScript = makeFullPath(flutterConfig.testScript);
		config.flutterVersionFile = makeFullPath(flutterConfig.versionFile);
	} catch (e) {
		logger.error(e);
	}
}
