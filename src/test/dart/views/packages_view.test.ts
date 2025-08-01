import { strict as assert } from "assert";
import { DART_DEP_DEPENDENCY_PACKAGE_NODE_CONTEXT, DART_DEP_DEV_DEPENDENCY_PACKAGE_NODE_CONTEXT, DART_DEP_FILE_NODE_CONTEXT, DART_DEP_FOLDER_NODE_CONTEXT, DART_DEP_PROJECT_NODE_CONTEXT, DART_DEP_PUB_HOSTED_PACKAGE_NODE_CONTEXT, DART_DEP_TRANSITIVE_DEPENDENCY_PACKAGE_NODE_CONTEXT } from "../../../shared/constants.contexts";
import { fsPath } from "../../../shared/utils/fs";
import { ensurePackageTreeNode, getPackages, myPackageThingFile, privateApi, renderedItemLabel } from "../../helpers";

describe("packages tree", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());

	it("includes multiple projects from single workspace folder", async () => {
		const topLevel = await privateApi.packagesTreeProvider.getChildren(undefined);

		ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "hello_world");
		ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "example", "hello_world");
	});

	it("includes known packages in the project in the correct categories", async () => {
		const topLevel = await privateApi.packagesTreeProvider.getChildren(undefined);

		const packageNode = ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "hello_world");

		const dependencyGroups = await privateApi.packagesTreeProvider.getChildren(packageNode);
		const directDependencies = await privateApi.packagesTreeProvider.getChildren(dependencyGroups?.find((node) => node.label === "direct dependencies"));
		const devDependencies = await privateApi.packagesTreeProvider.getChildren(dependencyGroups?.find((node) => node.label === "dev dependencies"));
		const transitiveDependencies = await privateApi.packagesTreeProvider.getChildren(dependencyGroups?.find((node) => node.label === "transitive dependencies"));

		ensurePackageTreeNode(directDependencies, DART_DEP_DEPENDENCY_PACKAGE_NODE_CONTEXT, "my_package");
		ensurePackageTreeNode(devDependencies, DART_DEP_DEV_DEPENDENCY_PACKAGE_NODE_CONTEXT, "test");
		ensurePackageTreeNode(transitiveDependencies, DART_DEP_TRANSITIVE_DEPENDENCY_PACKAGE_NODE_CONTEXT, "file");
	});

	it("includes pub-hosted context for appropriate packages", async () => {
		const topLevel = await privateApi.packagesTreeProvider.getChildren(undefined);

		const packageNode = ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "hello_world");

		const dependencyGroups = await privateApi.packagesTreeProvider.getChildren(packageNode);
		const directDependencies = await privateApi.packagesTreeProvider.getChildren(dependencyGroups?.find((node) => node.label === "direct dependencies"));
		const devDependencies = await privateApi.packagesTreeProvider.getChildren(dependencyGroups?.find((node) => node.label === "dev dependencies"));

		const myPackage = ensurePackageTreeNode(directDependencies, DART_DEP_DEPENDENCY_PACKAGE_NODE_CONTEXT, "my_package");
		const testPackage = ensurePackageTreeNode(devDependencies, DART_DEP_DEV_DEPENDENCY_PACKAGE_NODE_CONTEXT, "test");

		assert.ok(myPackage.contextValue);
		assert.ok(testPackage.contextValue);
		// Not pub hosted
		assert.ok(!myPackage.contextValue.includes(DART_DEP_PUB_HOSTED_PACKAGE_NODE_CONTEXT));
		// Pub hosted
		assert.ok(testPackage.contextValue.includes(DART_DEP_PUB_HOSTED_PACKAGE_NODE_CONTEXT));
	});

	it("does not include own package", async () => {
		const topLevel = await privateApi.packagesTreeProvider.getChildren(undefined);
		const packageNode = ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "hello_world");

		// If "pub deps json" is supported, the packages will be inside a "direct dependencies" node, otherwise
		// they'll just be inside the packages folder directly.
		const packagesContainer =
			(await privateApi.packagesTreeProvider.getChildren(packageNode))!.find((node) => node.label === "direct dependencies");
		const packagesNodes = await privateApi.packagesTreeProvider.getChildren(packagesContainer);

		const self = packagesNodes!.find((node) => node.label === "hello_world");
		assert.equal(self, undefined);
	});

	it("includes known folders/files from inside the package", async () => {
		const topLevel = await privateApi.packagesTreeProvider.getChildren(undefined);
		const packageNode = ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "hello_world");

		const packagesContainer = (await privateApi.packagesTreeProvider.getChildren(packageNode))!.find((node) => node.label === "direct dependencies");
		const packagesNodes = await privateApi.packagesTreeProvider.getChildren(packagesContainer);

		const myPackage = ensurePackageTreeNode(packagesNodes, DART_DEP_DEPENDENCY_PACKAGE_NODE_CONTEXT, "my_package");
		const myPackageContents = await privateApi.packagesTreeProvider.getChildren(myPackage);
		const libFolder = ensurePackageTreeNode(myPackageContents, DART_DEP_FOLDER_NODE_CONTEXT, "lib");
		const myPackageLibContents = await privateApi.packagesTreeProvider.getChildren(libFolder);
		const file = ensurePackageTreeNode(myPackageLibContents, DART_DEP_FILE_NODE_CONTEXT, "my_thing.dart");
		assert.equal(fsPath(file.resourceUri!), fsPath(myPackageThingFile));
	});

	it("sorts the same way as VS Code explorer", async () => {
		const topLevel = await privateApi.packagesTreeProvider.getChildren(undefined);
		const packageNode = ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "hello_world");

		const packagesContainer = (await privateApi.packagesTreeProvider.getChildren(packageNode))!.find((node) => node.label === "direct dependencies");
		const packagesNodes = await privateApi.packagesTreeProvider.getChildren(packagesContainer);

		const myPackage = ensurePackageTreeNode(packagesNodes, DART_DEP_DEPENDENCY_PACKAGE_NODE_CONTEXT, "my_package");
		const myPackageContents = await privateApi.packagesTreeProvider.getChildren(myPackage);
		const libFolder = ensurePackageTreeNode(myPackageContents, DART_DEP_FOLDER_NODE_CONTEXT, "lib");
		const myPackageLibContents = await privateApi.packagesTreeProvider.getChildren(libFolder);

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
		const actualNames = names.filter((n) => expectedNamesInOrder.includes(n));

		assert.equal(actualNames.length, expectedNamesInOrder.length);
		actualNames.forEach((name, index) => assert.equal(name, expectedNamesInOrder[index]));
	});
});
