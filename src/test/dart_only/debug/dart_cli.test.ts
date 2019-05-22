import * as assert from "assert";
import * as path from "path";
import * as vs from "vscode";
import { config } from "../../../extension/config";
import { debugAnywayAction, showErrorsAction } from "../../../extension/providers/debug_config_provider";
import { getRandomInt } from "../../../extension/utils";
import { log } from "../../../extension/utils/log";
import { platformEol } from "../../../shared/constants";
import { fetch } from "../../../shared/fetch";
import { fsPath } from "../../../shared/vscode/utils";
import { DartDebugClient } from "../../dart_debug_client";
import { ensureFrameCategories, ensureMapEntry, ensureVariable, ensureVariableWithIndex, isExternalPackage, isLocalPackage, isSdkFrame, isUserCode, spawnDartProcessPaused } from "../../debug_helpers";
import { activate, closeAllOpenFiles, defer, ext, extApi, getAttachConfiguration, getDefinition, getLaunchConfiguration, getPackages, helloWorldBrokenFile, helloWorldDeferredEntryFile, helloWorldDeferredScriptFile, helloWorldFolder, helloWorldGettersFile, helloWorldGoodbyeFile, helloWorldHttpFile, helloWorldLocalPackageFile, helloWorldMainFile, helloWorldPartEntryFile, helloWorldPartFile, helloWorldPathFile, helloWorldThrowInExternalPackageFile, helloWorldThrowInLocalPackageFile, helloWorldThrowInSdkFile, openFile, positionOf, sb, writeBrokenDartCodeIntoFileForTest } from "../../helpers";

describe("dart cli debugger", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());
	beforeEach("activate helloWorldMainFile", () => activate(helloWorldMainFile));

	let dc: DartDebugClient;
	beforeEach("create debug client", () => {
		dc = new DartDebugClient(process.execPath, path.join(ext.extensionPath, "out/extension/debug/dart_debug_entry.js"), "dart", undefined, extApi.debugCommands, undefined);
		dc.defaultTimeout = 60000;
		const thisDc = dc;
		defer(() => thisDc.stop());
	});

	async function startDebugger(script?: vs.Uri, extraConfiguration?: { [key: string]: any }): Promise<vs.DebugConfiguration | undefined | null> {
		const config = await getLaunchConfiguration(script, extraConfiguration);
		if (config) {
			await dc.start(config.debugServer);
		}
		return config;
	}

	async function attachDebugger(observatoryUri: string | undefined, extraConfiguration?: { [key: string]: any }): Promise<vs.DebugConfiguration | undefined | null> {
		const config = await getAttachConfiguration(Object.assign({ observatoryUri }, extraConfiguration));
		if (!config)
			throw new Error(`Could not get launch configuration (got ${config})`);
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

	describe("prompts the user if trying to run with errors", () => {
		function getTempProjectFile() {
			const fileName = `temp-${getRandomInt(0x1000, 0x10000).toString(16)}.dart`;
			return vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin", fileName));
		}
		function getTempTestFile() {
			const fileName = `temp-${getRandomInt(0x1000, 0x10000).toString(16)}.dart`;
			return vs.Uri.file(path.join(fsPath(helloWorldFolder), "test", fileName));
		}
		it("and cancels launch if they click Show Errors", async () => {
			await writeBrokenDartCodeIntoFileForTest(getTempProjectFile());

			const showErrorMessage = sb.stub(vs.window, "showErrorMessage");
			showErrorMessage.resolves(showErrorsAction);

			const config = await getLaunchConfiguration(helloWorldMainFile);

			// Since we clicked Show Errors, we expect the resolved config to be undefined, since
			// launch will have been aborted.
			assert.strictEqual(config, undefined);
			assert(showErrorMessage.calledOnce);
		});
		it("and launches if they click Debug Anyway", async () => {
			log(`Creating!`);
			await writeBrokenDartCodeIntoFileForTest(getTempProjectFile());

			const showErrorMessage = sb.stub(vs.window, "showErrorMessage");
			showErrorMessage.resolves(debugAnywayAction);

			const config = await startDebugger(helloWorldMainFile);

			// If we got a debug config, then we will launch normally.
			assert(config);
			assert(showErrorMessage.calledOnce);

			await Promise.all([
				dc.configurationSequence(),
				dc.assertOutput("stdout", "Hello, world!"),
				dc.waitForEvent("terminated"),
				dc.launch(config),
			]);
		});
		it("unless the errors are in test scripts", async () => {
			log(`Creating!`);
			await writeBrokenDartCodeIntoFileForTest(getTempTestFile());

			const showErrorMessage = sb.stub(vs.window, "showErrorMessage");
			showErrorMessage.resolves(debugAnywayAction);

			const config = await startDebugger(helloWorldMainFile);

			// Although we have errors, they're in test scripts, so we expect
			// them to be ignored.
			assert(config);
			assert(!showErrorMessage.calledOnce);

			await Promise.all([
				dc.configurationSequence(),
				dc.assertOutput("stdout", "Hello, world!"),
				dc.waitForEvent("terminated"),
				dc.launch(config),
			]);
		});
		it("in the test script being run", async () => {
			const tempTestScript = getTempProjectFile();
			await writeBrokenDartCodeIntoFileForTest(tempTestScript);

			const showErrorMessage = sb.stub(vs.window, "showErrorMessage");
			showErrorMessage.resolves(showErrorsAction);

			const config = await getLaunchConfiguration(tempTestScript);

			// Since the error is in the test script we're running, we expect the prompt.
			assert.strictEqual(config, undefined);
			assert(showErrorMessage.calledOnce);
		});
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
		config!.vmAdditionalArgs = ["--fake-flag"];
		await Promise.all([
			// TODO: Figure out if this is a bug - because we never connect to Observatory, we never
			// resolve this properly.
			// dc.configurationSequence(),
			dc.assertOutputContains("stderr", "Unrecognized flags: fake-flag"),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("successfully runs a Dart script with a relative path", async () => {
		const config = await startDebugger(helloWorldMainFile);
		config!.program = path.relative(fsPath(helloWorldFolder), fsPath(helloWorldMainFile));
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stdout", "Hello, world!"),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("runs bin/main.dart if no file is open/provided", async () => {
		await closeAllOpenFiles();
		const config = await startDebugger();
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
		const config = await startDebugger();
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stdout", "Goodbye!"),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	it("can launch DevTools", async function () {
		if (!extApi.dartCapabilities.supportsDevTools) {
			this.skip();
			return;
		}

		await openFile(helloWorldMainFile);
		const config = await startDebugger(helloWorldMainFile);
		// Stop at a breakpoint so the app won't quit while we're verifying DevTools.
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(helloWorldMainFile),
		});

		const devTools = await vs.commands.executeCommand("dart.openDevTools") as { url: string, dispose: () => void };
		assert.ok(devTools);
		defer(devTools.dispose);
		assert.ok(devTools.url);

		const serverResponse = await fetch(devTools.url);
		assert.notEqual(serverResponse.indexOf("Dart DevTools"), -1);
	});

	it("stops at a breakpoint", async () => {
		await openFile(helloWorldMainFile);
		const config = await startDebugger(helloWorldMainFile);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(helloWorldMainFile),
		});
		const stack = await dc.getStack();
		const frames = stack.body.stackFrames;
		assert.equal(frames[0].name, "main");
		assert.equal(frames[0].source!.path, fsPath(helloWorldMainFile));
		assert.equal(frames[0].source!.name, path.relative(fsPath(helloWorldFolder), fsPath(helloWorldMainFile)));
	});

	it("does not stop at a breakpoint in noDebug mode", async () => {
		await openFile(helloWorldMainFile);
		const config = await startDebugger(helloWorldMainFile);
		config.noDebug = true;
		await Promise.all([
			dc.waitForEvent("terminated"),
			dc.setBreakpointWithoutHitting(config, {
				line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(helloWorldMainFile),
				verified: false,
			}),
		]);
	});

	it("stops at a breakpoint in a part file", async function () {
		if (!extApi.dartCapabilities.handlesBreakpointsInPartFiles) {
			this.skip();
			return;
		}

		await openFile(helloWorldPartFile);
		const config = await startDebugger(helloWorldPartEntryFile);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line,
			path: fsPath(helloWorldPartFile),
		});
		const stack = await dc.getStack();
		const frames = stack.body.stackFrames;
		assert.equal(frames[0].name, "do_print");
		assert.equal(frames[0].source!.path, fsPath(helloWorldPartFile));
		assert.equal(frames[0].source!.name, "package:hello_world/part.dart");
	});

	it("stops at a breakpoint in a deferred file", async () => {
		await openFile(helloWorldDeferredScriptFile);
		const config = await startDebugger(helloWorldDeferredEntryFile);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line,
			path: fsPath(helloWorldDeferredScriptFile),
		});
		const stack = await dc.getStack();
		const frames = stack.body.stackFrames;
		assert.equal(frames[0].name, "do_print");
		assert.equal(frames[0].source!.path, fsPath(helloWorldDeferredScriptFile));
		assert.equal(frames[0].source!.name, "package:hello_world/deferred_script.dart");
	});

	// Known not to work; https://github.com/Dart-Code/Dart-Code/issues/821
	it.skip("stops at a breakpoint in the SDK", async () => {
		await openFile(helloWorldMainFile);
		// Get location for `print`
		const def = await getDefinition(positionOf("pri^nt("));
		const config = await startDebugger(helloWorldMainFile);
		await dc.hitBreakpoint(config, {
			line: def.range.start.line + 1,
			path: fsPath(def.uri),
		});
		const stack = await dc.getStack();
		const frames = stack.body.stackFrames;
		assert.equal(frames[0].name, "print");
		assert.equal(frames[0].source!.path, fsPath(def.uri));
		assert.equal(frames[0].source!.name, "dart:core/print.dart");
	});

	it("stops at a breakpoint in an external package", async () => {
		await openFile(helloWorldHttpFile);
		// Get location for `http.read`
		const def = await getDefinition(positionOf("http.re^ad"));
		const config = await startDebugger(helloWorldHttpFile);
		await dc.hitBreakpoint(config, {
			line: def.range.start.line + 1,
			path: fsPath(def.uri),
		});
		const stack = await dc.getStack();
		const frames = stack.body.stackFrames;
		assert.equal(frames[0].name, "read");
		assert.equal(frames[0].source!.path, fsPath(def.uri));
		assert.equal(frames[0].source!.name, "package:http/http.dart");
	});

	it("steps into the SDK if debugSdkLibraries is true", async () => {
		await openFile(helloWorldMainFile);
		// Get location for `print`
		const printCall = positionOf("pri^nt(");
		const config = await startDebugger(helloWorldMainFile, { debugSdkLibraries: true });
		await dc.hitBreakpoint(config, {
			line: printCall.line + 1,
			path: fsPath(helloWorldMainFile),
		});
		await Promise.all([
			dc.assertStoppedLocation("step", {
				// SDK source will have no filename, because we download it
				path: undefined,
			}).then((response) => {
				// Ensure the top stack frame matches
				const frame = response.body.stackFrames[0];
				assert.equal(frame.name, "print");
				// We don't get a source path, because the source is downloaded from the VM
				assert.equal(frame.source!.path, undefined);
				assert.equal(frame.source!.name, "dart:core/print.dart");
			}),
			dc.stepIn(),
		]);
	});

	it("does not step into the SDK if debugSdkLibraries is false", async () => {
		await openFile(helloWorldMainFile);
		// Get location for `print`
		const printCall = positionOf("pri^nt(");
		const config = await startDebugger(helloWorldMainFile, { debugSdkLibraries: false });
		await dc.hitBreakpoint(config, {
			line: printCall.line + 1,
			path: fsPath(helloWorldMainFile),
		});
		await Promise.all([
			dc.assertStoppedLocation("step", {
				// Ensure we stayed in the current file
				path: fsPath(helloWorldMainFile),
			}),
			dc.stepIn(),
		]);
	});

	it("steps into an external library if debugExternalLibraries is true", async () => {
		await openFile(helloWorldHttpFile);
		// Get location for `http.read(`
		const httpReadCall = positionOf("http.re^ad(");
		const httpReadDef = await getDefinition(httpReadCall);
		const config = await startDebugger(helloWorldHttpFile, { debugExternalLibraries: true });
		await dc.hitBreakpoint(config, {
			line: httpReadCall.line + 1,
			path: fsPath(helloWorldHttpFile),
		});
		await Promise.all([
			dc.assertStoppedLocation("step", {
				// Ensure we stepped into the external file
				path: fsPath(httpReadDef.uri),
			}).then((response) => {
				// Ensure the top stack frame matches
				const frame = response.body.stackFrames[0];
				assert.equal(frame.name, "read");
				assert.equal(frame.source!.path, fsPath(httpReadDef.uri));
				assert.equal(frame.source!.name, "package:http/http.dart");
			}),
			dc.stepIn(),
		]);
	});

	it("does not step into an external library if debugExternalLibraries is false", async () => {
		await openFile(helloWorldHttpFile);
		// Get location for `http.read(`
		const httpReadCall = positionOf("http.re^ad(");
		const config = await startDebugger(helloWorldHttpFile, { debugExternalLibraries: false });
		await dc.hitBreakpoint(config, {
			line: httpReadCall.line + 1,
			path: fsPath(helloWorldHttpFile),
		});
		await Promise.all([
			dc.assertStoppedLocation("step", {
				// Ensure we stayed in the current file
				path: fsPath(helloWorldHttpFile),
			}),
			dc.stepIn(),
		]);
	});

	it("steps into a local library even if debugExternalLibraries is false", async () => {
		await openFile(helloWorldLocalPackageFile);
		// Get location for `printMyThing()`
		const printMyThingCall = positionOf("printMy^Thing(");
		const printMyThingDef = await getDefinition(printMyThingCall);
		const config = await startDebugger(helloWorldLocalPackageFile, { debugExternalLibraries: false });
		await dc.hitBreakpoint(config, {
			line: printMyThingCall.line + 1,
			path: fsPath(helloWorldLocalPackageFile),
		});
		await Promise.all([
			dc.assertStoppedLocation("step", {
				// Ensure we stepped into the external file
				path: fsPath(printMyThingDef.uri),
			}).then((response) => {
				// Ensure the top stack frame matches
				const frame = response.body.stackFrames[0];
				assert.equal(frame.name, "printMyThing");
				assert.equal(frame.source!.path, fsPath(printMyThingDef.uri));
				assert.equal(frame.source!.name, "package:my_package/my_thing.dart");
			}),
			dc.stepIn(),
		]);
	});

	it("downloads SDK source code from the VM", async function () {
		if (!extApi.dartCapabilities.includesSourceForSdkLibs) {
			this.skip();
			return;
		}

		await openFile(helloWorldMainFile);
		// Get location for `print`
		const printCall = positionOf("pri^nt(");
		const config = await startDebugger(helloWorldMainFile, { debugSdkLibraries: true });
		await dc.hitBreakpoint(config, {
			line: printCall.line + 1,
			path: fsPath(helloWorldMainFile),
		});
		await Promise.all([
			dc.assertStoppedLocation("step", {
				// SDK source will have no filename, because we download it
				path: undefined,
			}).then(async (response) => {
				// Ensure the top stack frame matches
				const frame = response.body.stackFrames[0];
				assert.equal(frame.source!.path, undefined);
				assert.equal(frame.source!.name, "dart:core/print.dart");
				const source = await dc.sourceRequest({ source: frame.source, sourceReference: frame.source!.sourceReference! });
				assert.ok(source.body.content);
				assert.notEqual(source.body.content.indexOf("void print(Object object) {"), -1);
				// Ensure comments are present (see #178).
				assert.notEqual(source.body.content.indexOf("\n//"), -1);
			}),
			dc.stepIn(),
		]);
	});

	it("correctly marks non-debuggable SDK frames when debugSdkLibraries is false", async () => {
		await openFile(helloWorldThrowInSdkFile);
		const config = await startDebugger(helloWorldThrowInSdkFile, { debugSdkLibraries: false });
		await Promise.all([
			dc.configurationSequence(),
			dc.waitForEvent("stopped"),
			dc.launch(config),
		]);
		const stack = await dc.getStack();
		ensureFrameCategories(stack.body.stackFrames.filter(isSdkFrame), "deemphasize", "from the Dart SDK");
		ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);
	});

	it("correctly marks debuggable SDK frames when debugSdkLibraries is true", async () => {
		await openFile(helloWorldThrowInSdkFile);
		const config = await startDebugger(helloWorldThrowInSdkFile, { debugSdkLibraries: true });
		await Promise.all([
			dc.configurationSequence(),
			dc.waitForEvent("stopped"),
			dc.launch(config),
		]);
		const stack = await dc.getStack();
		ensureFrameCategories(stack.body.stackFrames.filter(isSdkFrame), undefined, undefined);
		ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);
	});

	it("correctly marks non-debuggable external library frames when debugExternalLibraries is false", async () => {
		await openFile(helloWorldThrowInExternalPackageFile);
		const config = await startDebugger(helloWorldThrowInExternalPackageFile, { debugExternalLibraries: false });
		await Promise.all([
			dc.configurationSequence(),
			dc.waitForEvent("stopped"),
			dc.launch(config),
		]);
		const stack = await dc.getStack();
		ensureFrameCategories(stack.body.stackFrames.filter(isExternalPackage), "deemphasize", "from Pub packages");
		ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);
	});

	it("correctly marks debuggable top frames even if not debuggable, if breakpoint/stepping", async () => {
		// There is an exception(!) to the deemphasiezed rule. If the reason we stopped was not an exception, the top
		// frame should never be deemphasized, as the user has explicitly decided to break (or step) there.
		await openFile(helloWorldPathFile);
		// For testing, we use `path.current` and `path.Style.platform`. The first calls the second, so by putting a breakpoint
		// inside path.Style.platform we can ensure multiple stack frames are in the path package.
		const pathStyleCall = positionOf("path.Style.pl^atform");
		const pathStyleDef = await getDefinition(pathStyleCall);
		const config = await startDebugger(helloWorldPathFile, { debugExternalLibraries: false });

		// Put a breakpoint inside the library, even though it's marked as not-debuggable.
		await dc.hitBreakpoint(config, {
			line: pathStyleDef.range.start.line + 1,
			path: fsPath(pathStyleDef.uri),
		});
		const stack = await dc.getStack();

		// Top frame is not deemphasized.
		assert.equal(isExternalPackage(stack.body.stackFrames[0]), true);
		ensureFrameCategories([stack.body.stackFrames[0]], undefined, undefined);

		// Step in further.
		await dc.stepIn();

		// Top frame is not deemphasized.
		assert.equal(isExternalPackage(stack.body.stackFrames[0]), true);
		ensureFrameCategories([stack.body.stackFrames[0]], undefined, undefined);
		// Rest are.
		ensureFrameCategories(stack.body.stackFrames.slice(1).filter(isExternalPackage), "deemphasize", "from Pub packages");
		ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);
	});

	it("correctly marks debuggable external library frames when debugExternalLibraries is true", async () => {
		await openFile(helloWorldThrowInExternalPackageFile);
		const config = await startDebugger(helloWorldThrowInExternalPackageFile, { debugExternalLibraries: true });
		await Promise.all([
			dc.configurationSequence(),
			dc.waitForEvent("stopped"),
			dc.launch(config),
		]);
		const stack = await dc.getStack();
		ensureFrameCategories(stack.body.stackFrames.filter(isExternalPackage), undefined, undefined);
		ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);
	});

	it("correctly marks debuggable local library frames even when debugExternalLibraries is false", async () => {
		await openFile(helloWorldThrowInLocalPackageFile);
		const config = await startDebugger(helloWorldThrowInLocalPackageFile, { debugExternalLibraries: false });
		await Promise.all([
			dc.configurationSequence(),
			dc.waitForEvent("stopped"),
			dc.launch(config),
		]);
		const stack = await dc.getStack();
		ensureFrameCategories(stack.body.stackFrames.filter(isLocalPackage), undefined, undefined);
		ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);
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
					? dc.assertOutput("console", expectedError)
					: Promise.resolve();
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
						logMessage: '${s} The \\{year} is """{(new DateTime.now()).year}"""',
					}],
					source: { path: fsPath(helloWorldMainFile) },
				});
			}).then((response) => dc.configurationDoneRequest()),
			dc.waitForEvent("terminated"),
			dc.assertOutputContains("stdout", `Hello! The {year} is """${(new Date()).getFullYear()}"""${platformEol}`),
			dc.launch(config),
		]);
	});

	it("provides local variables when stopped at a breakpoint", async () => {
		await openFile(helloWorldMainFile);
		const debugConfig = await startDebugger(helloWorldMainFile);
		await dc.hitBreakpoint(debugConfig, {
			line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(helloWorldMainFile),
		});

		const variables = await dc.getTopFrameVariables("Locals");
		ensureVariable(variables, "l", "l", `List (12 items)`);
		ensureVariable(variables, "longStrings", "longStrings", `List (1 item)`);
		ensureVariable(variables, "tenDates", "tenDates", `List (10 items)`);
		ensureVariable(variables, "hundredDates", "hundredDates", `List (100 items)`);
		ensureVariable(variables, "s", "s", `"Hello!"`);
		ensureVariable(variables, "m", "m", `Map (10 items)`);

		const listVariables = await dc.getVariables(variables.find((v) => v.name === "l")!.variablesReference);
		for (let i = 0; i <= 1; i++) {
			ensureVariableWithIndex(listVariables, i, `l[${i}]`, `[${i}]`, `${i}`);
		}

		const longStringListVariables = await dc.getVariables(variables.find((v) => v.name === "longStrings")!.variablesReference);
		ensureVariable(longStringListVariables, "longStrings[0]", "[0]", {
			ends: "…\"", // String is truncated here.
			starts: "\"This is a long string that is 300 characters!",
		});

		const shortdateListVariables = await dc.getVariables(variables.find((v) => v.name === "tenDates")!.variablesReference);
		ensureVariable(shortdateListVariables, "tenDates[0]", "[0]", config.previewToStringInDebugViews ? "DateTime (2005-01-01 00:00:00.000)" : "DateTime");

		const longdateListVariables = await dc.getVariables(variables.find((v) => v.name === "hundredDates")!.variablesReference);
		ensureVariable(longdateListVariables, "hundredDates[0]", "[0]", "DateTime"); // This doesn't call toString() because it's a long list'.

		const mapVariables = await dc.getVariables(variables.find((v) => v.name === "m")!.variablesReference);
		ensureVariable(mapVariables, undefined, "0", `"l" -> List (12 items)`);
		ensureVariable(mapVariables, undefined, "1", `"longStrings" -> List (1 item)`);
		ensureVariable(mapVariables, undefined, "2", `"tenDates" -> List (10 items)`);
		ensureVariable(mapVariables, undefined, "3", `"hundredDates" -> List (100 items)`);
		ensureVariable(mapVariables, undefined, "4", `"s" -> "Hello!"`);
		ensureVariable(mapVariables, undefined, "5", `DateTime -> "valentines-2000"`);
		ensureVariable(mapVariables, undefined, "6", `DateTime -> "new-year-2005"`);
		ensureVariable(mapVariables, undefined, "7", `true -> true`);
		ensureVariable(mapVariables, undefined, "8", `1 -> "one"`);
		ensureVariable(mapVariables, undefined, "9", `1.1 -> "one-point-one"`);

		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: `"l"` },
			value: { evaluateName: `m["l"]`, name: "value", value: "List (12 items)" },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: `"longStrings"` },
			value: { evaluateName: `m["longStrings"]`, name: "value", value: "List (1 item)" },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: `"s"` },
			value: { evaluateName: `m["s"]`, name: "value", value: `"Hello!"` },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: config.previewToStringInDebugViews ? `DateTime (2000-02-14 00:00:00.000)` : `DateTime` },
			value: { evaluateName: undefined, name: "value", value: `"valentines-2000"` },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: config.previewToStringInDebugViews ? `DateTime (2005-01-01 00:00:00.000)` : `DateTime` },
			value: { evaluateName: undefined, name: "value", value: `"new-year-2005"` },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: "true" },
			value: { evaluateName: `m[true]`, name: "value", value: "true" },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: "1" },
			value: { evaluateName: `m[1]`, name: "value", value: `"one"` },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: "1.1" },
			value: { evaluateName: `m[1.1]`, name: "value", value: `"one-point-one"` },
		}, dc);
	});

	it("excludes type args from local variables when stopped at a breakpoint in a generic method", async () => {
		await openFile(helloWorldMainFile);
		const debugConfig = await startDebugger(helloWorldMainFile);
		await dc.hitBreakpoint(debugConfig, {
			line: positionOf("^// BREAKPOINT2").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(helloWorldMainFile),
		});

		const variables = await dc.getTopFrameVariables("Locals");
		ensureVariable(variables, "a", "a", `1`);
		// Ensure there were no others.
		assert.equal(variables.length, 1);
	});

	it("includes getters in variables when stopped at a breakpoint", async () => {
		await openFile(helloWorldGettersFile);
		const config = await startDebugger(helloWorldGettersFile);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(helloWorldGettersFile),
		});

		const variables = await dc.getTopFrameVariables("Locals");
		ensureVariable(variables, "danny", "danny", `Danny`);

		const classInstance = await dc.getVariables(variables.find((v) => v.name === "danny")!.variablesReference);
		ensureVariable(classInstance, "danny.kind", "kind", `"Person"`);
		ensureVariable(classInstance, "danny.name", "name", `"Danny"`);
		ensureVariable(classInstance, undefined, "throws", { starts: "Unhandled exception:\nOops!" });
	});

	it("watch expressions provide same info as locals", async () => {
		await openFile(helloWorldMainFile);
		const config = await startDebugger(helloWorldMainFile);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(helloWorldMainFile),
		});

		const variables = await dc.getTopFrameVariables("Locals");

		for (const variable of variables) {
			const evaluateName = (variable as any).evaluateName;
			if (!evaluateName)
				continue;
			const evaluateResult = await dc.evaluate(evaluateName);
			assert.ok(evaluateResult);
			assert.equal(evaluateResult.result, variable.value);
			assert.equal(!!evaluateResult.variablesReference, !!variable.variablesReference);
		}
	});

	it("evaluateName evaluates to the expected value", async () => {
		await openFile(helloWorldMainFile);
		const config = await startDebugger(helloWorldMainFile);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(helloWorldMainFile),
		});

		const variables = await dc.getTopFrameVariables("Locals");
		const listVariables = await dc.getVariables(variables.find((v) => v.name === "l").variablesReference);
		const listLongstringVariables = await dc.getVariables(variables.find((v) => v.name === "longStrings").variablesReference);
		const mapVariables = await dc.getVariables(variables.find((v) => v.name === "m").variablesReference);
		const allVariables = listVariables.concat(listLongstringVariables).concat(mapVariables);

		for (const variable of allVariables) {
			const evaluateName = (variable as any).evaluateName;
			if (!evaluateName)
				continue;
			const evaluateResult = await dc.evaluate(evaluateName);
			assert.ok(evaluateResult);
			if (variable.value.endsWith("…\"")) {
				// If the value was truncated, the evaluate responses should be longer
				const prefix = variable.value.slice(1, -2);
				assert.ok(evaluateResult.result.length > prefix.length);
				assert.equal(evaluateResult.result.slice(0, prefix.length), prefix);
			} else {
				// Otherwise it should be the same.
				assert.equal(evaluateResult.result, variable.value);
			}
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

	it("does not stop on exception in noDebug mode", async () => {
		await openFile(helloWorldBrokenFile);
		const config = await startDebugger(helloWorldBrokenFile);
		config.noDebug = true;
		await Promise.all([
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
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

		const variables = await dc.getTopFrameVariables("Exception");
		ensureVariable(variables, "$e.message", "message", `"Oops"`);
	});

	it("writes exception to stderr", async () => {
		await openFile(helloWorldBrokenFile);
		const config = await startDebugger(helloWorldBrokenFile);
		config!.noDebug = true;
		await Promise.all([
			dc.configurationSequence(),
			dc.assertOutput("stderr", "Unhandled exception:"),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		]);
	});

	describe("attaches", () => {
		it("to a paused Dart script and can unpause to run it to completion", async () => {
			const process = spawnDartProcessPaused(await getLaunchConfiguration(helloWorldMainFile));
			const observatoryUri = await process.observatoryUri;

			const config = await attachDebugger(observatoryUri);
			await Promise.all([
				dc.configurationSequence(),
				dc.waitForEvent("terminated"),
				dc.launch(config),
			]);
		});

		it("when provided only a port in launch.config", async () => {
			const vmArgs = extApi.dartCapabilities.supportsDisableServiceTokens ? ["--disable-service-auth-codes"] : [];
			const process = spawnDartProcessPaused(await getLaunchConfiguration(helloWorldMainFile), ...vmArgs);
			const observatoryUri = await process.observatoryUri;
			const observatoryPort = /:([0-9]+)\//.exec(observatoryUri)![1];

			// Include whitespace as a test for trimming.
			const config = await attachDebugger(` ${observatoryPort} `);
			await Promise.all([
				dc.configurationSequence(),
				dc.waitForEvent("terminated"),
				dc.launch(config),
			]);
		});

		it("to the observatory uri provided by the user when not specified in launch.json", async () => {
			const process = spawnDartProcessPaused(await getLaunchConfiguration(helloWorldMainFile));
			const observatoryUri = await process.observatoryUri;

			const showInputBox = sb.stub(vs.window, "showInputBox");
			showInputBox.resolves(observatoryUri);

			const config = await attachDebugger(undefined);
			await Promise.all([
				dc.configurationSequence(),
				dc.waitForEvent("terminated"),
				dc.launch(config),
			]);

			assert.ok(showInputBox.calledOnce);
		});

		it("to a paused Dart script and can set breakpoints", async () => {
			const process = spawnDartProcessPaused(await getLaunchConfiguration(helloWorldMainFile));
			const observatoryUri = await process.observatoryUri;

			const config = await attachDebugger(observatoryUri);
			await dc.hitBreakpoint(config, {
				line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(helloWorldMainFile),
			});
		});

		it("and removes breakpoints and unpauses on detach", async () => {
			const process = spawnDartProcessPaused(await getLaunchConfiguration(helloWorldMainFile));
			const observatoryUri = await process.observatoryUri;

			const config = await attachDebugger(observatoryUri);
			await dc.hitBreakpoint(config, {
				line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(helloWorldMainFile),
			});
			log("Sending terminate request...");
			await dc.terminateRequest();
			log("Disconnected!");

			log("Waiting for process to terminate...");
			await process.exitCode;
		});

		it("and reports failure to connect to the Observatory");
	});
});
