import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { DebugClient } from "vscode-debugadapter-testsupport";
import { activate, ext, closeAllOpenFiles, flutterHelloWorldMainFile, flutterTestMainFile, positionOf, flutterTestOtherFile, flutterTestBrokenFile, openFile } from "../../helpers";

describe("flutter test debugger", () => {
	const dc = new DebugClient(process.execPath, path.join(ext.extensionPath, "out/src/debug/flutter_test_debug_entry.js"), "dart");
	// Spawning flutter tests seem to be kinda slow (and may fetch packages), so we need a higher timeout
	dc.defaultTimeout = 60000;

	beforeEach(() => activate(flutterTestMainFile));
	beforeEach(function () {
		this.timeout(60000); // These tests can be slow due to flutter package fetches when running.
	});
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

	it("runs a Flutter test script to completion", async () => {
		const config = await configFor(flutterTestMainFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			dc.waitForEvent("terminated"),
		]);
	});

	it("receives the expected output from a Flutter test script", async () => {
		const config = await configFor(flutterTestMainFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			dc.assertOutput("stdout", "✓ - Hello world test"),
			dc.waitForEvent("terminated"),
		]);
	});

	it("runs the provided script regardless of what's open", async () => {
		await openFile(flutterTestMainFile);
		const config = await configFor(flutterTestOtherFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			dc.assertOutput("stdout", "✓ - Other test\n"),
			dc.waitForEvent("terminated"),
		]);
	});

	it("runs the open script if no file is provided", async () => {
		await openFile(flutterTestOtherFile);
		const config = await configFor(null);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			dc.assertOutput("stdout", "✓ - Other test\n"),
			dc.waitForEvent("terminated"),
		]);
	});

	it.skip("stops on exception", async () => {
		await openFile(flutterTestBrokenFile);
		const config = await configFor(flutterTestBrokenFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			dc.assertStoppedLocation("exception", {
				line: positionOf("^won't find this").line + 1, // TODO: This line seems to be one-based but position is zero-based?
				path: flutterTestBrokenFile.fsPath,
			}),
		]);
	});

	it("writes failure output to stderr", async () => {
		await openFile(flutterTestBrokenFile);
		const config = await configFor(flutterTestBrokenFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			dc.assertOutput("stderr", "Test failed. See exception logs above."),
		]);
	});

	it("stops at a breakpoint", async () => {
		await openFile(flutterTestMainFile);
		const config = await configFor(flutterTestMainFile);
		await Promise.all([
			dc.hitBreakpoint(config, {
				line: positionOf("^// BREAKPOINT1").line,
				path: flutterTestMainFile.fsPath,
			}),
		]);
	});
});
