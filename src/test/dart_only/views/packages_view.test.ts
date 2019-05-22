import * as assert from "assert";
import { fsPath } from "../../../extension/utils";
import { PackageDepFile, PackageDepPackage } from "../../../extension/views/packages_view";
import { ensurePackageTreeNode, extApi, getPackages, myPackageThingFile, renderedItemLabel } from "../../helpers";

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

	it("includes known folders from inside lib/", () => {
		const topLevel = extApi.packagesTreeProvider.getChildren(undefined);
		const myPackage = ensurePackageTreeNode(topLevel, PackageDepPackage, "my_package");
		const myPackageLibContents = extApi.packagesTreeProvider.getChildren(myPackage);
		const file = ensurePackageTreeNode(myPackageLibContents, PackageDepFile, "my_thing.dart");
		assert.equal(fsPath(file.resourceUri), fsPath(myPackageThingFile));
	});

	it("sorts the same way as VS Code explorer", () => {
		const topLevel = extApi.packagesTreeProvider.getChildren(undefined);
		const myPackage = ensurePackageTreeNode(topLevel, PackageDepPackage, "my_package");
		const myPackageLibContents = extApi.packagesTreeProvider.getChildren(myPackage);

		const names = myPackageLibContents.map((f) => renderedItemLabel(f));
		// This isn't quite the same as VS Code explorer, as it does complicated things
		// like trying to sort file_9 and file_10 as a user would expect, and also
		// seems to put capitals after lowercase for the same letter.
		const expectedNamesInOrder = ["z_folder",
			"my_file.txt",
			"MY_FILE_2.txt",
			"zzz.txt",
			"ZZZ_2.txt",
		];
		const actualNames = names.filter((n) => expectedNamesInOrder.indexOf(n) !== -1);

		assert.equal(actualNames.length, expectedNamesInOrder.length);
		actualNames.forEach((name, index) => assert.equal(name, expectedNamesInOrder[index]));
	});
});
