import * as path from "path";
import { DartCapabilities } from "../capabilities/dart";
import { dartVMPath, flutterPath } from "../constants";
import { DartWorkspaceContext, Logger } from "../interfaces";
import { runProcess, safeSpawn } from "../processes";
import { isFlutterProjectFolder, tryGetPackageName } from "../utils/fs";

export type DependencyType = "root" | "direct" | "dev" | "transitive";

/// Interacts with "pub deps --json" to look up types of dependencies.
export class PubDeps {
	constructor(private readonly logger: Logger, private readonly context: DartWorkspaceContext, private readonly dartCapabilities: DartCapabilities) { }

	public buildTree(json: PubDepsJson, packageName: string): PubDepsTree {
		const packages: PubDepsJsonPackageLookup = {};
		const rootPackageNames: string[] = [];
		for (const p of json.packages) {
			packages[p.name] = p;
			// TODO(dantup): Right now we only find the root for the specific package name. For non-workspaces
			//  this is the only root. For Workspaces, this means we're running "pub deps" for each project
			//  in the workspace and discarding the results for the others. This could potentially be optimized,
			//  however since we expand the nodes lazily, there might not be much benefit.
			if (p.kind === "root" && p.name === packageName)
				rootPackageNames.push(p.name);
		}

		rootPackageNames.sort();

		return {
			roots: rootPackageNames.map((name) => packages[name]).filter((pkg) => pkg).map((pkg) => this._buildRoot(pkg, packages)),
		};
	}

	private _buildRoot(pkg: PubDepsJsonPackage, packages: PubDepsJsonPackageLookup): PubDepsTreeRootPackage {
		// If a node has a "directDependencies" node then we've got the new format
		// (see https://github.com/dart-lang/pub/pull/4383).
		//
		// For the new format, we use:
		//   directDependencies: `pkg.directDependencies`
		//   devDependencies: `pkg.devDependencies`
		//   transitiveDependencies: walk down `pkg.dependencies` collecting from child `dependencies` where not already seen
		//
		// Otherwise, we use:
		//   directDependencies: `pkg.dependencies.filter((dep) => dep?.kind === "direct")`
		//   devDependencies: `pkg.devDependencies.filter((dep) => dep?.kind === "dev")`
		//   transitiveDependencies: walk down `pkg.dependencies` collecting from child `dependencies` where not already seen

		const isNewFormat = !!pkg.directDependencies;


		const allDependencies = pkg.dependencies?.map((name) => packages[name]).filter((pkg) => pkg) ?? [];
		const directDependencies = isNewFormat
			? pkg.directDependencies?.map((name) => packages[name]).filter((pkg) => pkg) ?? []
			: allDependencies.filter((dep) => dep?.kind === "direct");
		const devDependencies = isNewFormat
			? pkg.devDependencies?.map((name) => packages[name]).filter((pkg) => pkg) ?? []
			: allDependencies.filter((dep) => dep?.kind === "dev");
		directDependencies.sort((d1, d2) => d1.name.localeCompare(d2.name));
		devDependencies.sort((d1, d2) => d1.name.localeCompare(d2.name));

		return {
			dependencies: directDependencies.map((pkg) => this._buildDependency(pkg)),
			devDependencies: devDependencies.map((pkg) => this._buildDependency(pkg)),
			name: pkg.name,
			transitiveDependencies: this._buildTransitiveDependencies(pkg, packages),
			version: pkg.version,
		};
	}

	private _buildDependency(pkg: PubDepsJsonPackage): PubDepsTreePackageDependency {
		return {
			name: pkg.name,
			version: pkg.version,
		};
	}

	private _buildTransitiveDependencies(pkg: PubDepsJsonPackage, packages: PubDepsJsonPackageLookup): PubDepsTreePackageTransitiveDependency[] {
		const pkgDependencies = [...(pkg.dependencies ?? []), ...(pkg.devDependencies ?? [])].map((name) => packages[name]).filter((pkg) => pkg);
		const results: { [key: string]: PubDepsTreePackageTransitiveDependency } = {};

		// Queue is a list of pairs of packages to process, and the first (shortest) paths to get to them.
		const queue: Array<[string, PubDepsTreePackageTransitiveDependency]> = [];
		for (const dependency of pkgDependencies) {
			queue.push([dependency.name, {
				name: dependency.name,
				shortestPath: [dependency.name],
				version: dependency.version,
			}]);
		}

		// Traverse the tree breadth-first, so that the first time we come across any node, we know that is
		// the shortest path.
		// eslint-disable-next-line @typescript-eslint/prefer-for-of
		for (let i = 0; i < queue.length; i++) {
			const [pkgName, transitiveDependency] = queue[i];

			// Loop over this packages dependencies, and if we've not previously been to them
			// this is (one of) the shortest paths there.
			const dependencies = (packages[pkgName]?.dependencies ?? []).map((name) => packages[name]).filter((pkg) => pkg); // We don't have dev deps for non-roots.
			for (const dependency of dependencies) {
				if (results[dependency.name])
					continue;

				const newTransitiveDependency: PubDepsTreePackageTransitiveDependency = {
					name: dependency.name,
					shortestPath: [...transitiveDependency.shortestPath, dependency.name],
					version: dependency.version,
				};
				results[dependency.name] = newTransitiveDependency;

				// Also push the dependency onto the queue to process its dependencies.
				queue.push([dependency.name, newTransitiveDependency]);
			}
		}

		const resultDependencies = Object.values(results);
		resultDependencies.sort((d1, d2) => d1.name.localeCompare(d2.name));
		return resultDependencies;
	}

	public async getTree(projectDirectory: string): Promise<PubDepsTree | undefined> {
		const packageName = tryGetPackageName(projectDirectory) ?? path.basename(projectDirectory);
		const json = await this.getJson(projectDirectory);
		return json ? this.buildTree(json, packageName) : undefined;
	}

	public async getJson(projectDirectory: string): Promise<PubDepsJson | undefined> {
		if (this.context.config.disableAutomaticPub) {
			return undefined;
		}

		const sdks = this.context.sdks;
		const binPath = isFlutterProjectFolder(projectDirectory) && sdks.flutter
			? path.join(sdks.flutter, flutterPath)
			: path.join(sdks.dart, dartVMPath);
		const result = await runProcess(this.logger, binPath, ["pub", "deps", "--json"], projectDirectory, undefined, safeSpawn);

		if (result.exitCode !== 0) {
			this.logger.error(`Running "pub deps --json" returned exit code ${result.exitCode}:\n${result.stdout}\n${result.stderr}`);
			return undefined;
		}

		let json = result.stdout;
		try {
			// If this is the first run of Flutter, it might output a banner ("Welcome to Flutter"). We can't use the
			// usual JSON-parsing here, because it's not all on one line, so just trim anything before the first `{` which
			// handle any additional output (as long as it doesn't include a brace itself).
			let bracePosition: number;
			if (!json.startsWith("{") && (bracePosition = json.indexOf("{")) !== -1) {
				json = json.substring(bracePosition);
			}

			return JSON.parse(json) as PubDepsJson;
		} catch (e) {
			this.logger.error(`"pub deps --json" returned invalid JSON ${e}:\n${json}`);
			return undefined;
		}
	}
}

/// The root object of `pub deps --json` output.
///
/// These types cover both the pre-workspaces and post-workspaces
/// versions, for example including `devDependencies` on packages
/// even though they were included in `dependencies` pre-workspaces.
export interface PubDepsJson {
	packages: PubDepsJsonPackage[];
}

/// A package in the `pub deps --json` output.
///
/// These types cover both the pre-workspaces and post-workspaces
/// versions, for example including `directDependencies`/`devDependencies` on packages
/// even though they were not included in `dependencies` pre-workspaces.
export interface PubDepsJsonPackage {
	name: string;
	version: string;
	kind: DependencyType;
	dependencies: string[] | undefined;
	directDependencies?: string[] | undefined;
	devDependencies?: string[] | undefined;
}

/// A lookup of package name -> [PubDepsJsonPackage].
export interface PubDepsJsonPackageLookup { [key: string]: PubDepsJsonPackage }

/// The results of parsing a [PubDepsJson] to compute a set of trees
/// for dependencies, devDependencies, and transitiveDependencies with
/// shortest paths.
export interface PubDepsTree {
	roots: PubDepsTreeRootPackage[];
}

/// A root package in a [PubDepsTree] along with dependencies,
/// devDependencies, and transitiveDependencies with shortest paths.
export interface PubDepsTreeRootPackage {
	name: string;
	version: string;
	dependencies?: PubDepsTreePackageDependency[];
	devDependencies?: PubDepsTreePackageDependency[];
	transitiveDependencies?: PubDepsTreePackageDependency[];
}

/// A individual dependency in a [PubDepsTree].
export interface PubDepsTreePackageDependency {
	name: string;
	version: string;
}

/// A individual transitive dependency in a [PubDepsTree] with shortest path.
export interface PubDepsTreePackageTransitiveDependency extends PubDepsTreePackageDependency {
	shortestPath: string[];
}
