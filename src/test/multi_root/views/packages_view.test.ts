import * as assert from "assert";
import { DART_DEP_FILE_NODE_CONTEXT, DART_DEP_PACKAGE_NODE_CONTEXT, DART_DEP_PROJECT_NODE_CONTEXT } from "../../../shared/constants";
import { fsPath } from "../../../shared/vscode/utils";
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
		const packages = await extApi.packagesTreeProvider.getChildren(helloWorld);
		const self = packages.find((node) => node.label === "hello_world");
		assert.equal(self, undefined);
	});

	it("includes known folders from inside lib/", async () => {
		const topLevel = await extApi.packagesTreeProvider.getChildren(undefined);
		const helloWorld = ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "hello_world");
		const packages = await extApi.packagesTreeProvider.getChildren(helloWorld);
		const myPackage = ensurePackageTreeNode(packages, DART_DEP_PACKAGE_NODE_CONTEXT, "my_package");
		const myPackageLibContents = await extApi.packagesTreeProvider.getChildren(myPackage);
		const file = ensurePackageTreeNode(myPackageLibContents, DART_DEP_FILE_NODE_CONTEXT, "my_thing.dart");
		assert.equal(fsPath(file.resourceUri), fsPath(myPackageThingFile));
	});
});
