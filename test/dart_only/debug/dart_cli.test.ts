import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { DebugClient } from "vscode-debugadapter-testsupport";
import { activate, ext, helloWorldMainFile, helloWorldBrokenFile, closeAllOpenFiles, helloWorldGoodbyeFile, positionOf, openFile } from "../../helpers";

describe("dart cli debugger", () => {
	const dc = new DebugClient(process.execPath, path.join(ext.extensionPath, "out/src/debug/dart_debug_entry.js"), "dart");
	dc.defaultTimeout = 30000;

	beforeEach(() => activate(helloWorldMainFile));
	beforeEach(() => dc.start());
	afterEach(() => dc.stop());

	async function configFor(script: vs.Uri): Promise<vs.DebugConfiguration> {
		return await ext.exports.debugProvider.resolveDebugConfiguration(
			vs.workspace.workspaceFolders[0],
			{
				name: "Dart & Flutter",
				program: script && script.fsPath,
				request: "launch",
				type: "dart",
			},
		);
	}

	it("runs a Dart script to completion", async () => {
		const config = await configFor(helloWorldMainFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			dc.waitForEvent("terminated"),
		]);
	});

	it("receives the expected output from a Dart script", async () => {
		const config = await configFor(helloWorldMainFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			dc.assertOutput("stdout", "Hello, world!"),
			dc.waitForEvent("terminated"),
		]);
	});

	it("runs bin/main.dart if no file is open/provided", async () => {
		await closeAllOpenFiles();
		const config = await configFor(null);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			dc.assertOutput("stdout", "Hello, world!"),
			dc.waitForEvent("terminated"),
		]);
	});

	it("runs the provided script regardless of what's open", async () => {
		await openFile(helloWorldMainFile);
		const config = await configFor(helloWorldGoodbyeFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			dc.assertOutput("stdout", "Goodbye!"),
			dc.waitForEvent("terminated"),
		]);
	});

	it("runs the open script if no file is provided", async () => {
		await openFile(helloWorldGoodbyeFile);
		const config = await configFor(null);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			dc.assertOutput("stdout", "Goodbye!"),
			dc.waitForEvent("terminated"),
		]);
	});

	// TODO: Figure out why this doesn't work...
	it.skip("receives stderr for a broken script", async () => {
		const config = await configFor(helloWorldBrokenFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			dc.assertOutput("stderr", "bad"),
			dc.waitForEvent("terminated"),
		]);
	});

	it("stops at a breakpoint", async () => {
		await openFile(helloWorldMainFile);
		const config = await configFor(helloWorldMainFile);
		await Promise.all([
			dc.hitBreakpoint(config, {
				line: positionOf("^// BREAKPOINT1").line,
				path: helloWorldMainFile.fsPath,
			}),
		]);
	});
});
