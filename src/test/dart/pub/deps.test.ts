import { strict as assert } from "assert";
import { PubDeps, PubDepsJson, PubDepsTree, PubDepsTreePackageDependency, PubDepsTreePackageTransitiveDependency } from "../../../shared/pub/deps";
import { activate, extApi } from "../../helpers";

export const fakePreWorkspacePubDepsJsonComplex: PubDepsJson = {
	packages: [
		// devDependencies is undefined here, to similate pre-workspace format.
		// Out of order to verify sorting.
		{ name: "my_package", version: "1.2.3", kind: "root", dependencies: ["direct2", "direct1", "direct3", "dev1"], devDependencies: undefined },
		{ name: "direct2", version: "1.2.3", kind: "direct", dependencies: ["transitive1"], devDependencies: undefined },
		{ name: "direct1", version: "1.2.3", kind: "direct", dependencies: [], devDependencies: undefined },
		{ name: "direct3", version: "1.2.3", kind: "direct", dependencies: ["transitive2"], devDependencies: undefined },
		{ name: "dev1", version: "1.2.3", kind: "dev", dependencies: [], devDependencies: undefined },
		{ name: "transitive1", version: "1.2.3", kind: "transitive", dependencies: ["transitive2"], devDependencies: undefined },
		{ name: "transitive2", version: "1.2.3", kind: "transitive", dependencies: ["transitive3"], devDependencies: undefined },
		// Circular dependency here to ensure we don't get stuck.
		{ name: "transitive3", version: "1.2.3", kind: "transitive", dependencies: ["transitive1"], devDependencies: undefined },
	],
	root: "my_complex_package",
};

export const fakePreWorkspacePubDepsJsonSimple: PubDepsJson = {
	packages: [
		{ name: "my_package", version: "1.2.3", kind: "root", dependencies: ["direct1", "dev1"], devDependencies: undefined },
		{ name: "direct1", version: "1.2.3", kind: "direct", dependencies: [], devDependencies: undefined },
		{ name: "dev1", version: "1.2.3", kind: "dev", dependencies: [], devDependencies: undefined },
	],
	root: "my_simple_package",
};

describe("pub deps", () => {
	beforeEach("activate", () => activate(null));

	describe("pub deps (pre-workspace format)", () => {
		it("builds the correct tree", async () => {
			const deps = new PubDeps(extApi.logger, extApi.workspaceContext.sdks, extApi.dartCapabilities);
			const dependenciesTree = deps.buildTree(fakePreWorkspacePubDepsJsonComplex);
			const textTree = makeTextTree(dependenciesTree);
			assert.equal(textTree, `
my_package (1.2.3)
	dependencies:
		direct1 (1.2.3)
		direct2 (1.2.3)
		direct3 (1.2.3)
	dev dependencies:
		dev1 (1.2.3)
	transitive dependencies:
		transitive1 (1.2.3) (direct2 -> transitive1)
		transitive2 (1.2.3) (direct3 -> transitive2)
		transitive3 (1.2.3) (direct3 -> transitive2 -> transitive3)
			`.trim());
		});
	});
});

function makeTextTree(tree: PubDepsTree) {
	const lines: string[] = [];

	function addDeps(name: string, deps?: Array<PubDepsTreePackageDependency | PubDepsTreePackageTransitiveDependency>) {
		lines.push(`	${name}:`);
		for (const dep of deps ?? []) {
			const shortestPathSuffix = ("shortestPath" in dep) ? ` (${dep.shortestPath?.join(" -> ")})` : "";
			lines.push(`		${dep.name} (${dep.version})${shortestPathSuffix}`);
		}
	}

	for (const root of tree.roots) {
		lines.push(`${root.name} (${root.version})`);
		addDeps("dependencies", root.dependencies);
		addDeps("dev dependencies", root.devDependencies);
		addDeps("transitive dependencies", root.transitiveDependencies);
	}

	return lines.join("\n");
}
