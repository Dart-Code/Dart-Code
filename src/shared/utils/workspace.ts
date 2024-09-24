import * as fs from "fs";
import * as path from "path";
import { isWin, MAX_VERSION } from "../constants";
import { CustomScript, ExtensionConfig, Logger, WritableWorkspaceConfig } from "../interfaces";

export function processDartSdkRepository(logger: Logger, config: WritableWorkspaceConfig, dartSdkRoot: string, extensionConfig: ExtensionConfig) {
	config.disableAutomaticPub = true;
	// The Dart SDKs tests cannot run using pkg:test, so force them to use the VM.
	config.supportsPackageTest = extensionConfig.experimentalTestRunnerInSdk;
	config.supportsDartRunTest = false;
}

export function processFuchsiaWorkspace(logger: Logger, config: WritableWorkspaceConfig, fuchsiaRoot: string, extensionConfig: ExtensionConfig) {
	config.disableAutomaticPub = true;
	config.disableSdkUpdateChecks = true;
	config.disableDartToolingDaemon = true;
}

export function processBazelWorkspace(logger: Logger, config: WritableWorkspaceConfig, bazelWorkspaceRoot: string, extensionConfig: ExtensionConfig) {
	config.disableAutomaticPub = true;
	config.disableSdkUpdateChecks = true;
	config.disableDartToolingDaemon = true;

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
		config.flutterToolsScript = makeScript(flutterConfig.toolsScript, 0);
		config.defaultDartSdk = makeFullPath(flutterConfig.defaultDartSdk);

		config.restartMacDaemonMessage = flutterConfig.restartMacDaemonMessage;
		config.localDeviceCommandAdviceMessage = flutterConfig.localDeviceCommandAdviceMessage;
		config.localMacWarningMessage = flutterConfig.localMacWarningMessage;
		config.supportsPackageTest = true;

		// It's not valid to run "dart run test:test --version" here. This means
		// that we won't ever enable any "new" package:test functionality
		// (see `DartTestCapabilities`). If in future we'd like to support that,
		// we could store a packageTestVersion here (like `flutterVersion` above)
		// or if the capabilities need to be enabled individually, hang a whole
		// `DartTestCapabilities` override here.
		config.supportsDartRunTest = false;
	} catch (e) {
		logger.error(e);
	}
}

// Cleans a version in the form x.y.z-foo.a.b.c into just
// x.y-foo to reduce the number of unique versions being recorded.
//
// To avoid trailing zeros being trimmed (eg. "3.10" being treated as the number
// 3.1), the version will actually be reported like "3.10.x" where x is literally "x"
// for all versions.
export function simplifyVersion(rawVersion: any): string | undefined {
	if (typeof rawVersion !== "string")
		return;

	const parts = rawVersion.split("-");
	const versionNumber = parts[0];
	const versions = versionNumber.split(".");
	const prereleasePart = parts.length > 1 ? parts[1] : undefined;
	let prereleaseTag: string | undefined;
	for (const knownName of ["beta", "alpha", "dev", "edge"]) {
		if (prereleasePart?.includes(knownName))
			prereleaseTag = knownName;
	}


	const cleanParts: string[] = [];
	if (versions[0].length)
		cleanParts.push(versions[0]);
	else
		cleanParts.push("0");
	if (versions.length > 1)
		cleanParts.push(`.${versions[1]}`);
	else
		cleanParts.push(`.x`);
	cleanParts.push(`.x`); // 0.0.x
	if (prereleaseTag)
		cleanParts.push(`-${prereleaseTag}`);
	else if (prereleasePart)
		cleanParts.push(`-pre`);
	return cleanParts.join("");
}
