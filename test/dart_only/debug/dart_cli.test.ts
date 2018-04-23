import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { DebugClient } from "vscode-debugadapter-testsupport";
import { activate, ext, helloWorldMainFile, helloWorldBrokenFile, closeAllOpenFiles, helloWorldGoodbyeFile, positionOf, openFile } from "../../helpers";
import { getVariables } from "../../debug_helpers";

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
				program: script && script.fsPath,
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
			dc.launch(config),
			dc.waitForEvent("terminated"),
		]);
	});

	it("receives the expected output from a Dart script", async () => {
		const config = await startDebugger(helloWorldMainFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			dc.assertOutput("stdout", "Hello, world!"),
			dc.waitForEvent("terminated"),
		]);
	});

	it("runs bin/main.dart if no file is open/provided", async () => {
		await closeAllOpenFiles();
		const config = await startDebugger(null);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			dc.assertOutput("stdout", "Hello, world!"),
			dc.waitForEvent("terminated"),
		]);
	});

	it("runs the provided script regardless of what's open", async () => {
		await openFile(helloWorldMainFile);
		const config = await startDebugger(helloWorldGoodbyeFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			dc.assertOutput("stdout", "Goodbye!"),
			dc.waitForEvent("terminated"),
		]);
	});

	it("runs the open script if no file is provided", async () => {
		await openFile(helloWorldGoodbyeFile);
		const config = await startDebugger(null);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			dc.assertOutput("stdout", "Goodbye!"),
			dc.waitForEvent("terminated"),
		]);
	});

	it("stops at a breakpoint", async () => {
		await openFile(helloWorldMainFile);
		const config = await startDebugger(helloWorldMainFile);
		await Promise.all([
			dc.hitBreakpoint(config, {
				line: positionOf("^// BREAKPOINT1").line,
				path: helloWorldMainFile.fsPath,
			}),
		]);
	});

	it("provides local variables when stopped at a breakpoint");

	it("stops on exception", async () => {
		await openFile(helloWorldBrokenFile);
		const config = await startDebugger(helloWorldBrokenFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			dc.assertStoppedLocation("exception", {
				line: positionOf("^throw").line + 1, // TODO: This line seems to be one-based but position is zero-based?
				path: helloWorldBrokenFile.fsPath,
			}),
		]);
	});

	it("provides exception details when stopped on exception", async () => {
		await openFile(helloWorldBrokenFile);
		const config = await startDebugger(helloWorldBrokenFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			dc.assertStoppedLocation("exception", {
				line: positionOf("^throw").line + 1, // TODO: This line seems to be one-based but position is zero-based?
				path: helloWorldBrokenFile.fsPath,
			}),
		]);

		const variables = await getVariables(dc, "Exception");
		const exceptionVariable = variables.body.variables.find((s) => s.name === "message");
		assert.ok(exceptionVariable);
		assert.equal(exceptionVariable.name, "message");
		assert.equal(exceptionVariable.value, `"Oops"`);
	});

	it.skip("writes exception to stderr");
});
