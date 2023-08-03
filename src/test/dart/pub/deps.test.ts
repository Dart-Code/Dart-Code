import { strict as assert } from "assert";
import { PubDeps, PubDepsJson } from "../../../shared/pub/deps";
import { activate, extApi } from "../../helpers";

describe("pub deps", () => {
	beforeEach("activate", () => activate(null));

	it("can compute shortest paths", async () => {
		const deps = new PubDeps(extApi.logger, extApi.workspaceContext.sdks, extApi.dartCapabilities);

		const fakeRoot: PubDepsJson = {
			packages: [
				{ name: "my_package", version: "1.2.3", kind: "root", dependencies: ["direct1", "direct2", "direct3", "dev1"] },
				{ name: "direct1", version: "1.2.3", kind: "direct", dependencies: [] },
				{ name: "direct2", version: "1.2.3", kind: "direct", dependencies: ["transitive1"] },
				{ name: "direct3", version: "1.2.3", kind: "direct", dependencies: ["transitive2"] },
				{ name: "dev1", version: "1.2.3", kind: "dev", dependencies: [] },
				{ name: "transitive1", version: "1.2.3", kind: "transitive", dependencies: ["transitive2"] },
				{ name: "transitive2", version: "1.2.3", kind: "transitive", dependencies: ["transitive3"] },
				{ name: "transitive3", version: "1.2.3", kind: "transitive", dependencies: ["transitive1"] },
			],
			root: "my_package",
		};

		const packageMap = deps.getPackageMap(fakeRoot);
		const shortestPaths = deps.computeShortestPaths(packageMap);
		assert.deepEqual(shortestPaths, {
			dev1: ["my_package", "dev_1"],
			direct1: ["my_package", "direct1"],
			direct2: ["my_package", "direct2"],
			direct3: ["my_package", "direct3"],
			transitive1: ["my_package", "direct2", "transitive1"],
			transitive2: ["my_package", "direct3", "transitive2"],
			transitive3: ["my_package", "direct3", "transitive2", "transitive3"],
		});
	});

	it("does not fail on circular dependencies", async () => {
		const deps = new PubDeps(extApi.logger, extApi.workspaceContext.sdks, extApi.dartCapabilities);

		const fakeRoot: PubDepsJson = {
			packages: [
				{ name: "my_package", version: "1.2.3", kind: "root", dependencies: ["direct1"] },
				{ name: "direct1", version: "1.2.3", kind: "direct", dependencies: ["transitive1"] },
				{ name: "transitive1", version: "1.2.3", kind: "transitive", dependencies: ["direct1"] },
			],
			root: "my_package",
		};

		const packageMap = deps.getPackageMap(fakeRoot);
		const shortestPaths = deps.computeShortestPaths(packageMap);
		assert.deepEqual(shortestPaths, {
			direct1: ["my_package", "direct1"],
			transitive1: ["my_package", "direct1", "transitive1"],
		});
	});
});
