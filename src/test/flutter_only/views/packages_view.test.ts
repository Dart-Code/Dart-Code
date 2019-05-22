import * as assert from "assert";
import { PackageDepPackage, PackageDepProject } from "../../../extension/views/packages_view";
import { ensurePackageTreeNode, extApi, getPackages } from "../../helpers";

describe("packages tree", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());

	it("includes multiple projects from single workspace folder at the top level", async () => {
		const topLevel = await extApi.packagesTreeProvider.getChildren(undefined);
		ensurePackageTreeNode(topLevel, PackageDepProject, "flutter_hello_world");
		ensurePackageTreeNode(topLevel, PackageDepProject, "example", "flutter_hello_world");
	});

	it("includes known packages inside the project", async () => {
		const topLevel = await extApi.packagesTreeProvider.getChildren(undefined);
		const myPackage = ensurePackageTreeNode(topLevel, PackageDepProject, "flutter_hello_world");
		const packages = await extApi.packagesTreeProvider.getChildren(myPackage);
		ensurePackageTreeNode(packages, PackageDepPackage, "meta");
		ensurePackageTreeNode(packages, PackageDepPackage, "path");
		ensurePackageTreeNode(packages, PackageDepPackage, "test_api");
	});

	it("does not include own package inside the project", async () => {
		const topLevel = await extApi.packagesTreeProvider.getChildren(undefined);
		const myPackage = ensurePackageTreeNode(topLevel, PackageDepProject, "flutter_hello_world");
		const packages = await extApi.packagesTreeProvider.getChildren(myPackage);
		const self = packages.find((node) => node.label === "hello_world");
		assert.equal(self, undefined);
	});

});
