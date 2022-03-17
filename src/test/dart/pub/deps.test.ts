import { strict as assert } from "assert";
import { PubDeps, PubDepsJson } from "../../../shared/pub/deps";
import { activate, extApi } from "../../helpers";

describe("pub deps", () => {
	beforeEach("activate", () => activate(null));

	it("can compute shortest paths", async () => {
		const deps = new PubDeps(extApi.logger, extApi.workspaceContext.sdks, extApi.dartCapabilities);

		const fakeRoot: PubDepsJson = {
			packages: [
				{ name: "my_package", version: "1.2.3", kind: "root", dependencies: ["direct_1", "direct_2", "direct_3", "dev_1"] },
				{ name: "direct_1", version: "1.2.3", kind: "direct", dependencies: [] },
				{ name: "direct_2", version: "1.2.3", kind: "direct", dependencies: ["transitive_1"] },
				{ name: "direct_3", version: "1.2.3", kind: "direct", dependencies: ["transitive_2"] },
				{ name: "dev_1", version: "1.2.3", kind: "dev", dependencies: [] },
				{ name: "transitive_1", version: "1.2.3", kind: "transitive", dependencies: ["transitive_2"] },
				{ name: "transitive_2", version: "1.2.3", kind: "transitive", dependencies: ["transitive_3"] },
				{ name: "transitive_3", version: "1.2.3", kind: "transitive", dependencies: ["transitive_1"] },
			],
			root: "my_package",
		};

		const packageMap = deps.getPackageMap(fakeRoot);
		const shortestPaths = deps.computeShortestPaths(packageMap);
		assert.deepEqual(shortestPaths, {
			"dev_1": ["my_package", "dev_1"],
			"direct_1": ["my_package", "direct_1"],
			"direct_2": ["my_package", "direct_2"],
			"direct_3": ["my_package", "direct_3"],
			"transitive_1": ["my_package", "direct_2", "transitive_1"],
			"transitive_2": ["my_package", "direct_3", "transitive_2"],
			"transitive_3": ["my_package", "direct_3", "transitive_2", "transitive_3"],
		});
	});

	it("does not fail on circular dependencies", async () => {
		const deps = new PubDeps(extApi.logger, extApi.workspaceContext.sdks, extApi.dartCapabilities);

		const fakeRoot: PubDepsJson = {
			packages: [
				{ name: "my_package", version: "1.2.3", kind: "root", dependencies: ["direct_1"] },
				{ name: "direct_1", version: "1.2.3", kind: "direct", dependencies: ["transitive_1"] },
				{ name: "transitive_1", version: "1.2.3", kind: "transitive", dependencies: ["direct_1"] },
			],
			root: "my_package",
		};

		const packageMap = deps.getPackageMap(fakeRoot);
		const shortestPaths = deps.computeShortestPaths(packageMap);
		assert.deepEqual(shortestPaths, {
			"direct_1": ["my_package", "direct_1"],
			"transitive_1": ["my_package", "direct_1", "transitive_1"],
		});
	});
});
