import * as assert from "assert";
import { fsPath } from "../../../src/utils";
import { PackageDepFile, PackageDepPackage } from "../../../src/views/packages_view";
import { ensurePackageTreeNode, extApi, getPackages, myPackageThingFile } from "../../helpers";

describe("packages tree", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());

	it("includes known packages at the top level", () => {
		const topLevel = extApi.packagesTreeProvider.getChildren(undefined);
		ensurePackageTreeNode(topLevel, PackageDepPackage, "my_package");
		ensurePackageTreeNode(topLevel, PackageDepPackage, "meta");
		ensurePackageTreeNode(topLevel, PackageDepPackage, "test");
	});

	it("does not include own package", () => {
		const topLevel = extApi.packagesTreeProvider.getChildren(undefined);
		const self = topLevel.find((node) => node.label === "hello_world");
		assert.equal(self, undefined);
	});

	it("includes know folders from inside lib/", () => {
		const topLevel = extApi.packagesTreeProvider.getChildren(undefined);
		const myPackage = ensurePackageTreeNode(topLevel, PackageDepPackage, "my_package");
		const myPackageLibContents = extApi.packagesTreeProvider.getChildren(myPackage);
		const file = ensurePackageTreeNode(myPackageLibContents, PackageDepFile, "my_thing.dart");
		assert.equal(fsPath(file.resourceUri), fsPath(myPackageThingFile));
	});
});
