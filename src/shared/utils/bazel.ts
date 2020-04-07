import * as fs from "fs";
import * as path from "path";
import { Logger, WorkspaceConfig } from "../interfaces";

export function tryLoadBazelFlutterConfig(logger: Logger, bazelWorkspaceRoot: string | undefined): WorkspaceConfig | undefined {
	if (!bazelWorkspaceRoot)
		return;

	try {
		const readonlyPath = path.join(bazelWorkspaceRoot, "../READONLY", path.basename(bazelWorkspaceRoot));
		const configPath = path.join(readonlyPath, "dart/config/intellij-plugins/flutter.json");

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
			return path.join(readonlyPath, relOrAbsolute);
		}

		return {
			configFile: configPath,
			devtoolsScript: makeFullPath(config.devtoolsScript),
			flutterDaemonScript: makeFullPath(config.daemonScript),
			flutterDoctorScript: makeFullPath(config.doctorScript),
			flutterLaunchScript: makeFullPath(config.launchScript),
			flutterSdkHome: makeFullPath(config.sdkHome),
			flutterTestScript: makeFullPath(config.testScript),
			flutterVersionFile: makeFullPath(config.versionFile),
		};
	} catch (e) {
		logger.error(e);
	}
}
