import { strict as assert } from "assert";
import { PubDeps, PubDepsJson, PubDepsTree, PubDepsTreePackageDependency, PubDepsTreePackageTransitiveDependency } from "../../../shared/pub/deps";
import { activate, privateApi } from "../../helpers";

export const fakePreWorkspacePubDepsJsonBasic: PubDepsJson = {
	packages: [
		{ name: "my_package_1", version: "1.2.3", kind: "root", dependencies: ["direct1", "dev1"] },
		{ name: "direct1", version: "1.2.3", kind: "direct", dependencies: [] },
		{ name: "dev1", version: "1.2.3", kind: "dev", dependencies: [] },
	],
};

export const fakePreWorkspacePubDepsJsonSinglePackage: PubDepsJson = {
	packages: [
		// Out of order to verify sorting.
		{ name: "my_package_2", version: "1.2.3", kind: "root", dependencies: ["direct2", "direct1", "direct3", "dev1"] },
		{ name: "direct2", version: "1.2.3", kind: "direct", dependencies: ["transitive1"] },
		{ name: "direct1", version: "1.2.3", kind: "direct", dependencies: [] },
		{ name: "direct3", version: "1.2.3", kind: "direct", dependencies: ["transitive2"] },
		{ name: "dev1", version: "1.2.3", kind: "dev", dependencies: [] },
		{ name: "transitive1", version: "1.2.3", kind: "transitive", dependencies: ["transitive2"] },
		{ name: "transitive2", version: "1.2.3", kind: "transitive", dependencies: ["transitive3"] },
		// Circular dependency here to ensure we don't get stuck.
		{ name: "transitive3", version: "1.2.3", kind: "transitive", dependencies: ["transitive1"] },
	],
};

export const fakePostWorkspacePubDepsJsonSinglePackage: PubDepsJson = {
	packages: [
		// devDependencies is undefined here, to similate pre-workspace format.
		// Out of order to verify sorting.
		{ name: "my_package_1", version: "1.2.3", kind: "root", dependencies: ["direct2", "direct1", "direct3", "dev1"], directDependencies: ["direct2", "direct1", "direct3"], devDependencies: ["dev1"] },
		{ name: "direct2", version: "1.2.3", kind: "direct", dependencies: ["transitive1"], directDependencies: ["transitive1"] },
		{ name: "direct1", version: "1.2.3", kind: "direct", dependencies: [], directDependencies: [] },
		{ name: "direct3", version: "1.2.3", kind: "direct", dependencies: ["transitive2"], directDependencies: ["transitive2"] },
		{ name: "dev1", version: "1.2.3", kind: "dev", dependencies: [], directDependencies: [] },
		{ name: "transitive1", version: "1.2.3", kind: "transitive", dependencies: ["transitive2"], directDependencies: ["transitive2"] },
		{ name: "transitive2", version: "1.2.3", kind: "transitive", dependencies: ["transitive3"], directDependencies: ["transitive3"] },
		// Circular dependency here to ensure we don't get stuck.
		{ name: "transitive3", version: "1.2.3", kind: "transitive", dependencies: ["transitive1"], directDependencies: ["transitive1"] },
	],
};

export const fakePostWorkspacePubDepsJsonWorkspace: PubDepsJson = {
	packages: [
		{ name: "workspace", version: "1.2.3", kind: "root", dependencies: ["direct1"], directDependencies: ["direct1"], devDependencies: [] },
		{ name: "my_package_2", version: "2.2.3", kind: "root", dependencies: ["direct4"], directDependencies: ["direct4"], devDependencies: [] },
		{ name: "direct4", version: "1.2.3", kind: "direct", dependencies: ["transitive4"], directDependencies: ["transitive4"] },
		{ name: "transitive4", version: "1.2.3", kind: "transitive", dependencies: [], directDependencies: [] },
		...fakePostWorkspacePubDepsJsonSinglePackage.packages,
	],
};

describe("pub deps", () => {
	beforeEach("activate", () => activate(null));

	describe("pub deps (pre-workspace format)", () => {
		it("builds the correct tree", async () => {
			const deps = new PubDeps(privateApi.logger, privateApi.workspaceContext, privateApi.dartCapabilities);
			const dependenciesTree = deps.buildTree(fakePreWorkspacePubDepsJsonSinglePackage, "my_package_2");
			const textTree = makeTextTree(dependenciesTree);
			assert.equal(textTree, `
my_package_2 (1.2.3)
	direct dependencies:
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

	describe("pub deps (post-workspace format)", () => {
		it("builds the correct tree for a single (non-workspace) package", async () => {
			const deps = new PubDeps(privateApi.logger, privateApi.workspaceContext, privateApi.dartCapabilities);
			const dependenciesTree = deps.buildTree(fakePreWorkspacePubDepsJsonSinglePackage, "my_package_2");
			const textTree = makeTextTree(dependenciesTree);
			assert.equal(textTree, `
my_package_2 (1.2.3)
	direct dependencies:
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

		it("builds the correct tree for a workspace", async () => {
			const deps = new PubDeps(privateApi.logger, privateApi.workspaceContext, privateApi.dartCapabilities);
			let dependenciesTree = deps.buildTree(fakePostWorkspacePubDepsJsonWorkspace, "my_package_1");
			assert.equal(makeTextTree(dependenciesTree), `
my_package_1 (1.2.3)
	direct dependencies:
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
			dependenciesTree = deps.buildTree(fakePostWorkspacePubDepsJsonWorkspace, "my_package_2");
			assert.equal(makeTextTree(dependenciesTree), `
my_package_2 (2.2.3)
	direct dependencies:
		direct4 (1.2.3)
	dev dependencies:
	transitive dependencies:
		transitive4 (1.2.3) (direct4 -> transitive4)
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
		addDeps("direct dependencies", root.dependencies);
		addDeps("dev dependencies", root.devDependencies);
		addDeps("transitive dependencies", root.transitiveDependencies);
	}

	return lines.join("\n");
}
