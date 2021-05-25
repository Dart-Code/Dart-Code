import * as assert from "assert";
import { DART_DEP_PACKAGE_NODE_CONTEXT } from "../../../shared/constants";
import { ensurePackageTreeNode, extApi, getPackages } from "../../helpers";

describe("packages tree", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());

	it("includes known packages inside the project in the correct categories", async () => {
		// If "pub deps json" is supported, the packages will be inside a "direct dependencies" node
		if (extApi.dartCapabilities.supportsPubDepsJson) {
			const dependencyGroups = await extApi.packagesTreeProvider.getChildren(undefined);
			const directDependencies = await extApi.packagesTreeProvider.getChildren(dependencyGroups?.find((node) => node.label === "direct dependencies"));
			const devDependencies = await extApi.packagesTreeProvider.getChildren(dependencyGroups?.find((node) => node.label === "dev dependencies"));
			const transitiveDependencies = await extApi.packagesTreeProvider.getChildren(dependencyGroups?.find((node) => node.label === "transitive dependencies"));

			ensurePackageTreeNode(directDependencies, DART_DEP_PACKAGE_NODE_CONTEXT, "my_package");
			ensurePackageTreeNode(devDependencies, DART_DEP_PACKAGE_NODE_CONTEXT, "flutter_test");
			ensurePackageTreeNode(transitiveDependencies, DART_DEP_PACKAGE_NODE_CONTEXT, "meta");
		} else {
			const allDependencies = await extApi.packagesTreeProvider.getChildren(undefined);

			ensurePackageTreeNode(allDependencies, DART_DEP_PACKAGE_NODE_CONTEXT, "my_package");
			ensurePackageTreeNode(allDependencies, DART_DEP_PACKAGE_NODE_CONTEXT, "flutter_test");
			ensurePackageTreeNode(allDependencies, DART_DEP_PACKAGE_NODE_CONTEXT, "meta");
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
