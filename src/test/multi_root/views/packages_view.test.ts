import { strict as assert } from "assert";
import { DART_DEP_DEPENDENCY_PACKAGE_NODE_CONTEXT, DART_DEP_FILE_NODE_CONTEXT, DART_DEP_FOLDER_NODE_CONTEXT, DART_DEP_PROJECT_NODE_CONTEXT } from "../../../shared/constants.contexts";
import { fsPath } from "../../../shared/utils/fs";
import { ensurePackageTreeNode, extApi, flutterHelloWorldMainFile, getPackages, helloWorldMainFile, myPackageThingFile } from "../../helpers";

describe("packages tree", () => {
	// These tests require both projects have .packages folders.
	before("get packages (0)", () => getPackages(helloWorldMainFile));
	before("get packages (1)", () => getPackages(flutterHelloWorldMainFile));

	it("includes project folders at the top level", async () => {
		const topLevel = await extApi.packagesTreeProvider.getChildren(undefined);
		ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "hello_world");
		ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "flutter_hello_world");
	});

	it("does not include own package", async () => {
		const topLevel = await extApi.packagesTreeProvider.getChildren(undefined);
		const helloWorld = ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "hello_world");

		const packagesContainer = (await extApi.packagesTreeProvider.getChildren(helloWorld))!.find((node) => node.label === "direct dependencies");
		const packagesNodes = await extApi.packagesTreeProvider.getChildren(packagesContainer);

		const self = packagesNodes!.find((node) => node.label === "hello_world");
		assert.equal(self, undefined);
	});

	it("includes known folders/files from inside the package", async () => {
		const topLevel = await extApi.packagesTreeProvider.getChildren(undefined);
		const helloWorld = ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "hello_world");

		const packagesContainer = (await extApi.packagesTreeProvider.getChildren(helloWorld))!.find((node) => node.label === "direct dependencies");
		const packagesNodes = await extApi.packagesTreeProvider.getChildren(packagesContainer);

		const myPackage = ensurePackageTreeNode(packagesNodes, DART_DEP_DEPENDENCY_PACKAGE_NODE_CONTEXT, "my_package");
		const myPackageContents = await extApi.packagesTreeProvider.getChildren(myPackage);
		const libFolder = ensurePackageTreeNode(myPackageContents, DART_DEP_FOLDER_NODE_CONTEXT, "lib");
		const myPackageLibContents = await extApi.packagesTreeProvider.getChildren(libFolder);
		const file = ensurePackageTreeNode(myPackageLibContents, DART_DEP_FILE_NODE_CONTEXT, "my_thing.dart");
		assert.equal(fsPath(file.resourceUri!), fsPath(myPackageThingFile));
	});
});
