import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { fsPath } from "../../../src/utils";
import { DartDebugClient } from "../../debug_client";
import { ensureMapEntry, ensureOutputContains, ensureVariable, evaluate, getTopFrameVariables, getVariables, spawnProcessPaused } from "../../debug_helpers";
import { activate, closeAllOpenFiles, defer, ext, getAttachConfiguration, getLaunchConfiguration, helloWorldBrokenFile, helloWorldFolder, helloWorldGoodbyeFile, helloWorldMainFile, openFile, platformEol, positionOf, sb } from "../../helpers";

describe("dart cli debugger", () => {
	beforeEach(() => activate(helloWorldMainFile));

	let dc: DartDebugClient;
	beforeEach(() => {
		dc = new DartDebugClient(process.execPath, path.join(ext.extensionPath, "out/src/debug/dart_debug_entry.js"), "dart");
		dc.defaultTimeout = 30000;
		defer(() => dc.stop());
	});

	async function startDebugger(script: vs.Uri): Promise<vs.DebugConfiguration> {
		const config = await getLaunchConfiguration(script);
		await dc.start(config.debugServer);
		return config;
	}

	async function attachDebugger(observatoryUri: string): Promise<vs.DebugConfiguration> {
		const config = await getAttachConfiguration(observatoryUri);
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

	it("stops at a breakpoint in the SDK");
	it("stops at a breakpoint in an external package");

	it("steps into the SDK if debugSdkLibraries is true");
	it("does not stop into the SDK if debugSdkLibraries is false");
	it("steps into an external library if debugExternalLibraries is true");
	it("does not step into an external library if debugExternalLibraries is false");

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
			dc.assertOutput("stdout", `Hello! The {year} is ${(new Date()).getFullYear()}${platformEol}Hello, world!`),
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
		ensureVariable(mapVariables, undefined, "0", `"l" -> [2]`);
		ensureVariable(mapVariables, undefined, "1", `"s" -> "Hello!"`);
		ensureVariable(mapVariables, undefined, "2", `DateTime -> "today"`);
		ensureVariable(mapVariables, undefined, "3", `DateTime -> "tomorrow"`);
		ensureVariable(mapVariables, undefined, "4", `true -> true`);
		ensureVariable(mapVariables, undefined, "5", `1 -> "one"`);
		ensureVariable(mapVariables, undefined, "6", `1.1 -> "one-point-one"`);

		await ensureMapEntry(mapVariables, {
			key: { evaluateName: null, name: "key", value: `"l"` },
			value: { evaluateName: `m["l"]`, name: "value", value: "[2]" },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: null, name: "key", value: `"s"` },
			value: { evaluateName: `m["s"]`, name: "value", value: `"Hello!"` },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: null, name: "key", value: `DateTime` },
			value: { evaluateName: null, name: "value", value: `"today"` },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: null, name: "key", value: `DateTime` },
			value: { evaluateName: null, name: "value", value: `"tomorrow"` },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: null, name: "key", value: "true" },
			value: { evaluateName: `m[true]`, name: "value", value: "true" },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: null, name: "key", value: "1" },
			value: { evaluateName: `m[1]`, name: "value", value: `"one"` },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: null, name: "key", value: "1.1" },
			value: { evaluateName: `m[1.1]`, name: "value", value: `"one-point-one"` },
		}, dc);
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
		const allVariables = variables.concat(listVariables).concat(mapVariables);

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

	it("stops on exception", async () => {
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

	describe("attaches", () => {
		it("to a paused Dart script and can unpause to run it to completion", async () => {
			const process = spawnProcessPaused(await getLaunchConfiguration(helloWorldMainFile));
			const observatoryUri = await process.observatoryUri;

			const config = await attachDebugger(observatoryUri);
			await Promise.all([
				dc.configurationSequence(),
				dc.waitForEvent("terminated"),
				dc.launch(config),
			]);
		});

		it("when provided only a port in launch.config", async () => {
			const process = spawnProcessPaused(await getLaunchConfiguration(helloWorldMainFile));
			const observatoryUri = await process.observatoryUri;
			const observatoryPort = /:([0-9]+)\/?$/.exec(observatoryUri)[1];

			// Include whitespace as a test for trimming.
			const config = await attachDebugger(` ${observatoryPort} `);
			await Promise.all([
				dc.configurationSequence(),
				dc.waitForEvent("terminated"),
				dc.launch(config),
			]);
		});

		it("to the observatory uri provided by the user when not specified in launch.json", async () => {
			const process = spawnProcessPaused(await getLaunchConfiguration(helloWorldMainFile));
			const observatoryUri = await process.observatoryUri;

			const showInputBox = sb.stub(vs.window, "showInputBox");
			showInputBox.resolves(observatoryUri);

			const config = await attachDebugger(null);
			await Promise.all([
				dc.configurationSequence(),
				dc.waitForEvent("terminated"),
				dc.launch(config),
			]);

			assert.ok(showInputBox.calledOnce);
		});

		it("to a paused Dart script and can set breakpoints", async () => {
			const process = spawnProcessPaused(await getLaunchConfiguration(helloWorldMainFile));
			const observatoryUri = await process.observatoryUri;

			const config = await attachDebugger(observatoryUri);
			await Promise.all([
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
					path: fsPath(helloWorldMainFile),
				}),
			]);
		});

		it("and removes breakpoints and unpauses on detach", async () => {
			const process = spawnProcessPaused(await getLaunchConfiguration(helloWorldMainFile));
			const observatoryUri = await process.observatoryUri;

			const config = await attachDebugger(observatoryUri);
			await Promise.all([
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
					path: fsPath(helloWorldMainFile),
				}).then((_) => dc.disconnectRequest()),
			]);

			await process.exitCode;
		});

		it("and reports failure to connect to the Observatory");
	});
});
