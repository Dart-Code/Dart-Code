import * as assert from "assert";
import { ChildProcess } from "child_process";
import { DebugConfiguration } from "vscode";
import { DebugProtocol } from "vscode-debugprotocol";
import { ObservatoryConnection } from "../src/debug/dart_debug_protocol";
import { safeSpawn } from "../src/debug/utils";
import { DartDebugClient } from "./dart_debug_client";
import { defer } from "./helpers";

export function ensureVariable(variables: DebugProtocol.Variable[], evaluateName: string, name: string, value: string | { starts?: string, ends?: string }) {
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

export interface MapEntry {
	key: {
		evaluateName: string;
		name: string;
		value: string;
	};
	value: {
		evaluateName: string;
		name: string;
		value: string;
	};
}

export async function ensureMapEntry(mapEntries: DebugProtocol.Variable[], entry: MapEntry, dc: DartDebugClient) {
	assert.ok(mapEntries);
	const results = await Promise.all(mapEntries.map((mapEntry) => {
		return dc.getVariables(mapEntry.variablesReference).then((variable) => {
			const key = variable[0] as DebugProtocol.Variable;
			const value = variable[1] as DebugProtocol.Variable;
			assert.ok(key);
			assert.ok(value);
			return key.evaluateName === entry.key.evaluateName
				&& key.name === entry.key.name
				&& key.value === entry.key.value
				&& value.evaluateName === entry.value.evaluateName
				&& value.name === entry.value.name
				&& value.value === entry.value.value;
		});
	}));
	assert.ok(results.find((r) => r), `Didn't find map entry for ${entry.key.value}=${entry.value.value}`);
}

export function spawnProcessPaused(config: DebugConfiguration): DartProcess {
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
