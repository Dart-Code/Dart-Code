import * as path from "path";
import { DartCapabilities } from "../capabilities/dart";
import { dartVMPath, flutterPath } from "../constants";
import { DartSdks, Logger } from "../interfaces";
import { runProcess, safeSpawn } from "../processes";

export type DependencyType = "root" | "direct" | "dev" | "transitive";

/// Interacts with "pub deps --json" to look up types of dependencies.
export class PubDeps {
	constructor(private readonly logger: Logger, private readonly sdks: DartSdks, private readonly dartCapabilities: DartCapabilities) { }

	public async getDependencyKinds(projectDirectory: string): Promise<{ [key: string]: DependencyType }> {
		if (!this.dartCapabilities.supportsPubDepsJson) {
			return {};
		}

		const binPath = this.sdks.flutter
			? path.join(this.sdks.flutter, flutterPath)
			: path.join(this.sdks.dart, dartVMPath);
		const result = await runProcess(this.logger, binPath, ["pub", "deps", "--json"], projectDirectory, undefined, safeSpawn);

		if (result.exitCode !== 0) {
			this.logger.error(`Running "pub deps --json" returned exit code ${result.exitCode}:\n${result.stdout}\n${result.stderr}`);
			return {};
		}

		try {
			const root = JSON.parse(result.stdout) as PubDepsJson;
			const packages: { [key: string]: DependencyType } = {};
			for (const p of root.packages) {
				packages[p.name] = p.kind;
			}
			return packages;
		} catch (e) {
			this.logger.error(`"pub deps --json" returned invalid JSON ${e}:\n${result.stdout}`);
			return {};
		}
	}
}

interface PubDepsJson {
	root: string;
	packages: PubDepsPackage[];
}

interface PubDepsPackage {
	name: string;
	version: string;
	kind: DependencyType;
}
