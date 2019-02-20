import * as assert from "assert";
import { ChildProcess } from "child_process";
import { DebugConfiguration, Uri } from "vscode";
import { DebugProtocol } from "vscode-debugprotocol";
import { ObservatoryConnection } from "../src/debug/dart_debug_protocol";
import { isWin, LogCategory, LogSeverity } from "../src/debug/utils";
import { log } from "../src/utils/log";
import { safeSpawn } from "../src/utils/processes";
import { DartDebugClient } from "./dart_debug_client";
import { defer, getLaunchConfiguration } from "./helpers";

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
		evaluateName?: string | null;
		name: string;
		value: string;
	};
	value: {
		evaluateName?: string | null;
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
		assert.ok(key);
		assert.ok(value);
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

export function spawnDartProcessPaused(config: DebugConfiguration): DartProcess {
	const process = safeSpawn(
		config.cwd,
		config.dartPath,
		[
			"--enable-vm-service=0",
			"--pause_isolates_on_start=true",
			config.program,
		],
	);
	const dartProcess = new DartProcess(process);
	defer(() => {
		if (!dartProcess.hasExited)
			dartProcess.process.kill();
	});
	return dartProcess;
}

export async function spawnFlutterProcess(script: string | Uri): Promise<DartProcess> {
	const config = await getLaunchConfiguration(script, { deviceId: "flutter-tester" });
	const process = safeSpawn(
		config.cwd,
		config.flutterPath,
		[
			"run",
			"-d",
			config.deviceId,
		],
	);
	process.stdout.on("data", (data) => log(`SPROC: ${data}`, LogSeverity.Info, LogCategory.CI));
	process.stderr.on("data", (data) => log(`SPROC: ${data}`, LogSeverity.Info, LogCategory.CI));
	process.on("exit", (code) => log(`SPROC: Exited (${code})`, LogSeverity.Info, LogCategory.CI));
	const flutterProcess = new DartProcess(process);
	defer(() => {
		if (!flutterProcess.hasExited)
			flutterProcess.process.kill();
	});
	return flutterProcess;
}

export class DartProcess {
	public readonly observatoryUri: Promise<string>;
	public readonly exitCode: Promise<number>;
	public get hasExited() { return this.exited; }
	private exited: boolean = false;

	constructor(public readonly process: ChildProcess) {
		this.observatoryUri = new Promise((resolve, reject) => {
			process.stdout.on("data", (data) => {
				const match = ObservatoryConnection.bannerRegex.exec(data.toString());
				if (match)
					resolve(match[1]);
			});
		});
		this.exitCode = new Promise<number>((resolve, reject) => {
			process.on("exit", (code) => { this.exited = true; resolve(code); });
		});
	}
}

export function killFlutterTester(): Promise<void> {
	return new Promise((resolve) => {
		const proc = isWin
			? safeSpawn(undefined, "taskkill", ["/IM", "flutter_tester.exe", "/F"])
			: safeSpawn(undefined, "pkill", ["flutter_tester"]);
		proc.on("exit", (code: number) => {
			if (!isWin ? code !== 128 : code === 0) {
				log("flutter_tester process(s) remained after test. These have been terminated to avoid affecting future tests, " +
					"but may indicate something is not cleaning up correctly", LogSeverity.Warn, LogCategory.CI);
			}
			resolve();
		});
	});
}
