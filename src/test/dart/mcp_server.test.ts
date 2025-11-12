import { strict as assert } from "assert";
import * as vs from "vscode";
import { fsPath } from "../../shared/utils/fs";
import { activate, activateWithoutAnalysis, closeAllOpenFiles, currentDoc, emptyFile, privateApi, sb, setConfigForTest } from "../helpers";

describe("MCP server", () => {
	let originalCapabilitiesVersion: string;

	beforeEach(async () => {
		await activateWithoutAnalysis(null);
		originalCapabilitiesVersion = privateApi.dartCapabilities.version;
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
		assert.deepStrictEqual(excludedTools, ["analyze_files", "dart_fix", "dart_format", "run_tests"]);
	});

	it("merges excluded tools with defaults", async () => {
		privateApi.dartCapabilities.version = "3.10.0";

		await setConfigForTest("dart", "mcpServerTools", { tool1: false, tool2: true });

		const provider = privateApi.mcpServerProvider!;
		const servers = await provider.provideMcpServerDefinitions(new vs.CancellationTokenSource().token);
		const excludedTools = getExcludedTools(servers![0]);
		assert.deepStrictEqual(excludedTools, ["analyze_files", "dart_fix", "dart_format", "run_tests", "tool1"]);
	});

	it("allows default exclusions to be included", async () => {
		privateApi.dartCapabilities.version = "3.10.0";

		// eslint-disable-next-line camelcase
		await setConfigForTest("dart", "mcpServerTools", { tool1: false, tool2: true, run_tests: true });

		const provider = privateApi.mcpServerProvider!;
		const servers = await provider.provideMcpServerDefinitions(new vs.CancellationTokenSource().token);
		const excludedTools = getExcludedTools(servers![0]);
		assert.deepStrictEqual(excludedTools, ["analyze_files", "dart_fix", "dart_format", "tool1"]);
	});

	it("does not pass --exclude-tool when unsupported", async () => {
		privateApi.dartCapabilities.version = "3.9.0";

		const provider = privateApi.mcpServerProvider!;
		const servers = await provider.provideMcpServerDefinitions(new vs.CancellationTokenSource().token);
		const excludedTools = getExcludedTools(servers![0]);
		assert.deepStrictEqual(excludedTools, []);
	});
});

describe("MCP tools", () => {
	beforeEach(async () => activate(null));

	it("dart_format invokes editor.action.formatDocument", async () => {
		await closeAllOpenFiles();
		const formatDocument = sb.stub(vs.commands, "executeCommand").callThrough()
			.withArgs("editor.action.formatDocument").resolves();


		await vs.lm.invokeTool("dart_format", { input: { filePath: emptyFile.path }, toolInvocationToken: undefined });

		const doc = currentDoc();
		assert.equal(fsPath(doc.uri), fsPath(emptyFile));
		assert.ok(formatDocument.calledOnce, "formatDocument should have been called");
		assert.equal(doc.isDirty, false);
	});

	it("dart_fix with filePath invokes editor.action.fixAll", async () => {
		await closeAllOpenFiles();
		const fixAll = sb.stub(vs.commands, "executeCommand").callThrough()
			.withArgs("editor.action.fixAll").resolves();

		await vs.lm.invokeTool("dart_fix", { input: { filePath: emptyFile.path }, toolInvocationToken: undefined });

		const doc = currentDoc();
		assert.equal(fsPath(doc.uri), fsPath(emptyFile));
		assert.ok(fixAll.calledOnce, "fixAll should have been called");
		assert.equal(doc.isDirty, false);
	});

	it("dart_fix without filePath invokes dart.edit.fixAllInWorkspace", async () => {
		const fixAllInWorkspace = sb.stub(vs.commands, "executeCommand").callThrough()
			.withArgs("dart.edit.fixAllInWorkspace").resolves();

		await vs.lm.invokeTool("dart_fix", { input: {}, toolInvocationToken: undefined });

		assert.ok(fixAllInWorkspace.calledOnce, "fixAllInWorkspace should be called");
	});
});
