import * as assert from "assert";
import { fsPath } from "../../../src/utils";
import { PackageDep } from "../../../src/views/packages_view";
import { ensurePackageTreeNode, extApi, getPackages, myPackageThingFile } from "../../helpers";

describe("packages tree", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());

	it("includes known packages at the top level", async () => {
		const topLevel = await extApi.packagesTreeProvider.getChildren(undefined);
		ensurePackageTreeNode(topLevel, PackageDep, "my_package");
		ensurePackageTreeNode(topLevel, PackageDep, "meta");
		ensurePackageTreeNode(topLevel, PackageDep, "test");
	});

	it("does not include own package", async () => {
		const topLevel = await extApi.packagesTreeProvider.getChildren(undefined);
		const self = topLevel.find((node) => node.label === "hello_world");
		assert.equal(self, undefined);
	});

	it("includes know folders from inside lib/", async () => {
		const topLevel = await extApi.packagesTreeProvider.getChildren(undefined);
		const myPackage = ensurePackageTreeNode(topLevel, PackageDep, "my_package");
		const myPackageLibContents = await extApi.packagesTreeProvider.getChildren(myPackage);
		const file = ensurePackageTreeNode(myPackageLibContents, PackageDep, "my_thing.dart");
		assert.equal(fsPath(file.resourceUri), fsPath(myPackageThingFile));
	});
});
