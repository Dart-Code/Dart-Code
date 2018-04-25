import * as path from "path";
import * as vs from "vscode";
import { DebugClient } from "vscode-debugadapter-testsupport";
import { fsPath } from "../../../src/utils";
import { ensureVariable, getTopFrameVariables, getVariables } from "../../debug_helpers";
import { activate, closeAllOpenFiles, ext, helloWorldBrokenFile, helloWorldGoodbyeFile, helloWorldMainFile, openFile, positionOf } from "../../helpers";

describe("dart cli debugger", () => {
	const dc = new DebugClient(process.execPath, path.join(ext.extensionPath, "out/src/debug/dart_debug_entry.js"), "dart");
	dc.defaultTimeout = 30000;

	beforeEach(() => activate(helloWorldMainFile));
	afterEach(() => dc.stop());

	async function startDebugger(script: vs.Uri): Promise<vs.DebugConfiguration> {
		const config = await ext.exports.debugProvider.resolveDebugConfiguration(
			vs.workspace.workspaceFolders[0],
			{
				name: "Dart & Flutter",
				program: script && fsPath(script),
				request: "launch",
				type: "dart",
			},
		);
		await dc.start(config.debugServer);
		return config;
	}

	it("runs a Dart script to completion", async () => {
		const config = await startDebugger(helloWorldMainFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("receives the expected output from a Dart script", async () => {
		const config = await startDebugger(helloWorldMainFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stdout", "Hello, world!"),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("runs bin/main.dart if no file is open/provided", async () => {
		await closeAllOpenFiles();
		const config = await startDebugger(null);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stdout", "Hello, world!"),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("runs the provided script regardless of what's open", async () => {
		await openFile(helloWorldMainFile);
		const config = await startDebugger(helloWorldGoodbyeFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stdout", "Goodbye!"),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("runs the open script if no file is provided", async () => {
		await openFile(helloWorldGoodbyeFile);
		const config = await startDebugger(null);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stdout", "Goodbye!"),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("stops at a breakpoint", async () => {
		await openFile(helloWorldMainFile);
		const config = await startDebugger(helloWorldMainFile);
		await Promise.all([
			dc.hitBreakpoint(config, {
				line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(helloWorldMainFile),
			}),
		]);
	});

	it("provides local variables when stopped at a breakpoint", async () => {
		await openFile(helloWorldMainFile);
		const config = await startDebugger(helloWorldMainFile);
		await Promise.all([
			dc.hitBreakpoint(config, {
				line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(helloWorldMainFile),
			}),
		]);

		const variables = await getTopFrameVariables(dc, "Locals");
		ensureVariable(variables, "s", "s", `"Hello!"`);
		ensureVariable(variables, "l", "l", `[2]`);
		ensureVariable(variables, "m", "m", `{2}`);

		const listVariables = await getVariables(dc, variables.find((v) => v.name === "l").variablesReference);
		ensureVariable(listVariables, "l[0]", "[0]", "0");
		ensureVariable(listVariables, "l[1]", "[1]", "1");

		const mapVariables = await getVariables(dc, variables.find((v) => v.name === "m").variablesReference);
		ensureVariable(mapVariables, `m["s"]`, `["s"]`, `"Hello!"`);
		ensureVariable(mapVariables, `m["l"]`, `["l"]`, "[2]");

		const mapListVariables = await getVariables(dc, mapVariables.find((v) => v.name === `["l"]`).variablesReference);
		ensureVariable(mapListVariables, `m["l"][0]`, "[0]", "0");
		ensureVariable(mapListVariables, `m["l"][1]`, "[1]", "1");
	});

	it("stops on exception", async function () {
		// This test is flaky on Dart v1. Sometimes we hit the exception and it inexplicably resumes
		// https://gist.github.com/DanTup/3a70795cdb82d6a74a9e0c5c82c5b374
		// If we ever see this on a recent SDK, we should open an issue.
		if (!ext.exports.analyzerCapabilities.isDart2)
			this.skip();

		await openFile(helloWorldBrokenFile);
		const config = await startDebugger(helloWorldBrokenFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {
				line: positionOf("^throw").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(helloWorldBrokenFile),
			}),
			dc.launch(config),
		]);
	});

	it("provides exception details when stopped on exception", async () => {
		await openFile(helloWorldBrokenFile);
		const config = await startDebugger(helloWorldBrokenFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {
				line: positionOf("^throw").line + 1, // TODO: This line seems to be one-based but position is zero-based?
				path: fsPath(helloWorldBrokenFile),
			}),
			dc.launch(config),
		]);

		const variables = await getTopFrameVariables(dc, "Exception");
		ensureVariable(variables, undefined, "message", `"Oops"`);
	});

	it.skip("writes exception to stderr");
});
