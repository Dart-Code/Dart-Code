import * as assert from "assert";
import { DART_DEP_PACKAGE_NODE_CONTEXT } from "../../../shared/constants";
import { ensurePackageTreeNode, extApi, getPackages } from "../../helpers";

describe("packages tree", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());

	it("includes known packages inside the project", async () => {
		const packages = await extApi.packagesTreeProvider.getChildren(undefined);
		ensurePackageTreeNode(packages, DART_DEP_PACKAGE_NODE_CONTEXT, "meta");
		ensurePackageTreeNode(packages, DART_DEP_PACKAGE_NODE_CONTEXT, "path");
		ensurePackageTreeNode(packages, DART_DEP_PACKAGE_NODE_CONTEXT, "test_api");
	});

	it("does not include own package inside the project", async () => {
		const packages = await extApi.packagesTreeProvider.getChildren(undefined);
		const self = packages!.find((node) => node.label === "flutter_hello_world");
		assert.equal(self, undefined);
	});

});
