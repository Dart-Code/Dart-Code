import { strict as assert } from "assert";
import { getPackageTestCapabilities } from "../../shared/test/version";
import { fsPath } from "../../shared/utils/fs";
import { activate, ensureArrayContainsArray, getResolvedDebugConfiguration, helloWorldFolder, helloWorldMainFile, helloWorldTestMainFile, openFile, privateApi, setConfigForTest } from "../helpers";

describe("dart cli debugger", () => {
	beforeEach("activate helloWorldMainFile", () => activate(null));

	describe("resolves the correct debug config", () => {
		it("using users explicit cwd with an explicit program", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				cwd: "/foo",
				program: fsPath(helloWorldMainFile),
			});

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.cwd, "/foo");
			assert.equal(resolvedConfig.program, fsPath(helloWorldMainFile));
		});

		it("using open file", async () => {
			await openFile(helloWorldMainFile);
			const resolvedConfig = await getResolvedDebugConfiguration({ program: undefined });

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.cwd, fsPath(helloWorldFolder));
			assert.equal(resolvedConfig.program, fsPath(helloWorldMainFile));
		});

		it("passing launch.json's toolArgs to the VM", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(helloWorldMainFile),
				toolArgs: ["--fake-flag"],
			});

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.program, fsPath(helloWorldMainFile));
			assert.equal(resolvedConfig.cwd, fsPath(helloWorldFolder));
			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--fake-flag"]);
		});

		it("when cliAdditionalArgs is set", async () => {
			await setConfigForTest("dart", "cliAdditionalArgs", ["--my-vm-flag"]);
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(helloWorldMainFile),
			});

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--my-vm-flag"]);
		});
	});
});

describe("dart test debugger", () => {
	beforeEach("activate", () => activate(null));

	describe("resolves the correct debug config", () => {
		it("passing launch.json's toolArgs to the VM", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(helloWorldTestMainFile),
				toolArgs: ["--fake-flag"],
			});

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.program, fsPath(helloWorldTestMainFile));
			assert.equal(resolvedConfig.cwd, fsPath(helloWorldFolder));
			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--fake-flag"]);
		});

		it("when testAdditionalArgs is set", async () => {
			await setConfigForTest("dart", "testAdditionalArgs", ["--my-test-flag"]);
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(helloWorldTestMainFile),
			});

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--my-test-flag"]);
		});

		it("when suppressTestTimeouts is set", async () => {
			await setConfigForTest("dart", "suppressTestTimeouts", "always");
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(helloWorldTestMainFile),
			});

			const testCapabilities = await getPackageTestCapabilities(privateApi.logger, privateApi.workspaceContext, resolvedConfig.cwd!);
			if (testCapabilities.supportsIgnoreTimeouts)
				ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--ignore-timeouts"]);
			else
				ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--timeout"]);
		});
	});
});
