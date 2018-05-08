import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { DebugClient } from "vscode-debugadapter-testsupport";
import { fsPath } from "../../../src/utils";
import { ensureOutputContains, ensureVariable, evaluate, getTopFrameVariables, getVariables } from "../../debug_helpers";
import { activate, closeAllOpenFiles, ext, helloWorldBrokenFile, helloWorldFolder, helloWorldGoodbyeFile, helloWorldMainFile, openFile, positionOf } from "../../helpers";

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

	it("passes launch.json's vmAdditionalArgs to the VM", async () => {
		const config = await startDebugger(helloWorldMainFile);
		config.vmAdditionalArgs = ["--fake-flag"];
		await Promise.all([
			// TODO: Figure out if this is a bug - because we never connect to Observatory, we never
			// resolve this properly.
			// dc.configurationSequence(),
			ensureOutputContains(dc, "stderr", "Unrecognized flags: fake-flag"),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("successfully runs a Dart script with a relative path", async () => {
		const config = await startDebugger(helloWorldMainFile);
		config.program = path.relative(fsPath(helloWorldFolder), fsPath(helloWorldMainFile));
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

	function testBreakpointCondition(condition: string, shouldStop: boolean, expectedError?: string) {
		return async () => {
			await openFile(helloWorldMainFile);
			const config = await startDebugger(helloWorldMainFile);
			const completionEvent: Promise<any> =
				shouldStop
					? dc.assertStoppedLocation("breakpoint", {})
					: dc.waitForEvent("terminated");
			const errorOutputEvent: Promise<any> =
				expectedError
					? dc.assertOutput("stderr", expectedError)
					: null;
			await Promise.all([
				dc.waitForEvent("initialized").then((event) => {
					return dc.setBreakpointsRequest({
						// positionOf is 0-based, but seems to want 1-based
						breakpoints: [{
							condition,
							line: positionOf("^// BREAKPOINT1").line + 1,
						}],
						source: { path: fsPath(helloWorldMainFile) },
					});
				}).then((response) => dc.configurationDoneRequest()),
				completionEvent,
				errorOutputEvent,
				dc.launch(config),
			]);
		};
	}

	it("stops at a breakpoint with a condition returning true", testBreakpointCondition("1 == 1", true));
	it("stops at a breakpoint with a condition returning 1", testBreakpointCondition("3 - 2", true));
	it("doesn't stop at a breakpoint with a condition returning a string", testBreakpointCondition("'test'", false));
	it("doesn't stop at a breakpoint with a condition returning false", testBreakpointCondition("1 == 0", false));
	it("doesn't stop at a breakpoint with a condition returning 0", testBreakpointCondition("3 - 3", false));
	it("doesn't stop at a breakpoint with a condition returning null", testBreakpointCondition("print('test');", false));
	it("reports errors evaluating breakpoint conditions", testBreakpointCondition("1 + '1'", false, "Debugger failed to evaluate expression `1 + '1'`"));

	it("logs expected text (and does not stop) at a logpoint", async () => {
		await openFile(helloWorldMainFile);
		const config = await startDebugger(helloWorldMainFile);
		await Promise.all([
			dc.waitForEvent("initialized").then((event) => {
				return dc.setBreakpointsRequest({
					// positionOf is 0-based, but seems to want 1-based
					breakpoints: [{
						line: positionOf("^// BREAKPOINT1").line + 1,
						// VS Code says to use {} for expressions, but we want to support Dart's native too, so
						// we have examples of both (as well as "escaped" brackets).
						logMessage: "${s} The \\{year} is {(new DateTime.now()).year}",
					}],
					source: { path: fsPath(helloWorldMainFile) },
				});
			}).then((response) => dc.configurationDoneRequest()),
			dc.waitForEvent("terminated"),
			dc.assertOutput("stdout", `Hello! The {year} is ${(new Date()).getFullYear()}`)
				.then((_) => dc.assertOutput("stdout", `Hello, world!`)),
			dc.launch(config),
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
		ensureVariable(variables, "l", "l", `[2]`);
		ensureVariable(variables, "s", "s", `"Hello!"`);
		ensureVariable(variables, "m", "m", `{7}`);

		const listVariables = await getVariables(dc, variables.find((v) => v.name === "l").variablesReference);
		ensureVariable(listVariables, "l[0]", "[0]", "0");
		ensureVariable(listVariables, "l[1]", "[1]", "1");

		const mapVariables = await getVariables(dc, variables.find((v) => v.name === "m").variablesReference);
		ensureVariable(mapVariables, `m["l"]`, `0 = ["l"]`, "[2]");
		ensureVariable(mapVariables, `m["s"]`, `1 = ["s"]`, `"Hello!"`);
		ensureVariable(mapVariables, undefined, `2 = [DateTime]`, `"today"`);
		ensureVariable(mapVariables, undefined, `3 = [DateTime]`, `"tomorrow"`);
		ensureVariable(mapVariables, `m[true]`, `4 = [true]`, `true`);
		ensureVariable(mapVariables, `m[1]`, `5 = [1]`, `"one"`);
		ensureVariable(mapVariables, `m[1.1]`, `6 = [1.1]`, `"one-point-one"`);

		const mapListVariables = await getVariables(dc, mapVariables.find((v) => v.name === `0 = ["l"]`).variablesReference);
		ensureVariable(mapListVariables, `m["l"][0]`, "[0]", "0");
		ensureVariable(mapListVariables, `m["l"][1]`, "[1]", "1");
	});

	it("watch expressions provide same info as locals", async () => {
		await openFile(helloWorldMainFile);
		const config = await startDebugger(helloWorldMainFile);
		await Promise.all([
			dc.hitBreakpoint(config, {
				line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(helloWorldMainFile),
			}),
		]);

		const variables = await getTopFrameVariables(dc, "Locals");
		const listVariables = await getVariables(dc, variables.find((v) => v.name === "l").variablesReference);
		const mapVariables = await getVariables(dc, variables.find((v) => v.name === "m").variablesReference);
		const mapListVariables = await getVariables(dc, mapVariables.find((v) => v.name === `0 = ["l"]`).variablesReference);
		const allVariables = variables.concat(listVariables).concat(mapVariables).concat(mapListVariables);

		for (const variable of allVariables) {
			const evaluateName = (variable as any).evaluateName;
			if (!evaluateName)
				continue;
			const evaluateResult = await evaluate(dc, evaluateName);
			assert.ok(evaluateResult);
			assert.equal(evaluateResult.result, variable.value);
			assert.equal(!!evaluateResult.variablesReference, !!variable.variablesReference);
		}
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
