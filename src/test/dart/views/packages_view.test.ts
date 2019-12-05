import * as assert from "assert";
import { DART_DEP_FILE_NODE_CONTEXT, DART_DEP_PACKAGE_NODE_CONTEXT, DART_DEP_PROJECT_NODE_CONTEXT } from "../../../shared/constants";
import { fsPath } from "../../../shared/vscode/utils";
import { ensurePackageTreeNode, extApi, getPackages, myPackageThingFile, renderedItemLabel } from "../../helpers";

describe("packages tree", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());

	it("includes multiple projects from single workspace folder at the top level", async () => {
		const topLevel = await extApi.packagesTreeProvider.getChildren(undefined);
		ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "hello_world");
		ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "example", "hello_world");
	});

	it("includes known packages in the project", async () => {
		const topLevel = await extApi.packagesTreeProvider.getChildren(undefined);
		const packageNode = ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "hello_world");
		const packageLevel = await extApi.packagesTreeProvider.getChildren(packageNode);

		ensurePackageTreeNode(packageLevel, DART_DEP_PACKAGE_NODE_CONTEXT, "my_package");
		ensurePackageTreeNode(packageLevel, DART_DEP_PACKAGE_NODE_CONTEXT, "meta");
		ensurePackageTreeNode(packageLevel, DART_DEP_PACKAGE_NODE_CONTEXT, "test");
	});

	it("does not include own package", async () => {
		const topLevel = await extApi.packagesTreeProvider.getChildren(undefined);
		const packageNode = ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "hello_world");
		const packageLevel = await extApi.packagesTreeProvider.getChildren(packageNode);

		const self = packageLevel!.find((node) => node.label === "hello_world");
		assert.equal(self, undefined);
	});

	it("includes known folders from inside lib/", async () => {
		const topLevel = await extApi.packagesTreeProvider.getChildren(undefined);
		const packageNode = ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "hello_world");
		const packageLevel = await extApi.packagesTreeProvider.getChildren(packageNode);

		const myPackage = ensurePackageTreeNode(packageLevel, DART_DEP_PACKAGE_NODE_CONTEXT, "my_package");
		const myPackageLibContents = await extApi.packagesTreeProvider.getChildren(myPackage);
		const file = ensurePackageTreeNode(myPackageLibContents, DART_DEP_FILE_NODE_CONTEXT, "my_thing.dart");
		assert.equal(fsPath(file.resourceUri!), fsPath(myPackageThingFile));
	});

	it("sorts the same way as VS Code explorer", async () => {
		const topLevel = await extApi.packagesTreeProvider.getChildren(undefined);
		const packageNode = ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "hello_world");
		const packageLevel = await extApi.packagesTreeProvider.getChildren(packageNode);

		const myPackage = ensurePackageTreeNode(packageLevel, DART_DEP_PACKAGE_NODE_CONTEXT, "my_package");
		const myPackageLibContents = await extApi.packagesTreeProvider.getChildren(myPackage);

		const names = myPackageLibContents!.map((f) => renderedItemLabel(f));
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
