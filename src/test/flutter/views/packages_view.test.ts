import { strict as assert } from "assert";
import { DART_DEP_DEPENDENCY_PACKAGE_NODE_CONTEXT, DART_DEP_DEV_DEPENDENCY_PACKAGE_NODE_CONTEXT, DART_DEP_PACKAGE_NODE_CONTEXT, DART_DEP_TRANSITIVE_DEPENDENCY_PACKAGE_NODE_CONTEXT } from "../../../shared/constants.contexts";
import { ensurePackageTreeNode, extApi, getPackages } from "../../helpers";

describe("packages tree", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());

	let depDirect: string;
	let depDev: string;
	let depTransitive: string;
	beforeEach("", () => {
		// Set some useful vars based on whether "pub deps -json" is supported
		// to simplify tests.
		if (extApi.dartCapabilities.supportsPubDepsJson) {
			depDirect = DART_DEP_DEPENDENCY_PACKAGE_NODE_CONTEXT;
			depDev = DART_DEP_DEV_DEPENDENCY_PACKAGE_NODE_CONTEXT;
			depTransitive = DART_DEP_TRANSITIVE_DEPENDENCY_PACKAGE_NODE_CONTEXT;
		} else {
			depDirect = DART_DEP_PACKAGE_NODE_CONTEXT;
			depDev = DART_DEP_PACKAGE_NODE_CONTEXT;
			depTransitive = DART_DEP_PACKAGE_NODE_CONTEXT;
		}
	});

	it("includes known packages inside the project in the correct categories", async () => {
		// If "pub deps json" is supported, the packages will be inside a "direct dependencies" node
		if (extApi.dartCapabilities.supportsPubDepsJson) {
			const dependencyGroups = await extApi.packagesTreeProvider.getChildren(undefined);
			const directDependencies = await extApi.packagesTreeProvider.getChildren(dependencyGroups?.find((node) => node.label === "direct dependencies"));
			const devDependencies = await extApi.packagesTreeProvider.getChildren(dependencyGroups?.find((node) => node.label === "dev dependencies"));
			const transitiveDependencies = await extApi.packagesTreeProvider.getChildren(dependencyGroups?.find((node) => node.label === "transitive dependencies"));

			ensurePackageTreeNode(directDependencies, depDirect, "my_package");
			ensurePackageTreeNode(devDependencies, depDev, "flutter_test");
			ensurePackageTreeNode(transitiveDependencies, depTransitive, "meta");
		} else {
			const allDependencies = await extApi.packagesTreeProvider.getChildren(undefined);

			ensurePackageTreeNode(allDependencies, depDirect, "my_package");
			ensurePackageTreeNode(allDependencies, depDev, "flutter_test");
			ensurePackageTreeNode(allDependencies, depTransitive, "meta");
		}
	});

	it("does not include own package inside the project", async () => {
		// If "pub deps json" is supported, the packages will be inside a "direct dependencies" node
		if (extApi.dartCapabilities.supportsPubDepsJson) {
			const dependencyGroups = await extApi.packagesTreeProvider.getChildren(undefined);
			const directDependencies = await extApi.packagesTreeProvider.getChildren(dependencyGroups?.find((node) => node.label === "direct dependencies"));

			const self = directDependencies!.find((node) => node.label === "flutter_hello_world");
			assert.equal(self, undefined);
		} else {
			const allDependencies = await extApi.packagesTreeProvider.getChildren(undefined);

			const self = allDependencies!.find((node) => node.label === "flutter_hello_world");
			assert.equal(self, undefined);
		}
	});

});
