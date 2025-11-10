import { strict as assert } from "assert";
import * as vs from "vscode";
import { activateWithoutAnalysis, privateApi, setConfigForTest } from "../helpers";

describe("MCP server", () => {
	let originalCapabilitiesVersion: string;

	beforeEach(async () => {
		originalCapabilitiesVersion = privateApi.dartCapabilities.version;
		await activateWithoutAnalysis();
	});

	afterEach(() => {
		privateApi.dartCapabilities.version = originalCapabilitiesVersion;
	});

	function getExcludedTools(server: vs.McpServerDefinition): string[] {
		server = server as vs.McpStdioServerDefinition;
		const args = server.args;
		const excludedTools: string[] = [];
		for (let i = 0; i < args.length - 1; i++) {
			if (args[i] === "--exclude-tool")
				excludedTools.push(args[i + 1]);
		}
		return excludedTools;
	}

	it("passes --exclude-tool for run_tests by default", async () => {
		privateApi.dartCapabilities.version = "3.10.0";

		const provider = privateApi.mcpServerProvider!;
		const servers = await provider.provideMcpServerDefinitions(new vs.CancellationTokenSource().token);
		const excludedTools = getExcludedTools(servers![0]);
		assert.deepStrictEqual(excludedTools, ["analyze_files", "run_tests"]);
	});

	it("merges excluded tools with defaults", async () => {
		privateApi.dartCapabilities.version = "3.10.0";

		await setConfigForTest("dart", "mcpServerTools", { tool1: false, tool2: true });

		const provider = privateApi.mcpServerProvider!;
		const servers = await provider.provideMcpServerDefinitions(new vs.CancellationTokenSource().token);
		const excludedTools = getExcludedTools(servers![0]);
		assert.deepStrictEqual(excludedTools, ["analyze_files", "run_tests", "tool1"]);
	});

	it("allows default exclusions to be included", async () => {
		privateApi.dartCapabilities.version = "3.10.0";

		// eslint-disable-next-line camelcase
		await setConfigForTest("dart", "mcpServerTools", { tool1: false, tool2: true, run_tests: true });

		const provider = privateApi.mcpServerProvider!;
		const servers = await provider.provideMcpServerDefinitions(new vs.CancellationTokenSource().token);
		const excludedTools = getExcludedTools(servers![0]);
		assert.deepStrictEqual(excludedTools, ["analyze_files", "tool1"]);
	});

	it("does not pass --exclude-tool when unsupported", async () => {
		privateApi.dartCapabilities.version = "3.9.0";

		const provider = privateApi.mcpServerProvider!;
		const servers = await provider.provideMcpServerDefinitions(new vs.CancellationTokenSource().token);
		const excludedTools = getExcludedTools(servers![0]);
		assert.deepStrictEqual(excludedTools, []);
	});
});
