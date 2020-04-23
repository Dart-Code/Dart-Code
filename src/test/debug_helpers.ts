import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import { DebugConfiguration, Uri } from "vscode";
import { DebugProtocol } from "vscode-debugprotocol";
import { isWin, observatoryListeningBannerPattern } from "../shared/constants";
import { LogCategory } from "../shared/enums";
import { SpawnedProcess } from "../shared/interfaces";
import { logProcess } from "../shared/logging";
import { DartDebugClient } from "./dart_debug_client";
import { currentTestName, defer, extApi, fileSafeCurrentTestName, getLaunchConfiguration, logger, watchPromise } from "./helpers";

export const flutterTestDeviceId = process.env.FLUTTER_TEST_DEVICE_ID || "flutter-tester";
export const flutterTestDeviceIsWeb = flutterTestDeviceId === "chrome" || flutterTestDeviceId === "web-server";

export async function startDebugger(dc: DartDebugClient, script?: Uri | string, extraConfiguration?: { [key: string]: any }): Promise<DebugConfiguration> {
	extraConfiguration = Object.assign(
		{},
		{
			// Use pid-file as a convenient way of getting the test name into the command line args
			// for easier debugging of processes that hang around on CI (we dump the process command
			// line at the end of the test run).
			args: extApi.flutterCapabilities.supportsPidFileForMachine
				? ["--pid-file", path.join(os.tmpdir(), fileSafeCurrentTestName)]
				: [],
			deviceId: flutterTestDeviceId,
		},
		extraConfiguration,
	);
	const config = await getLaunchConfiguration(script, extraConfiguration);
	if (!config)
		throw new Error(`Could not get launch configuration (got ${config})`);
	await watchPromise("startDebugger->start", dc.start(config.debugServer));
	return config;
}

export function ensureVariable(variables: DebugProtocol.Variable[], evaluateName: string | undefined, name: string, value: string | { starts?: string, ends?: string }) {
	assert.ok(variables && variables.length, "No variables given to search");
	let v = variables.find((v) => v.name === name);
	assert.ok(
		v,
		`Couldn't find variable ${name} in\n`
		+ variables.map((v) => `        ${v.name}: ${v.value}`).join("\n"),
	);
	v = v!;
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

		const key = variable[0] as DebugProtocol.Variable;
		const value = variable[1] as DebugProtocol.Variable;
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

export function spawnDartProcessPaused(config: DebugConfiguration | undefined | null, ...vmArgs: string[]): DartProcess {
	if (!config)
		throw new Error(`Debug config resolved to ${config}!`);
	const process = extApi.safeToolSpawn(
		config.cwd,
		config.dartPath,
		[
			"--enable-vm-service=0",
			"--pause_isolates_on_start=true",
			...vmArgs,
			config.program,
		],
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
	const config = await getLaunchConfiguration(script, { deviceId: "flutter-tester" });
	if (!config)
		throw new Error(`Could not get launch configuration (got ${config})`);
	const process = extApi.safeToolSpawn(
		config.cwd,
		config.flutterPath,
		[
			"run",
			"-d",
			config.deviceId,
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
	public readonly observatoryUri: Promise<string>;
	public readonly exitCode: Promise<number | null>;
	public get hasExited() { return this.exited; }
	private exited: boolean = false;

	constructor(public readonly process: SpawnedProcess) {
		this.observatoryUri = new Promise((resolve, reject) => {
			process.stdout.on("data", (data) => {
				const match = observatoryListeningBannerPattern.exec(data.toString());
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
		(frame.source!.name.startsWith("package:my_package")
			|| frame.source!.name.startsWith("package:hello_world")
			|| frame.source!.name.startsWith("package:example"));
}

export function isUserCode(frame: DebugProtocol.StackFrame) {
	return frame.source
		&& frame.source.name
		&& !frame.source.name.startsWith("dart:")
		&& (!frame.source!.name.startsWith("package:") || frame.source!.name.startsWith("package:hello_world"));
}

export function ensureFrameCategories(frames: DebugProtocol.StackFrame[], presentationHint: string | undefined, origin: string | undefined) {
	assert.notEqual(frames.length, 0);
	for (const frame of frames) {
		assert.equal(frame.source!.presentationHint, presentationHint);
		assert.equal(frame.source!.origin, origin);
	}
}
