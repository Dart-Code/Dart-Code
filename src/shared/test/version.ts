import * as path from "path";
import * as semver from "semver";
import { DartTestCapabilities, DartTestCapabilitiesFromHelpText } from "../../shared/capabilities/dart_test";
import { dartVMPath } from "../../shared/constants";
import { DartSdks, Logger } from "../../shared/interfaces";
import { runProcess, safeSpawn } from "../processes";
import { WorkspaceContext } from "../workspace";

const cachedTestCapabilities: Record<string, DartTestCapabilities> = {};

/// Get the capabilities by using "dart test --version".
///
/// Returns `undefined` in the case where `--version` doesn't work, and we should fall back to `--help`.
async function getCapabilitiesFromVersion(logger: Logger, binPath: string, folder: string): Promise<DartTestCapabilities | undefined> {
	const proc = await runProcess(logger, binPath, ["run", "test:test", "--version"], folder, {}, safeSpawn);
	if (proc.exitCode === 0) {
		const output = proc.stdout.trim();
		if (semver.valid(output))
			return new DartTestCapabilities(output);
		else
			console.warn(`Failed to parse pkg:test version number: ${output}`);
	} else {
		// Log failure.
		const output = (proc.stdout.trim() + "\n" + proc.stderr.trim()).trim();
		console.warn(`Failed to get pkg:test version number: ${output}`);

		// In Pub workspaces, the version is not (currently) available because
		// of https://github.com/dart-lang/test/issues/2535, so if we see this message,
		// fall back to using the `--help` text to determine the capabilities.
		if (output.includes("Couldn't find version number")) {
			return undefined; // Signal that we should fall back to --help.
		}
	}

	return DartTestCapabilities.empty;
}

/// Get the capabilities by using "dart test --help" and reading the flags.
///
/// This is a fallback for when --version does not work - see
/// https://github.com/dart-lang/test/issues/2535
async function getCapabilitiesFromHelp(logger: Logger, binPath: string, folder: string): Promise<DartTestCapabilities> {
	const proc = await runProcess(logger, binPath, ["test", "--help"], folder, {}, safeSpawn);
	if (proc.exitCode === 0) {
		const helpText = proc.stdout.trim();
		return new DartTestCapabilitiesFromHelpText(helpText);
	} else {
		const output = (proc.stdout.trim() + "\n" + proc.stderr.trim()).trim();
		console.warn(`Failed to get pkg:test capabilities from --help: ${output}`);
		return DartTestCapabilities.empty;
	}
}

export async function getPackageTestCapabilities(logger: Logger, workspaceContext: WorkspaceContext, folder: string): Promise<DartTestCapabilities> {
	// Don't ever run the command below in places like g3.
	if (workspaceContext.config.supportsDartRunTest === false)
		return DartTestCapabilities.empty;

	const sdks = workspaceContext.sdks as DartSdks;
	if (!cachedTestCapabilities[folder]) {
		const binPath = path.join(sdks.dart, dartVMPath);

		const capabilities =
			// First try to get the version from "dart run test:test --version".
			await getCapabilitiesFromVersion(logger, binPath, folder)
			// If that returns undefined, we should fall back to using "dart test --help".
			?? await getCapabilitiesFromHelp(logger, binPath, folder);

		cachedTestCapabilities[folder] = capabilities;
	}

	return cachedTestCapabilities[folder];

}
