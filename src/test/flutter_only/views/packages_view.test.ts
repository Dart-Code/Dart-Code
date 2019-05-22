import * as assert from "assert";
import { DART_DEP_PACKAGE_NODE_CONTEXT, DART_DEP_PROJECT_NODE_CONTEXT } from "../../../shared/constants";
import { ensurePackageTreeNode, extApi, getPackages } from "../../helpers";

describe("packages tree", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());

	it("includes multiple projects from single workspace folder at the top level", async () => {
		const topLevel = await extApi.packagesTreeProvider.getChildren(undefined);
		ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "flutter_hello_world");
		ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "example", "flutter_hello_world");
	});

	it("includes known packages inside the project", async () => {
		const topLevel = await extApi.packagesTreeProvider.getChildren(undefined);
		const myPackage = ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "flutter_hello_world");
		const packages = await extApi.packagesTreeProvider.getChildren(myPackage);
		ensurePackageTreeNode(packages, DART_DEP_PACKAGE_NODE_CONTEXT, "meta");
		ensurePackageTreeNode(packages, DART_DEP_PACKAGE_NODE_CONTEXT, "path");
		ensurePackageTreeNode(packages, DART_DEP_PACKAGE_NODE_CONTEXT, "test_api");
	});

	it("does not include own package inside the project", async () => {
		const topLevel = await extApi.packagesTreeProvider.getChildren(undefined);
		const myPackage = ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "flutter_hello_world");
		const packages = await extApi.packagesTreeProvider.getChildren(myPackage);
		const self = packages.find((node) => node.label === "hello_world");
		assert.equal(self, undefined);
	});

});
