import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as vs from "vscode";
import { DebugClient } from "vscode-debugadapter-testsupport";
import { activate, ext, helloWorldMainFile, helloWorldBrokenFile } from "../../helpers";

describe("dart cli debugger", () => {
	const dc = new DebugClient("node", path.join(ext.extensionPath, "out/src/debug/dart_debug_entry.js"), "dart");

	before(function () {
		// Skip these tests on Linux until we get a repsonse to
		// https://github.com/Microsoft/vscode/issues/47206
		if (process.env.TRAVIS_OS_NAME === "linux")
			this.skip();
	});
	before(() => activate(helloWorldMainFile));
	beforeEach(() => dc.start());
	afterEach(() => dc.stop());

	async function configFor(script: vs.Uri): Promise<vs.DebugConfiguration> {
		return await ext.exports.debugProvider.resolveDebugConfiguration(
			vs.workspace.workspaceFolders[0],
			{
				name: "Dart & Flutter",
				program: script.fsPath,
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

	// TODO: Figure out why this doesn't work...
	it.skip("receives stdout for a broken script", async () => {
		const config = await configFor(helloWorldBrokenFile);
		await Promise.all([
			dc.configurationSequence(),
			dc.launch(config),
			dc.assertOutput("stderr", "something..."),
			dc.waitForEvent("terminated"),
		]);
	});

	it("stops at a breakpoint", async () => {
		const config = await configFor(helloWorldMainFile);
		await Promise.all([
			dc.hitBreakpoint(config, {
				line: 2,
				path: helloWorldMainFile.fsPath,
			}),
		]);
	});
});
