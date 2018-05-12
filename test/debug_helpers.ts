import * as assert from "assert";
import { Variable } from "vscode-debugadapter";
import { DebugClient } from "vscode-debugadapter-testsupport";
import { DebugProtocol } from "vscode-debugprotocol";

export async function getTopFrameVariables(dc: DebugClient, scope: "Exception" | "Locals"): Promise<Variable[]> {
	const threads = await dc.threadsRequest();
	assert.equal(threads.body.threads.length, 1);
	const stack = await dc.stackTraceRequest({ threadId: threads.body.threads[0].id });
	const scopes = await dc.scopesRequest({ frameId: stack.body.stackFrames[0].id });
	const exceptionScope = scopes.body.scopes.find((s) => s.name === scope);
	assert.ok(exceptionScope);
	return getVariables(dc, exceptionScope.variablesReference);
}

export async function getVariables(dc: DebugClient, variablesReference: number): Promise<Variable[]> {
	const variables = await dc.variablesRequest({ variablesReference });
	return variables.body.variables;
}

export async function evaluate(dc: DebugClient, expression: string): Promise<{
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

export async function ensureMapEntry(mapEntries: DebugProtocol.Variable[], entry: MapEntry, dc: DebugClient) {
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

export function ensureOutputContains(dc: DebugClient, category: string, text: string) {
	return new Promise((resolve, reject) => dc.on("output", (event: DebugProtocol.OutputEvent) => {
		if (event.body.category === category) {
			if (event.body.output.indexOf(text) !== -1)
				resolve();
			else
				reject(new Error(`Didn't find text "${text}" in ${category}`));
		}
	}));
}
