import * as path from "path";
import * as semver from "semver";
import { DartTestCapabilities, DartTestCapabilitiesFromHelpText } from "../../shared/capabilities/dart_test";
import { dartVMPath, packageTestCapabilitiesCacheTimeInMs } from "../../shared/constants";
import { DartSdks, Logger } from "../../shared/interfaces";
import { runProcess, safeSpawn } from "../processes";
import { PackageMap } from "../pub/package_map";
import { PromiseCompleter } from "../utils";
import { SimpleTimeBasedCache } from "../utils/cache";
import { WorkspaceContext } from "../workspace";

/// A cache of both project folder + package config paths, to the capabilities.
export const cachedTestCapabilities = new SimpleTimeBasedCache<Promise<DartTestCapabilities>>();

/// Get the capabilities by using "dart test --version".
///
/// Returns `undefined` in the case where `--version` doesn't work, and we should fall back to `--help`.
async function getCapabilitiesFromVersion(logger: Logger, binPath: string, folder: string): Promise<DartTestCapabilities | undefined> {
	const proc = await runProcess(logger, binPath, ["run", "test:test", "--version"], folder, {}, safeSpawn);
	if (proc.exitCode === 0) {
		// Take the last line of the output, because we can get "Resolving dependencies..." in front of it.
		const output = proc.stdout.trim().split("\n").pop()?.trim();
		if (output && semver.valid(output))
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

export async function getPackageTestCapabilities(logger: Logger, workspaceContext: WorkspaceContext, folderPath: string): Promise<DartTestCapabilities> {
	// Don't ever run the command below in places like g3.
	if (workspaceContext.config.supportsDartRunTest === false)
		return DartTestCapabilities.empty;

	// We cache by both folder and package map so we can look up a cache value without
	// having to locate the package map.
	let cached = cachedTestCapabilities.get(folderPath);
	if (cached !== undefined)
		return cached;

	// Test capabilities are the same for projects in a workspace, so look up the package map path and we'll also cache
	// on that. If there is no package map, there is no pkg:test.
	const packageFile = PackageMap.findPackagesFile(folderPath);
	if (!packageFile)
		return DartTestCapabilities.empty;

	// Check the cache again for the package map.
	cached = cachedTestCapabilities.get(packageFile);
	if (cached !== undefined)
		return cached;

	const sdks = workspaceContext.sdks as DartSdks;
	const completer = new PromiseCompleter<DartTestCapabilities>();
	cachedTestCapabilities.add(folderPath, completer.promise, packageTestCapabilitiesCacheTimeInMs);
	cachedTestCapabilities.add(packageFile, completer.promise, packageTestCapabilitiesCacheTimeInMs);
	const binPath = path.join(sdks.dart, dartVMPath);

	try {
		const capabilities =
			// First try to get the version from "dart run test:test --version".
			await getCapabilitiesFromVersion(logger, binPath, folderPath)
			// If that returns undefined, we should fall back to using "dart test --help".
			?? await getCapabilitiesFromHelp(logger, binPath, folderPath);

		completer.resolve(capabilities);

		return capabilities;
	} catch (e) {
		logger.error(`Failed to get package:test capabilities: ${e}`);

		completer.resolve(DartTestCapabilities.empty);
		return DartTestCapabilities.empty;
	}
}
