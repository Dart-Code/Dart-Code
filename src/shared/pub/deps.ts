import * as path from "path";
import { DartCapabilities } from "../capabilities/dart";
import { dartVMPath, flutterPath } from "../constants";
import { DartSdks, Logger } from "../interfaces";
import { runProcess, safeSpawn } from "../processes";
import { isFlutterProjectFolder } from "../utils/fs";

export type DependencyType = "root" | "direct" | "dev" | "transitive";

/// Interacts with "pub deps --json" to look up types of dependencies.
export class PubDeps {
	constructor(private readonly logger: Logger, private readonly sdks: DartSdks, private readonly dartCapabilities: DartCapabilities) { }

	public buildTree(json: PubDepsJson): PubDepsTree {
		const packages: PubDepsJsonPackageLookup = {};
		const rootPackageNames: string[] = [];
		for (const p of json.packages) {
			packages[p.name] = p;
			if (p.kind === "root")
				rootPackageNames.push(p.name);
		}

		rootPackageNames.sort();

		return {
			roots: rootPackageNames.map((name) => packages[name]).filter((pkg) => pkg).map((pkg) => this._buildRoot(pkg, packages)),
		};
	}

	private _buildRoot(pkg: PubDepsJsonPackage, packages: PubDepsJsonPackageLookup): PubDepsTreeRootPackage {
		// TODO(dantup): Change this for post-workspace version where we need to read these from different collections
		//  and walk to get transitives.
		const allDependencies = pkg.dependencies?.map((name) => packages[name]).filter((pkg) => pkg) ?? [];
		allDependencies.sort((d1, d2) => d1.name.localeCompare(d2.name));
		const dependencies = allDependencies.filter((dep) => dep?.kind === "direct");
		const devDependencies = allDependencies.filter((dep) => dep?.kind === "dev");
		return {
			dependencies: dependencies?.map((pkg) => this._buildDependency(pkg)),
			devDependencies: devDependencies?.map((pkg) => this._buildDependency(pkg)),
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
		const json = await this.getJson(projectDirectory);
		return json ? this.buildTree(json) : undefined;
	}

	public async getJson(projectDirectory: string): Promise<PubDepsJson | undefined> {
		if (!this.dartCapabilities.supportsPubDepsJson) {
			return undefined;
		}

		const binPath = isFlutterProjectFolder(projectDirectory) && this.sdks.flutter
			? path.join(this.sdks.flutter, flutterPath)
			: path.join(this.sdks.dart, dartVMPath);
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
	root: string;
	packages: PubDepsJsonPackage[];
}

/// A package in the `pub deps --json` output.
///
/// These types cover both the pre-workspaces and post-workspaces
/// versions, for example including `devDependencies` on packages
/// even though they were included in `dependencies` pre-workspaces.
export interface PubDepsJsonPackage {
	name: string;
	version: string;
	kind: DependencyType;
	dependencies: string[] | undefined;
	devDependencies: string[] | undefined;
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
