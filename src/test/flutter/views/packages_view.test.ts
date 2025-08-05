import { strict as assert } from "assert";
import { DART_DEP_DEPENDENCY_PACKAGE_NODE_CONTEXT, DART_DEP_DEV_DEPENDENCY_PACKAGE_NODE_CONTEXT, DART_DEP_PROJECT_NODE_CONTEXT, DART_DEP_TRANSITIVE_DEPENDENCY_PACKAGE_NODE_CONTEXT } from "../../../shared/constants.contexts";
import { ensurePackageTreeNode, getPackages, privateApi } from "../../helpers";

describe("packages tree", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());

	it("includes known packages inside the project in the correct categories", async () => {
		const topLevel = await privateApi.packagesTreeProvider.getChildren(undefined);
		const packageNode = ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "flutter_hello_world");

		const dependencyGroups = await privateApi.packagesTreeProvider.getChildren(packageNode);
		const directDependencies = await privateApi.packagesTreeProvider.getChildren(dependencyGroups?.find((node) => node.label === "direct dependencies"));
		const devDependencies = await privateApi.packagesTreeProvider.getChildren(dependencyGroups?.find((node) => node.label === "dev dependencies"));
		const transitiveDependencies = await privateApi.packagesTreeProvider.getChildren(dependencyGroups?.find((node) => node.label === "transitive dependencies"));

		ensurePackageTreeNode(directDependencies, DART_DEP_DEPENDENCY_PACKAGE_NODE_CONTEXT, "my_package");
		ensurePackageTreeNode(devDependencies, DART_DEP_DEV_DEPENDENCY_PACKAGE_NODE_CONTEXT, "flutter_test");
		ensurePackageTreeNode(transitiveDependencies, DART_DEP_TRANSITIVE_DEPENDENCY_PACKAGE_NODE_CONTEXT, "meta");
	});

	it("does not include own package inside the project", async () => {
		const topLevel = await privateApi.packagesTreeProvider.getChildren(undefined);
		const packageNode = ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "flutter_hello_world");

		const dependencyGroups = await privateApi.packagesTreeProvider.getChildren(packageNode);
		const directDependencies = await privateApi.packagesTreeProvider.getChildren(dependencyGroups?.find((node) => node.label === "direct dependencies"));

		const self = directDependencies!.find((node) => node.label === "flutter_hello_world");
		assert.equal(self, undefined);
	});
});
