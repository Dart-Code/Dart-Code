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

	public async getRootDependency(projectDirectory: string): Promise<PubDepsJson | undefined> {
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

	public getPackageMap(root: PubDepsJson): { [key: string]: PubDepsPackage } {
		const packages: { [key: string]: PubDepsPackage } = {};
		for (const p of root.packages) {
			packages[p.name] = p;
		}
		return packages;
	}

	public computeShortestPaths(packageMap: { [key: string]: PubDepsPackage; }): ShortestPaths {
		const results: ShortestPaths = {};
		const rootName = Object.values(packageMap).find((p) => p.kind === "root")?.name;
		// Queue is a list of pairs of packages to process, and the paths to get to them.
		const queue: Array<[string, string[]]> = [];
		for (const name of Object.keys(packageMap)) {
			if (packageMap[name]?.kind === "direct" || packageMap[name]?.kind === "dev") {
				const path = rootName ? [rootName, name] : [name];
				results[name] = path;
				queue.push([name, path]);
			}
		}

		// Traverse the tree breadth-first, so that the first time we come across any node, we know that is
		// the shortest path.

		// eslint-disable-next-line @typescript-eslint/prefer-for-of
		for (let i = 0; i < queue.length; i++) {
			const [pkg, path] = queue[i];
			const dependencies = packageMap[pkg]?.dependencies ?? [];

			// Loop over this packages dependencies, and if we've not previously been to them
			// this is (one of) the shortest paths there.
			for (const dep of dependencies) {
				if (results[dep])
					continue;

				const newPath = [...path, dep];
				results[dep] = newPath;

				// Also push the dependency onto the queue to process its dependencies.
				queue.push([dep, newPath]);
			}
		}

		return results;
	}

}

export interface PubDepsJson {
	root: string;
	packages: PubDepsPackage[];
}

export interface PubDepsPackage {
	name: string;
	version: string;
	kind: DependencyType;
	dependencies: string[] | undefined;
}

export interface ShortestPaths { [key: string]: string[] }
