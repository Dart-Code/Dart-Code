import * as assert from "assert";
import { ChildProcess } from "child_process";
import { DebugConfiguration } from "vscode";
import { Variable } from "vscode-debugadapter";
import { DebugProtocol } from "vscode-debugprotocol";
import { ObservatoryConnection } from "../src/debug/dart_debug_protocol";
import { safeSpawn } from "../src/debug/utils";
import { DartDebugClient } from "./debug_client";
import { defer } from "./helpers";

export async function getTopFrameVariables(dc: DartDebugClient, scope: "Exception" | "Locals"): Promise<Variable[]> {
	const threads = await dc.threadsRequest();
	assert.equal(threads.body.threads.length, 1);
	const stack = await dc.stackTraceRequest({ threadId: threads.body.threads[0].id });
	const scopes = await dc.scopesRequest({ frameId: stack.body.stackFrames[0].id });
	const exceptionScope = scopes.body.scopes.find((s) => s.name === scope);
	assert.ok(exceptionScope);
	return getVariables(dc, exceptionScope.variablesReference);
}

export async function getVariables(dc: DartDebugClient, variablesReference: number): Promise<Variable[]> {
	const variables = await dc.variablesRequest({ variablesReference });
	return variables.body.variables;
}

export async function evaluate(dc: DartDebugClient, expression: string): Promise<{
	result: string;
	type?: string;
	variablesReference: number;
	namedVariables?: number;
	indexedVariables?: number;
}> {
	const threads = await dc.threadsRequest();
	assert.equal(threads.body.threads.length, 1);
	const stack = await dc.stackTraceRequest({ threadId: threads.body.threads[0].id });
	const result = await dc.evaluateRequest({ expression, frameId: stack.body.stackFrames[0].id });
	return result.body;
}

export async function attach(dc: DartDebugClient, config: any): Promise<void> {
	await dc.initializeRequest();
	await dc.configurationDoneRequest();
	await dc.attachRequest(config);
}

export function ensureVariable(variables: DebugProtocol.Variable[], evaluateName: string, name: string, value: string) {
	assert.ok(variables);
	const v = variables.find((v) => v.name === name);
	assert.ok(
		v,
		`Couldn't find variable ${name} in\n`
		+ variables.map((v) => `        ${v.name}: ${v.value}`).join("\n"),
	);
	assert.equal(v.evaluateName, evaluateName);
	assert.equal(v.value, value);
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
		return getVariables(dc, mapEntry.variablesReference).then((variable) => {
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
	assert.ok(results.find((r) => r));
}

export function ensureOutputContains(dc: DartDebugClient, category: string, text: string) {
	return new Promise((resolve, reject) => dc.on("output", (event: DebugProtocol.OutputEvent) => {
		if (event.body.category === category) {
			if (event.body.output.indexOf(text) !== -1)
				resolve();
			else
				reject(new Error(`Didn't find text "${text}" in ${category}`));
		}
	}));
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
				const match = ObservatoryConnection.portRegex.exec(data.toString());
				if (match)
					resolve(match[1]);
			});
		});
		this.exitCode = new Promise<number>((resolve, reject) => {
			process.on("exit", (code) => { this.exited = true; resolve(code); });
		});
	}
}
