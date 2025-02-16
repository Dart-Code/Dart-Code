import { strict as assert } from "assert";
import { DART_DEP_PROJECT_NODE_CONTEXT } from "../../../shared/constants.contexts";
import { PubDeps } from "../../../shared/pub/deps";
import { MissingPackageMap, PackageMapLoader } from "../../../shared/pub/package_map";
import { ProjectFinder } from "../../../shared/vscode/utils";
import { activate, ensurePackageTreeNode, extApi, makeTextTreeUsingCustomTree, sb } from "../../helpers";
import { fakePostWorkspacePubDepsJsonWorkspace, fakePreWorkspacePubDepsJsonBasic, fakePreWorkspacePubDepsJsonSinglePackage } from "./deps.test";

describe("packages tree data", () => {
	let deps: PubDeps;
	let packageMapLoader: PackageMapLoader;
	let projectFinder: ProjectFinder;
	const dummyPackageMap = new MissingPackageMap();

	before("activate", () => activate());

	beforeEach("setup deps + mocks", () => {
		deps = extApi.packagesTreeProvider.deps!;
		packageMapLoader = extApi.packagesTreeProvider.packageMapLoader!;
		projectFinder = extApi.packagesTreeProvider.projectFinder!;
		sb.stub(dummyPackageMap, "getPackagePath").callsFake((name) => `/path/to/${name}`);
	});

	describe("pub deps (pre-workspace format)", () => {
		it("builds the correct tree", async () => {
			sb.stub(projectFinder, "findAllProjectFolders")
				.returns(["/path/to/my_package_1", "/path/to/my_package_2"]);
			sb.stub(deps, "getJson")
				.callsFake((projectPath: string) => projectPath.endsWith("my_package_2") ? fakePreWorkspacePubDepsJsonSinglePackage : fakePreWorkspacePubDepsJsonBasic);
			sb.stub(packageMapLoader, "loadForProject").returns(dummyPackageMap);

			const textTree = (await makeTextTreeUsingCustomTree(undefined, extApi.packagesTreeProvider)).join("\n");

			assert.equal(textTree.trim(), `
my_package_1
    direct dependencies
        direct1
    dev dependencies
        dev1
my_package_2
    direct dependencies
        direct1
        direct2
        direct3
    dev dependencies
        dev1
    transitive dependencies
        transitive1
        transitive2
        transitive3
`.trim());
		});
	});

	it("includes multiple projects from single workspace folder", async () => {
		const topLevel = await extApi.packagesTreeProvider.getChildren(undefined);

		ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "hello_world");
		ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "example", "hello_world");
	});

	describe("pub deps (workspace)", () => {
		it("builds the correct tree", async () => {
			sb.stub(projectFinder, "findAllProjectFolders")
				.returns(["/path/to/workspace", "/path/to/workspace/my_package_1", "/path/to/workspace/my_package_2"]);
			sb.stub(deps, "getJson")
				.callsFake((projectPath: string) => fakePostWorkspacePubDepsJsonWorkspace);
			sb.stub(packageMapLoader, "loadForProject").returns(dummyPackageMap);

			const textTree = (await makeTextTreeUsingCustomTree(undefined, extApi.packagesTreeProvider)).join("\n");

			assert.equal(textTree.trim(), `
workspace
    direct dependencies
        direct1
my_package_1
    direct dependencies
        direct1
        direct2
        direct3
    dev dependencies
        dev1
    transitive dependencies
        transitive1
        transitive2
        transitive3
my_package_2
    direct dependencies
        direct4
    transitive dependencies
        transitive4
`.trim());
		});
	});
});
