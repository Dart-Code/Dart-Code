import * as fs from "fs";
import * as path from "path";
import * as semver from "semver";
import { DartTestCapabilities } from "../../shared/capabilities/dart_test";
import { packageTestCapabilitiesCacheTimeInMs } from "../../shared/constants";
import { Logger } from "../../shared/interfaces";
import { PackageMap } from "../pub/package_map";
import { SimpleTimeBasedCache } from "../utils/cache";
import { WorkspaceContext } from "../workspace";

/** A cache of both project folder + package config paths, to the capabilities. */
export const cachedTestCapabilities = new SimpleTimeBasedCache<DartTestCapabilities>();

/**
 * Get the capabilities by reading the version from package_graph.json.
 *
 * Returns `undefined` if the graph/version cannot be read.
 */
function getCapabilitiesFromVersionInPackageGraph(logger: Logger, packageFile: string): DartTestCapabilities | undefined {
	const packageGraphFile = path.join(path.dirname(packageFile), "package_graph.json");

	try {
		const packageGraphJson = fs.readFileSync(packageGraphFile, "utf8");
		const packageGraph = JSON.parse(packageGraphJson) as PackageGraphJson;
		const testVersion = packageGraph.packages?.find((pkg) => pkg.name === "test")?.version;

		if (!testVersion)
			return undefined;

		if (semver.valid(testVersion))
			return new DartTestCapabilities(testVersion);

		logger.warn(`Failed to parse pkg:test version number from ${packageGraphFile}: ${testVersion}`);
	} catch (e: any) {
		if (e?.code !== "ENOENT")
			logger.warn(`Failed to read pkg:test version number from ${packageGraphFile}: ${e}`);
	}

	return undefined;
}

/**
 * Gets the pkg:test capabilities for a Dart project.
 *
 * This function should not be used for Flutter projects, as Flutter uses flutter_test and capabilities for that are
 * versioned with the Flutter SDK and don't need a package version check.
 */
export function getPackageTestCapabilitiesForDartProject(logger: Logger, workspaceContext: WorkspaceContext, folderPath: string): DartTestCapabilities {
	// Don't look for a version in places where we don't support `dart run test`.
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

	try {
		const capabilities = getCapabilitiesFromVersionInPackageGraph(logger, packageFile) ?? DartTestCapabilities.empty;
		cachedTestCapabilities.add(folderPath, capabilities, packageTestCapabilitiesCacheTimeInMs);
		cachedTestCapabilities.add(packageFile, capabilities, packageTestCapabilitiesCacheTimeInMs);

		return capabilities;
	} catch (e) {
		logger.error(`Failed to get package:test capabilities: ${e}`);

		return DartTestCapabilities.empty;
	}
}

interface PackageGraphJson {
	packages?: PackageGraphPackage[];
}

interface PackageGraphPackage {
	name: string;
	version?: string;
}
