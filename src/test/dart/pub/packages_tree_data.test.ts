import { strict as assert } from "assert";
import { DART_DEP_PROJECT_NODE_CONTEXT } from "../../../shared/constants.contexts";
import { PubDeps } from "../../../shared/pub/deps";
import { MissingPackageMap, PackageMapLoader } from "../../../shared/pub/package_map";
import { ProjectFinder } from "../../../shared/vscode/utils";
import { activate, ensurePackageTreeNode, extApi, makeTextTreeUsingCustomTree, sb } from "../../helpers";
import { fakePreWorkspacePubDepsJsonComplex, fakePreWorkspacePubDepsJsonSimple } from "./deps.test";

describe("packages tree data", () => {
	let deps: PubDeps;
	let packageMapLoader: PackageMapLoader;
	let projectFinder: ProjectFinder;
	const dummyPackageMap = new MissingPackageMap();

	before("activate", () => activate());

	beforeEach("skip for old SDKs", function () {
		if (!extApi.dartCapabilities.supportsPubDepsJson)
			this.skip();
	});

	beforeEach("setup deps + mocks", function () {
		if (!extApi.dartCapabilities.supportsPubDepsJson)
			this.skip();

		deps = extApi.packagesTreeProvider.deps!;
		packageMapLoader = extApi.packagesTreeProvider.packageMapLoader!;
		projectFinder = extApi.packagesTreeProvider.projectFinder!;
		sb.stub(dummyPackageMap, "getPackagePath").callsFake((name) => `/path/to/${name}`);
	});

	describe("pub deps (pre-workspace format)", () => {
		it("builds the correct tree", async () => {
			sb.stub(projectFinder, "findAllProjectFolders")
				.returns(["/path/to/my_complex_project", "/path/to/my_simple_project"]);
			sb.stub(deps, "getJson")
				.callsFake((projectPath: string) => projectPath.endsWith("my_complex_project") ? fakePreWorkspacePubDepsJsonComplex : fakePreWorkspacePubDepsJsonSimple);
			sb.stub(packageMapLoader, "loadForProject").returns(dummyPackageMap);

			const textTree = (await makeTextTreeUsingCustomTree(undefined, extApi.packagesTreeProvider)).join("\n");

			assert.equal(textTree.trim(), `
my_complex_project
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
my_simple_project
    direct dependencies
        direct1
    dev dependencies
        dev1
`.trim());
		});
	});

	it("includes multiple projects from single workspace folder", async () => {
		const topLevel = await extApi.packagesTreeProvider.getChildren(undefined);

		ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "hello_world");
		ensurePackageTreeNode(topLevel, DART_DEP_PROJECT_NODE_CONTEXT, "example", "hello_world");
	});
});
