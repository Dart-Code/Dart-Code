import * as assert from "assert";
import { fsPath } from "../../../extension/utils";
import { PackageDepFile, PackageDepPackage, PackageDepProject } from "../../../extension/views/packages_view";
import { ensurePackageTreeNode, extApi, flutterHelloWorldMainFile, getPackages, helloWorldMainFile, myPackageThingFile } from "../../helpers";

describe("packages tree", () => {
	// These tests require both projects have .packages folders.
	before("get packages (0)", () => getPackages(helloWorldMainFile));
	before("get packages (1)", () => getPackages(flutterHelloWorldMainFile));

	it("includes project folders at the top level", () => {
		const topLevel = extApi.packagesTreeProvider.getChildren(undefined);
		ensurePackageTreeNode(topLevel, PackageDepProject, "hello_world");
		ensurePackageTreeNode(topLevel, PackageDepProject, "flutter_hello_world");
	});

	it("does not include own package", () => {
		const topLevel = extApi.packagesTreeProvider.getChildren(undefined);
		const helloWorld = ensurePackageTreeNode(topLevel, PackageDepProject, "hello_world");
		const packages = extApi.packagesTreeProvider.getChildren(helloWorld);
		const self = packages.find((node) => node.label === "hello_world");
		assert.equal(self, undefined);
	});

	it("includes known folders from inside lib/", () => {
		const topLevel = extApi.packagesTreeProvider.getChildren(undefined);
		const helloWorld = ensurePackageTreeNode(topLevel, PackageDepProject, "hello_world");
		const packages = extApi.packagesTreeProvider.getChildren(helloWorld);
		const myPackage = ensurePackageTreeNode(packages, PackageDepPackage, "my_package");
		const myPackageLibContents = extApi.packagesTreeProvider.getChildren(myPackage);
		const file = ensurePackageTreeNode(myPackageLibContents, PackageDepFile, "my_thing.dart");
		assert.equal(fsPath(file.resourceUri), fsPath(myPackageThingFile));
	});
});
