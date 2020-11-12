import * as assert from "assert";
import * as path from "path";
import { DebugConfiguration, Uri } from "vscode";
import { DebugProtocol } from "vscode-debugprotocol";
import { dartVMPath, debugAdapterPath, flutterPath, isWin, vmServiceListeningBannerPattern } from "../shared/constants";
import { FlutterLaunchRequestArguments } from "../shared/debug/interfaces";
import { DebuggerType, LogCategory } from "../shared/enums";
import { SpawnedProcess } from "../shared/interfaces";
import { logProcess } from "../shared/logging";
import { getDebugAdapterName, getDebugAdapterPort } from "../shared/utils/debug";
import { fsPath } from "../shared/utils/fs";
import { DartDebugClient } from "./dart_debug_client";
import { currentTestName, defer, delay, ext, extApi, getLaunchConfiguration, logger, watchPromise, withTimeout } from "./helpers";

export const flutterTestDeviceId = process.env.FLUTTER_TEST_DEVICE_ID || "flutter-tester";
export const flutterTestDeviceIsWeb = flutterTestDeviceId === "chrome" || flutterTestDeviceId === "web-server";

export async function startDebugger(dc: DartDebugClient, script?: Uri | string, extraConfiguration?: { [key: string]: any }): Promise<DebugConfiguration> {
	extraConfiguration = Object.assign(
		{ deviceId: flutterTestDeviceId },
		extraConfiguration,
	);
	const config = await getLaunchConfiguration(script, extraConfiguration);
	if (!config)
		throw new Error(`Could not get launch configuration (got ${config})`);
	await watchPromise("startDebugger->start", dc.start());
	return config;
}

export function createDebugClient(debugType: DebuggerType) {
	const debugAdapterName = getDebugAdapterName(debugType);
	const debugAdapterPort = getDebugAdapterPort(debugAdapterName);
	const debuggerExecutablePath = path.join(fsPath(ext.extensionUri), debugAdapterPath);
	const debuggerArgs = [debugAdapterName];

	// TODO: Change this to go through DartDebugAdapterDescriptorFactory to ensure we don't have tests that pass
	// if we've broken the real implementation.
	const dc = process.env.DART_CODE_USE_DEBUG_SERVERS
		? new DartDebugClient({ port: debugAdapterPort }, extApi.debugCommands, extApi.testCoordinator)
		: new DartDebugClient({ runtime: "node", executable: debuggerExecutablePath, args: debuggerArgs }, extApi.debugCommands, extApi.testCoordinator);

	dc.defaultTimeout = 60000;
	const thisDc = dc;
	if (debugAdapterName.endsWith("_test")) {
		// The test runner doesn't quit on the first SIGINT, it prints a message that it's waiting for the
		// test to finish and then runs cleanup. Since we don't care about this for these tests, we just send
		// a second request and that'll cause it to quit immediately.
		defer(() => withTimeout(
			Promise.all([
				thisDc.terminateRequest().catch((e) => logger.error(e)),
				delay(500).then(() => thisDc.stop()).catch((e) => logger.error(e)),
			]),
			"Timed out disconnecting - this is often normal because we have to try to quit twice for the test runner",
			60,
		));
	} else {
		defer(() => thisDc.stop());
	}
	return dc;
}

/// Waits for all the provided promises, but throws if the debugger terminates before they complete.
export function waitAllThrowIfTerminates(dc: DartDebugClient, ...promises: Array<Promise<any>>) {
	let didCompleteSuccessfully = false;
	return Promise.race([
		new Promise(async (resolve, reject) => {
			await dc.waitForEvent("terminated")
				.catch(() => {
					// Swallow errors, as we don't care if this times out, we're only using it
					// to tell if we stopped by the time we hit the end of this test.
				});
			// Wait a small amount to allow other awaited tasks to complete.
			setTimeout(() => {
				if (didCompleteSuccessfully) {
					resolve();
					return;
				}
				reject(Error("Terminated while waiting for other promises!"));
			}, 500);
		}),
		Promise.all(promises).then(() => didCompleteSuccessfully = true),
	]);
}

export function ensureVariable(variables: DebugProtocol.Variable[], evaluateName: string | undefined, name: string, value: string | { starts?: string, ends?: string }) {
	assert.ok(variables && variables.length, "No variables given to search");
	const v = variables.find((v) => v.name === name);
	assert.ok(
		v,
		`Couldn't find variable ${name} in\n`
		+ variables.map((v) => `        ${v.name}: ${v.value}`).join("\n"),
	);
	assert.equal(v.evaluateName, evaluateName);
	if (typeof value === "string")
		assert.equal(v.value, value);
	else {
		if (value.starts)
			assert.equal(v.value.slice(0, value.starts.length), value.starts);
		if (value.ends)
			assert.equal(v.value.slice(-value.ends.length), value.ends);
	}
}

export function ensureVariableWithIndex(variables: DebugProtocol.Variable[], index: number, evaluateName: string | undefined, name: string, value: string | { starts?: string, ends?: string }) {
	assert.ok(variables && variables.length, "No variables given to search");
	const foundIndex = variables.findIndex((v) => v.name === name);
	assert.equal(index, foundIndex, `Found variable ${name} at index ${foundIndex} but expected ${index}`);
	ensureVariable(variables, evaluateName, name, value);
}

export interface MapEntry {
	key: {
		evaluateName: string | undefined;
		name: string;
		value: string;
	};
	value: {
		evaluateName: string | undefined;
		name: string;
		value: string;
	};
}

export async function ensureMapEntry(mapEntries: DebugProtocol.Variable[], entry: MapEntry, dc: DartDebugClient) {
	assert.ok(mapEntries);
	let found = false;
	const keyValues: string[] = [];
	await Promise.all(mapEntries.map(async (mapEntry) => {
		const variable = await dc.getVariables(mapEntry.variablesReference);

		const key = variable[0];
		const value = variable[1];
		assert.ok(key, "Didn't get Key variable");
		assert.ok(value, "Didn't get Value variable");
		if (key.name === entry.key.name
			&& key.value === entry.key.value
			&& key.evaluateName === entry.key.evaluateName
			&& value.evaluateName === entry.value.evaluateName
			&& value.name === entry.value.name
			&& value.value === entry.value.value)
			found = true;
		keyValues.push(`${key.value}=${value.value}`);
	}));
	assert.ok(found, `Didn't find map entry for ${entry.key.value}=${entry.value.value}\nGot:\n  ${keyValues.join("\n  ")})`);
}

export async function getVariablesTree(dc: DartDebugClient, variablesReference: number): Promise<string[]> {
	let outputLines: string[] = [];
	for (const variable of await dc.getVariables(variablesReference)) {
		// Ignore types that recurse indefinitely, or we just don't want to check
		// in tests.
		if (variable.name === "runtimeType" || variable.name === "hashCode")
			continue;
		outputLines.push(`${variable.name}=${variable.value}`);
		if (variable.variablesReference) {
			const childLines = await getVariablesTree(dc, variable.variablesReference);
			outputLines = outputLines.concat(childLines.map((l) => `  ${l}`));
		}
	}
	return outputLines;
}

export function spawnDartProcessPaused(program: Uri, cwd: Uri, ...vmArgs: string[]): DartProcess {
	const programPath = fsPath(program);
	const cwdPath = fsPath(cwd);
	const dartPath = path.join(extApi.workspaceContext.sdks.dart!, dartVMPath);
	const allArgs = [
		"--enable-vm-service=0",
		"--pause_isolates_on_start=true",
		...vmArgs,
		programPath,
	];
	logger.info(`Spawning ${dartPath} in ${cwdPath} with args ${JSON.stringify(allArgs)}`);
	const process = extApi.safeToolSpawn(
		cwdPath,
		dartPath,
		allArgs,
	);
	logProcess(logger, LogCategory.CI, process);
	const dartProcess = new DartProcess(process);
	defer(() => {
		if (!dartProcess.hasExited)
			dartProcess.process.kill();
	});
	return dartProcess;
}

export async function spawnFlutterProcess(script: string | Uri): Promise<DartProcess> {
	const config = await getLaunchConfiguration(script, { deviceId: "flutter-tester" }) as FlutterLaunchRequestArguments;
	if (!config)
		throw new Error(`Could not get launch configuration (got ${config})`);
	const process = extApi.safeToolSpawn(
		config.cwd,
		path.join(config.flutterSdkPath, flutterPath),
		[
			"run",
			"-d",
			config.deviceId!,
			"--disable-dds",
		],
	);
	logProcess(logger, LogCategory.CI, process);
	const flutterProcess = new DartProcess(process);
	defer(() => {
		// TODO: This may not be terminating correctly, as it may terminate the
		// shell process and not the child processes.
		if (!flutterProcess.hasExited)
			flutterProcess.process.kill();
	});
	return flutterProcess;
}

export class DartProcess {
	public readonly vmServiceUri: Promise<string>;
	public readonly exitCode: Promise<number | null>;
	public get hasExited() { return this.exited; }
	private exited: boolean = false;

	constructor(public readonly process: SpawnedProcess) {
		this.vmServiceUri = new Promise((resolve, reject) => {
			process.stdout.on("data", (data) => {
				const match = vmServiceListeningBannerPattern.exec(data.toString());
				if (match)
					resolve(match[1]);
			});
		});
		this.exitCode = new Promise<number | null>((resolve, reject) => {
			process.on("exit", (code) => { this.exited = true; resolve(code); });
		});
	}
}

export function killFlutterTester(): Promise<void> {
	return new Promise((resolve) => {
		const proc = isWin
			? extApi.safeToolSpawn(undefined, "taskkill", ["/IM", "flutter_tester.exe", "/F"])
			: extApi.safeToolSpawn(undefined, "pkill", ["flutter_tester"]);
		proc.on("exit", (code: number) => {
			if (isWin ? code !== 128 : code === 0) {
				logger.warn(`flutter_tester process(s) remained after test (${currentTestName}). These have been terminated to avoid affecting future tests, ` +
					`but may indicate something is not cleaning up correctly`, LogCategory.CI);
			}
			resolve();
		});
	});
}

export function isSdkFrame(frame: DebugProtocol.StackFrame) {
	return !frame.source || frame.source.name && frame.source.name.startsWith("dart:");
}

export function isExternalPackage(frame: DebugProtocol.StackFrame) {
	return frame.source && frame.source.name && frame.source.name.startsWith("package:") && !isLocalPackage(frame);
}

export function isLocalPackage(frame: DebugProtocol.StackFrame) {
	return frame.source && frame.source.name && frame.source.name.startsWith("package:") &&
		// Packages known to be local (from our test projects).
		(frame.source.name.startsWith("package:my_package")
			|| frame.source.name.startsWith("package:hello_world")
			|| frame.source.name.startsWith("package:example"));
}

export function isUserCode(frame: DebugProtocol.StackFrame) {
	return frame.source
		&& frame.source.name
		&& !frame.source.name.startsWith("dart:")
		&& (!frame.source.name.startsWith("package:") || frame.source.name.startsWith("package:hello_world"));
}

export function ensureFrameCategories(frames: DebugProtocol.StackFrame[], presentationHint: string | undefined, origin: string | undefined) {
	assert.notEqual(frames.length, 0);
	for (const frame of frames) {
		assert.equal(frame.source!.presentationHint, presentationHint);
		assert.equal(frame.source!.origin, origin);
	}
}
