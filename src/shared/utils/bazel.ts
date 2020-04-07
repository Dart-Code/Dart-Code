import * as fs from "fs";
import * as path from "path";
import { Logger, WorkspaceConfig } from "../interfaces";

export function tryLoadBazelFlutterConfig(logger: Logger, bazelWorkspaceRoot: string | undefined): WorkspaceConfig | undefined {
	if (!bazelWorkspaceRoot)
		return;

	try {
		const configPath = path.join(bazelWorkspaceRoot, "dart/config/intellij-plugins/flutter.json");

		if (!fs.existsSync(configPath))
			return;

		logger.info(`Loading bazel workspace config from ${configPath}`);
		const configJson = fs.readFileSync(configPath, "utf8");
		const config = JSON.parse(configJson);

		function makeFullPath(relOrAbsolute: string | undefined): string | undefined {
			if (!relOrAbsolute)
				return undefined;
			if (path.isAbsolute(relOrAbsolute))
				return relOrAbsolute;
			return path.join(bazelWorkspaceRoot!, relOrAbsolute);
		}

		const resolvedConfig = {
			configFile: configPath,
			devtoolsActivateScript: makeFullPath(config.devtoolsActivateScript),
			devtoolsRunScript: makeFullPath(config.devtoolsRunScript),
			flutterDaemonScript: makeFullPath(config.daemonScript),
			flutterDoctorScript: makeFullPath(config.doctorScript),
			flutterLaunchScript: makeFullPath(config.launchScript),
			flutterSdkHome: makeFullPath(config.sdkHome),
			flutterTestScript: makeFullPath(config.testScript),
			flutterVersionFile: makeFullPath(config.versionFile),
		};

		logger.info(`Using resolved config: ${JSON.stringify(resolvedConfig, undefined, 8)}`);

		return resolvedConfig;
	} catch (e) {
		logger.error(e);
	}
}
